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
    if len(letters) < 3:
        return False
    arabic = sum(1 for c in letters if ARABIC_RE.match(c))
    return arabic / len(letters) > 0.5


def clean(text: str) -> str:
    return unicodedata.normalize("NFC", text.replace("\xa0", " ")).strip()


def parse_docx(path: Path) -> dict:
    doc = Document(str(path))
    result = {
        "source_file": path.name,
        "juz": None,
        "surahs": [],
    }
    surah: dict | None = None
    section: dict | None = None
    ayah: dict | None = None  # Arabic text seen, waiting for its (s:a) line
    intro: list[str] = []
    ayah_by_num: dict[int, dict] = {}  # first occurrence of each ayah wins

    for p in doc.paragraphs:
        text = clean(p.text)
        if not text:
            continue

        if m := JUZ_RE.search(text):
            result["juz"] = int(m.group(1))
            continue

        if p.style.name != "Intense Quote" and (m := SURAH_RE.search(text)):
            if surah:
                result["surahs"].append(surah)
            surah = {
                "number": int(m.group(1)),
                "name_en": clean(m.group(2)),
                "intro": [],
                "sections": [],
            }
            section, ayah, intro = None, None, surah["intro"]
            ayah_by_num = {}
            continue

        if surah is None:
            continue  # cover-page boilerplate before first SURAH heading

        if m := GROUP_RE.match(text):
            section = {"title": clean(m.group(1)), "ayahs": [], "notes": []}
            surah["sections"].append(section)
            ayah = None
            continue

        if m := RANGE_TITLE_RE.match(text):
            section = {"title": clean(m.group(1)), "ayahs": [], "notes": []}
            surah["sections"].append(section)
            ayah = None
            continue

        if m := TRANSLATION_RE.match(text):
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
                continue
            ayah = {
                "number": num,
                "text_ar": (ayah["text_ar"] if ayah else None),
                "translation": clean(m.group(3)),
                "commentary": [],
            }
            ayah_by_num[num] = ayah
            section["ayahs"].append(ayah)
            continue

        if is_arabic(text):
            # Arabic line: start/append pending ayah text
            if ayah and not ayah.get("translation"):
                ayah["text_ar"] = clean(ayah.get("text_ar", "") + " " + text)
            else:
                ayah = {"number": None, "text_ar": text, "translation": None, "commentary": []}
            continue

        # plain prose -> commentary (surah intro / section note / ayah commentary)
        if ayah is not None and section is not None:
            ayah["commentary"].append(text)
        elif section is not None:
            section["notes"].append(text)
        else:
            intro.append(text)

    if surah:
        result["surahs"].append(surah)
    return result


def _implicit_section(surah: dict) -> dict:
    """Ayat appearing before any GROUP line get an implicit 'Introduction' section."""
    section = {"title": "Introduction", "ayahs": [], "notes": []}
    surah["sections"].append(section)
    return section


def parse_directory(data_dir: str | Path) -> list[dict]:
    docs = []
    for f in sorted(Path(data_dir).glob("*.docx")):
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