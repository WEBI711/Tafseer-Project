"""Parse Tafsir docx files into structured JSON.

Document conventions (from sample docs):
  - "JUZ n" (Title style)          -> juz boundary
  - "SURAH n – NAME" (uppercase)   -> surah boundary  (lowercase 'Surah' prose is ignored)
  - "GROUP n: TITLE" or "n-n TITLE" -> section / sub-section boundary
  - Arabic-dominant line           -> ayah Arabic text
  - "(s:a) translation"            -> ayah number + translation
  - following paragraphs           -> commentary for that ayah
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from docx import Document

ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")
TRANSLATION_RE = re.compile(r"^\((\d+):(\d+)\)\s*(.*)")
SURAH_RE = re.compile(r"SURAH\s+(\d+)\s*[–—-]\s*(.+)", re.IGNORECASE)
JUZ_RE = re.compile(r"JUZ\s+(\d+)", re.IGNORECASE)
GROUP_RE = re.compile(r"^GROUP\s+\d+\s*:\s*(.+)", re.IGNORECASE)
# real surah headings are uppercase; prose like 'Surah Al- Fatihah ended...' must not match
SURAH_RE = re.compile(r"^SURAH\s+(\d+)\s*[–—-]\s*(\S.*)")
# sub-section headings like "1-5 CLAIM OF AL-QURAN THAT ..." (range prefix + caps title)
RANGE_TITLE_RE = re.compile(r"^\d{1,3}\s*[-–]\s*\d{1,3}\s+([A-Z][A-Z'’`\s,.:/()–—-]{8,}.*)")


def is_arabic(text: str) -> bool:
    letters = [c for c in text if unicodedata.category(c).startswith("L")]
    if not letters:
        return False
    arabic = sum(1 for c in letters if ARABIC_RE.match(c))
    # Disjoined-letter openings (طٰهٰ, يٰسٓ, حمٓ) are real verse text but carry
    # only one or two letters once diacritics are excluded, so a ratio test
    # would file them as prose. For such fragments every letter must be Arabic.
    if len(letters) < 3:
        return arabic == len(letters)
    return arabic / len(letters) > 0.5


# Unicode artifacts that carry no text: private-use glyphs from the author's
# Word fonts (they render as an empty box in every other font) and invisible
# control characters that came along with copy-paste. ZWNJ/ZWJ are kept.
ARTIFACT_RE = re.compile(
    r"[\ue000-\uf8ff\u200b\u200e\u200f\u2060\ufeff\u00ad]"
)


def clean(text: str) -> str:
    text = ARTIFACT_RE.sub("", text)
    return unicodedata.normalize("NFC", text.replace("\xa0", " ")).strip()


def _all_runs_bold(p) -> bool:
    """A heading in these docs is a paragraph whose runs are *all* bold.
    Body paragraphs also contain bold runs for emphasis, so 'any bold' is not
    a heading signal."""
    runs = [r for r in p.runs if r.text.strip()]
    return bool(runs) and all(bool(r.bold) for r in runs)


def _block_kind(text: str, p, arabic: bool, is_translation: bool) -> str:
    """Role of a paragraph in the source document, for faithful rendering."""
    if p.style.name == "Title" and JUZ_RE.search(text):
        return "juz_header"
    if p.style.name != "Intense Quote" and SURAH_RE.search(text):
        return "surah_header"
    if GROUP_RE.match(text) or RANGE_TITLE_RE.match(text):
        return "section_heading"
    if is_translation:
        return "translation"
    if arabic:
        return "arabic"
    if p.style.name.startswith("List Paragraph"):
        return "list_item"
    if _all_runs_bold(p) and len(text) <= 90:
        return "heading"
    return "prose"


def parse_docx(path: Path) -> dict:
    doc = Document(str(path))
    result = {
        "source_file": path.name,
        "juz": None,
        "surahs": [],
    }
    surah: dict | None = None
    section: dict | None = None
    ayah: dict | None = None  # ayah currently collecting commentary
    # Arabic paragraphs that have not been claimed by an ayah yet. Only text in
    # here may become an ayah's `text_ar`: these docs often quote the Arabic
    # once per section and then give translations for several ayat, and reusing
    # the last verse's Arabic for the following ones would misattribute it.
    pending_ar: str | None = None
    arabic_open = False  # consecutive Arabic lines belong to the same quote
    intro: list[str] = []
    ayah_by_num: dict[int, dict] = {}  # first occurrence of each ayah wins
    # Every paragraph, in document order, with its role and its verse reference.
    # This is what the reader renders, so structure and wording stay the
    # author's; the objects above are the derived view that search works on.
    blocks: list[dict] = []
    cur_surah: int | None = None

    for p in doc.paragraphs:
        text = clean(p.text)
        if not text:
            continue

        m_juz = JUZ_RE.search(text)
        m_surah = None if p.style.name == "Intense Quote" else SURAH_RE.search(text)
        m_tr = TRANSLATION_RE.match(text)
        arabic = is_arabic(text)

        if m_juz:
            result["juz"] = int(m_juz.group(1))
        if m_surah:
            cur_surah = int(m_surah.group(1))
        blocks.append(
            {
                "ord": len(blocks),
                "kind": _block_kind(text, p, arabic, m_tr is not None),
                "text": text,
                "surah_number": cur_surah,
                "juz": result["juz"],
                "ref_surah": int(m_tr.group(1)) if m_tr else None,
                "ref_ayah": int(m_tr.group(2)) if m_tr else None,
            }
        )

        if m_juz:
            continue

        if m_surah:
            if surah:
                result["surahs"].append(surah)
            surah = {
                "number": int(m_surah.group(1)),
                "name_en": clean(m_surah.group(2)),
                "intro": [],
                "sections": [],
            }
            section, ayah, pending_ar, arabic_open = None, None, None, False
            intro = surah["intro"]
            ayah_by_num = {}
            continue

        if surah is None:
            continue  # cover-page boilerplate before first SURAH heading

        if m := GROUP_RE.match(text):
            section = {"title": clean(m.group(1)), "ayahs": [], "notes": []}
            surah["sections"].append(section)
            ayah, pending_ar, arabic_open = None, None, False
            continue

        if m := RANGE_TITLE_RE.match(text):
            section = {"title": clean(m.group(1)), "ayahs": [], "notes": []}
            surah["sections"].append(section)
            ayah, pending_ar, arabic_open = None, None, False
            continue

        if m_tr:
            m = m_tr
            ref_surah, num = int(m.group(1)), int(m.group(2))
            if surah and ref_surah != surah["number"]:
                # cross-reference to another surah quoted inside commentary
                if ayah is not None:
                    ayah["commentary"].append(f"[ref {ref_surah}:{num}] {clean(m.group(3))}")
                elif section is not None:
                    section["notes"].append(f"[ref {ref_surah}:{num}] {clean(m.group(3))}")
                continue
            if section is None:
                section = _implicit_section(surah)
            if num in ayah_by_num:
                # summary restatement of an already-parsed ayah -> keep as reference commentary
                ayah_by_num[num]["commentary"].append(f"[restatement] {text}")
                ayah = None
                arabic_open = False
                continue
            ayah = {
                "number": num,
                "text_ar": pending_ar,
                "translation": clean(m.group(3)),
                "commentary": [],
            }
            pending_ar, arabic_open = None, False
            ayah_by_num[num] = ayah
            section["ayahs"].append(ayah)
            continue

        if arabic:
            # Arabic paragraph: may be the verse text for the next (s:a) line,
            # never for a later, unrelated one.
            pending_ar = f"{pending_ar} {text}" if arabic_open and pending_ar else text
            arabic_open = True
            continue

        # any other paragraph closes the Arabic quote window
        arabic_open = False

        # plain prose -> commentary (surah intro / section note / ayah commentary)
        if ayah is not None and section is not None:
            ayah["commentary"].append(text)
        elif section is not None:
            section["notes"].append(text)
        else:
            intro.append(text)

    if surah:
        result["surahs"].append(surah)

    # Blocks before the first surah heading belong to that document's surah
    # (the bismillah, the juz banner) — attribute them forwards so nothing in the
    # document is dropped from the reading view.
    first: int | None = next((b["surah_number"] for b in blocks if b["surah_number"]), None)
    for b in blocks:
        if b["surah_number"] is None:
            b["surah_number"] = first
    result["blocks"] = blocks
    return result


def _implicit_section(surah: dict) -> dict:
    """Ayat appearing before any GROUP line get an implicit 'Introduction' section."""
    section = {"title": "Introduction", "ayahs": [], "notes": []}
    surah["sections"].append(section)
    return section


def parse_directory(data_dir: str | Path) -> list[dict]:
    docs = []
    for f in sorted(Path(data_dir).rglob("*.docx")):
        if f.name.startswith("~$"):
            continue
        docs.append(parse_docx(f))
    return docs


def dump(docs: list[dict], out: Path) -> None:
    out.write_text(json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    import sys

    docs = parse_directory(sys.argv[1] if len(sys.argv) > 1 else "../data")
    dump(docs, Path("parsed.json"))
    for d in docs:
        print(f"{d['source_file']}: juz={d['juz']} surahs={[s['number'] for s in d['surahs']]}")