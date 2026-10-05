"""Structured per-juz parser — implements FORMAT.md (draft v7).

Reads source/Archive/<juz folder>/ and emits one JSON instance per juz with
the exact shape FORMAT.md section 5 defines:

    juz -> parts -> sections -> ayah_units -> commentary / extras

The audited sample JSONs in ingestion/spec/samples/ are the ground truth this
parser must reproduce; check_samples.py diffs the two.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from .parse import is_arabic, clean  # shared text helpers

ARCHIVE_DIR = Path(__file__).resolve().parents[2] / "source" / "Archive"

JUZ_NUM_RE = re.compile(r"(?i)juz\s*(\d+)")
SURAH_HEADING_RE = re.compile(r"^(?:SURAH\s*(\d+)|(\d{1,3})\s+SURAH)\s*[–—-]*\s*(\S.*)")
BISMILLAH_RE = re.compile(r"بِسۡم|بسم الله")
GROUP_RE = re.compile(r"(?i)^GROUP\s+(\d+)\s*[:—–-]\s*(.+)")
RECUP_RE = re.compile(r"(?i)^\s*(MY KEY TAKEAWAYS?|BEAUTIFUL DIVISION)")
INTRO_INDEX_RE = re.compile(r"(?i)^Introduction to (the )?sections\s*:?\s*$")
# translation line: "(s:a) text" or "(s)" with surah inferred from context
TRANS_RE = re.compile(r"^\(\s*(\d+)\s*[:\-–]?\s*(\d+|[^)]*?)\s*\)\s*(.*)$")
SECTION_RANGE_IN_TITLE_RE = re.compile(r"[\((](\d{1,3})\s*[-–—]\s*(\d{1,3})[\))]\s*$")
TITLE_BARE_RANGE_RE = re.compile(r"^(.+?)\s+(\d{1,3})\s*[-–]\s*(\d{1,3})$")
RANGE_TITLE_RE = re.compile(r"^(\d{1,3})\s*[-–]\s*(\d{1,3})\s+(.+)$")
SINGLE_TITLE_RE = re.compile(r"^(\d{1,3})\s+([A-Z].{7,})$")
VERSES_TITLE_RE = re.compile(r"(?i)^(?:VERSES?|AYAT?)\s+(\d{1,3})\s*[-–]\s*(\d{1,3})\s*[-–:]?\s*(.+)$")
RANGED_REF_TITLE_RE = re.compile(r"^\(\s*(\d+)\s*[:.]\s*(\d+)\s*[-–—]\s*(\d+)\s*[:.]?\s*(\d+)\s*\)\s*(.+)$")
INVERTED_TITLE_RE = re.compile(r"^([A-Z][A-Z'’`\s,.:/&-]{7,})\s*[\((](\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?[\))]\s*$")
CP_SURAH_RE = re.compile(
    r"(?i)surah\s*(\d+)\s*[–—-]\s*([^:(]+?)\s*[\((]\s*(?:\d+\s*[:.]\s*)?(\d+)\s*(?:till|to|through|-|–|—)?\s*(?:\d+\s*[:.]\s*)?(\d+)\s*[\))]"
)
KNOWN_LABELS = [
    "Name", "Period of Revelation", "Subject and Topics", "Subject",
    "Historical Background", "Theme and Subject Matter", "Topics of Discussion",
]


def _all_bold(p) -> bool:
    runs = [r for r in p.runs if r.text.strip()]
    return bool(runs) and all(bool(r.bold) for r in runs)


def _italic(p) -> bool:
    runs = [r for r in p.runs if r.text.strip()]
    return bool(runs) and all(bool(r.italic) for r in runs)


def _body_items(doc):
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, doc)
        elif child.tag.endswith("}tbl"):
            yield Table(child, doc)


def parse_ref(ref: str) -> dict:
    """Normalize a verbatim ref like '2:255', '(253)', '3:152-3',
    '2:204 , 205 and 206' into {ref_surah, from_ayah, to_ayah} (nulls when
    unparseable). The caller keeps the original string verbatim."""
    out = {"ref_surah": None, "from_ayah": None, "to_ayah": None}
    s = ref.strip()
    nums = [int(n) for n in re.findall(r"\d+", s)]
    m = re.match(r"^(\d+)\s*[:\-–]\s*(\d+)(?:\s*[-–]\s*(\d+))?", s)
    if m and re.search(r"[:\-–]", s):
        out["ref_surah"] = int(m.group(1))
        out["from_ayah"] = int(m.group(2))
        out["to_ayah"] = int(m.group(3)) if m.group(3) else out["from_ayah"]
        if out["to_ayah"] is not None and out["to_ayah"] < out["from_ayah"]:
            # shorthand like 3:152-3 means 152-153 (last digit(s) replace the
            # tail of from_ayah)
            tail = str(out["to_ayah"])
            out["to_ayah"] = int(str(out["from_ayah"])[:-len(tail)] + tail)
        return out
    if len(nums) == 1:
        out["from_ayah"] = out["to_ayah"] = nums[0]
        return out
    if len(nums) >= 2:
        out["from_ayah"] = nums[-2]
        out["to_ayah"] = nums[-1]
        return out
    return out


def parse_translation_line(text: str, cur_surah: int | None) -> dict | None:
    """Recognize a '(s:a) translation' line and return the translation object
    (FORMAT.md translation shape) or None if the line is not one.
    Handles surah-less refs ('(253)') and multi-ayat refs ('2:204 , 205')."""
    m = TRANS_RE.match(text)
    if not m:
        return None
    a, b, rest = m.group(1), m.group(2), m.group(3)
    if b:
        ref = f"{a}:{b}"
        t = parse_ref(ref)
        if t.get("from_ayah") is None:
            t = {"ref_surah": None, "from_ayah": None, "to_ayah": None}
    else:
        # bare ayah ref '(253)': surah comes from context
        ref = a
        t = {"ref_surah": None, "from_ayah": int(a), "to_ayah": int(a),
             "ref_inferred": True}
    if t.get("ref_surah") is None and cur_surah:
        t["ref_surah"] = cur_surah
        t["ref_inferred"] = True
    return {
        "ref": ref,
        "text": rest.strip(),
        "ref_surah": t.get("ref_surah"),
        "from_ayah": t["from_ayah"],
        "to_ayah": t["to_ayah"],
        "ref_inferred": t.get("ref_inferred", False),
        "ref_as_written": None,
    }


def match_section_heading(text: str, bold: bool, raw: str | None = None) -> dict | None:
    """FORMAT.md section 2 rule 4 heading patterns. Returns
    {title, from_ayah, to_ayah}; title is the RAW line as written (rule:
    'title = raw line as written'), never a reworded form."""
    raw = raw if raw is not None else text
    for pat in (VERSES_TITLE_RE, RANGED_REF_TITLE_RE, INVERTED_TITLE_RE):
        m = pat.match(text)
        if m:
            if pat is RANGED_REF_TITLE_RE:
                return _sec(raw.strip(), int(m.group(2)), int(m.group(4)))
            if pat is INVERTED_TITLE_RE:
                a = int(m.group(2))
                b = int(m.group(3)) if m.group(3) else a
                return _sec(raw.strip(), a, b)
            return _sec(raw.strip(), *_pick_range(m))
    m = GROUP_RE.match(text)
    if m:
        return _sec(raw.strip(), None, None)
    m = RANGE_TITLE_RE.match(text)
    if m:
        return _sec(raw.strip(), int(m.group(1)), int(m.group(2)))
    m = SECTION_RANGE_IN_TITLE_RE.match(text)
    if m:
        return _sec(raw.strip(), int(m.group(1)), int(m.group(2)))
    m = TITLE_BARE_RANGE_RE.match(text)
    if m and m.group(1).strip() and m.group(1).strip() == m.group(1).strip().upper():
        return _sec(raw.strip(), int(m.group(2)), int(m.group(3)))
    if bold:
        m = SINGLE_TITLE_RE.match(text)
        if m:
            return _sec(raw.strip(), int(m.group(1)), int(m.group(1)))
    return None


def _pick_range(m) -> tuple:
    """from/to for the VERSES_TITLE pattern (groups 1,2 = range)."""
    return int(m.group(1)), int(m.group(2))


def _norm_title(t: str) -> str:
    """Loose title key: drop ranges, punctuation, and case so an index title
    matches its drifted body heading (FORMAT.md rule 10)."""
    t = t or ""
    t = re.sub(r"[\(\[]?\d{1,3}\s*[-–—]\s*\d{1,3}[\)\]]?", "", t)
    t = re.sub(r"[^A-Za-z0-9]+", " ", t)
    return " ".join(t.upper().split())


def _index_confirms(index_titles: list[str] | None, title: str) -> bool:
    """Rule 10: when the docx carries a section-title index, a body heading is
    a real section only if the index lists it. The author paraphrases between
    index and body, so compare on the leading words plus the ayah range —
    not the whole string."""
    if not index_titles:
        return True
    key = _norm_title(title)
    if not key:
        return False
    head = key[:18]
    range_of = re.findall(r"\d{1,3}", title)
    for t in index_titles:
        nt = _norm_title(t)
        if not nt:
            continue
        if nt.startswith(head) or head.startswith(nt[:18]):
            return True
        # same ayah range + overlapping first word
        if range_of and re.findall(r"\d{1,3}", t)[:1] == range_of[:1] \
                and key.split()[0] == nt.split()[0]:
            return True
    return False


def _sec(title: str, a: int | None, b: int | None) -> dict:
    return {"title": title, "from_ayah": a, "to_ayah": b}


def new_unit() -> dict:
    return {"arabic_lines": [], "translation": None, "commentary": [], "extras": []}


# ---------------------------------------------------------------- juz / CP

def find_juz_folders() -> list[tuple[int, Path]]:
    out = []
    for d in sorted(ARCHIVE_DIR.iterdir()):
        if not d.is_dir():
            continue
        m = JUZ_NUM_RE.search(d.name)
        if m:
            out.append((int(m.group(1)), d))
    return sorted(out)


def parse_cp_row(line: str) -> dict | None:
    """One coverage-map row: 'Surah 1 – Al Fatiha (1:1 till 1:7)'.
    Range shapes seen: '(1:1 till 1:7)', '(78: 1 Till 78:40)',
    '(253: Till 2:286)'. Returns {surah_number, name_en, from_ayah, to_ayah}.
    The name keeps any parenthetical gloss; the range is the LAST paren
    group on the line."""
    m = re.search(r"(?i)surah\s*(\d+)\s*[–—-]\s*([^\n(]+)", line)
    if not m:
        return None
    surah_number = int(m.group(1))
    name = m.group(2).strip().rstrip("(").strip()
    parens = re.findall(r"\(([^)]*)\)", line[m.end():])
    if not parens:
        return None
    nums = re.findall(r"\d+", parens[-1])
    if not nums:
        return None
    nums = [int(x) for x in nums]
    if len(nums) >= 4:
        from_ayah, to_ayah = nums[1], nums[-1]
    elif len(nums) == 3:
        from_ayah, to_ayah = nums[0], nums[-1]
    else:
        from_ayah, to_ayah = nums[0], nums[-1]
    return {"surah_number": surah_number, "name_en": name,
            "from_ayah": from_ayah, "to_ayah": to_ayah}


def parse_cp(path: Path, juz_number: int) -> dict:
    doc = Document(str(path))
    lines = [clean(p.text) for p in _body_items(doc) if isinstance(p, Paragraph)]
    lines = [l for l in lines if l]
    if not lines:
        # a CP may be an OLE-embedded Word object inside the cover file (v7):
        # extract word/embeddings/*.docx and parse that instead
        import tempfile, zipfile
        with zipfile.ZipFile(path) as z:
            embeds = [n for n in z.namelist()
                      if n.startswith("word/embeddings/") and n.endswith(".docx")]
        if embeds:
            with tempfile.TemporaryDirectory() as td:
                inner = Path(td) / "inner.docx"
                inner.write_bytes(zipfile.ZipFile(path).read(embeds[0]))
                return parse_cp(inner, juz_number)
    cp_text = "\n".join(lines)

    coverage = []
    for line in lines:
        row = parse_cp_row(line)
        if row:
            coverage.append(row)

    # Header lines: everything between the JUZ banner and the coverage map.
    header_lines, credits = [], []
    in_credits = False
    for line in lines:
        if JUZ_NUM_RE.fullmatch(line.strip()):
            continue
        if CP_SURAH_RE.search(line):
            in_credits = True  # coverage map ends; what follows is credits
            continue
        if re.search(r"(?i)curated|resources used|feedback|@", line):
            credits.append(line)
            continue
        if not in_credits:
            header_lines.append(line)

    arabic_header = next((l for l in header_lines if is_arabic(l)), None)
    translit = meaning = None
    for line in header_lines:
        if is_arabic(line) or line == arabic_header:
            continue
        if re.search(r"(?i)transliter", line):
            translit = line
        elif re.search(r"(?i)meaning|\"|“", line):
            meaning = meaning or line
    return {
        "number": juz_number,
        "folder": path.parent.name,
        "arabic_header": arabic_header,
        "arabic_header_translit": translit,
        "arabic_header_meaning": meaning,
        "credits": "\n".join(credits) or None,
        "cp_text": cp_text,
        "cp_header_lines": header_lines,
        "group_headers": [],
        "extras": [],
    }, coverage


# ------------------------------------------------------------- content docx

def parse_content(path: Path, cp_coverage: list[dict], juz_number: int,
                  group_sink: list) -> list[dict]:
    """One docx may hold SEVERAL surah segments (combined 'CP and Surah n'
    files). Split the body stream at SURAH headings; each segment is a part.
    In a CP-combined file the pre-first-SURAH lines are CP material and are
    skipped."""
    doc = Document(str(path))
    is_cp_file = bool(re.search(r"(?i)\bcp\b", path.stem))
    items = list(_body_items(doc))
    # segment start indexes: positions of paragraphs matching a SURAH heading.
    # Guards: a coverage-map row ("SURAH n – NAME (s:a Till s:a)") is not a
    # segment start; later headings must be in the CP coverage (cross-reference
    # lines are not) — but the FIRST heading of a file always starts a segment
    # (some CPs omit a surah their folder still contains).
    cov_surahs = {c["surah_number"] for c in cp_coverage}

    def is_surah_line(p) -> int | None:
        if not isinstance(p, Paragraph):
            return None
        text = clean(p.text)
        m = SURAH_HEADING_RE.match(text)
        if not m:
            return None
        if re.search(r"(?i)\(\s*\d+\s*[:.]\s*\d+\s+(till|to)\b", text):
            return None  # coverage-map row
        return int(m.group(1) or m.group(2))

    surah_lines = [(i, is_surah_line(p)) for i, p in enumerate(items)]
    surah_lines = [(i, s) for i, s in surah_lines if s is not None]
    starts = [i for i, s in surah_lines
              if i == surah_lines[0][0] or s in cov_surahs]
    if not starts:
        return []
    segments = []
    for i, s in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(items)
        begin = 0 if i == 0 else s  # the first segment keeps pre-heading lines
        # in a combined CP+surah file the first segment's pre-SURAH lines are
        # CP material — skip them
        segments.append((items[begin:end], is_cp_file and i == 0))
    parts = [_parse_segment(seg, skip_pre_surah=skip, path=path,
                            cp_coverage=cp_coverage, group_sink=group_sink)
             for seg, skip in segments]
    for i, part in enumerate(parts, start=1):
        part["ord"] = i
    return parts


def _parse_segment(items: list, skip_pre_surah: bool, path: Path,
                   cp_coverage: list[dict], group_sink: list) -> dict:
    part = {
        "surah_number": None, "name_en": None, "from_ayah": None, "to_ayah": None,
        "continues_from_prev_juz": False, "continues_in_next_juz": False,
        "source_file": path.name, "ord": 0,
        "bismillah": None, "juz_banner": None, "chunk_marker": None,
        "section_index": None, "extras": [],
        "front_matter": [], "sections": [], "recaps": [],
    }
    sections, front, recaps = part["sections"], part["front_matter"], part["recaps"]
    section = None
    unit = None            # ayah unit currently collecting commentary
    in_recap = False
    recap = None
    index_header, index_titles, index_mode = None, None, False
    seen_surah_heading = False

    def close_unit():
        nonlocal unit, section
        if unit is not None:
            if section is None:
                # rule 7: units before the first section heading hang off a
                # single default section titled by the surah, created lazily
                # (it therefore sorts first)
                title = None
                if part["surah_number"]:
                    title = f"SURAH {part['surah_number']}" + \
                            (f" – {part['name_en']}" if part["name_en"] else "")
                section = {"title": title, "ord": len(sections) + 1,
                           "from_ayah": None, "to_ayah": None,
                           "intro": [], "ayah_units": []}
                sections.append(section)
            section["ayah_units"].append(unit)
            unit = None

    def close_section():
        nonlocal section
        close_unit()
        section = None

    def close_recap():
        nonlocal recap
        if recap is not None and (recap["items"] or recap["title"]):
            recaps.append(recap)
        recap = None

    for p in items:
        if isinstance(p, Table):
            target = recap if in_recap else None
            item = {"kind": "table", "text": clean(str(p))}
            (target["extras"] if target else part["extras"]).append(item)
            continue

        text = clean(p.text)
        if not text:
            continue
        bold = _all_bold(p)

        # -- structural lines ------------------------------------------------
        if not seen_surah_heading:
            m = SURAH_HEADING_RE.match(text)
            if m:
                head_line = text.split("\n")[0]
                part["surah_number"] = int(m.group(1) or m.group(2))
                part["name_en"] = re.sub(
                    r"(?i)^(?:SURAH\s*\d+|\d+\s+SURAH)\s*[–—-]*\s*", "",
                    head_line).strip()
                # a heading paragraph may carry trailing lines (e.g. "Cont.")
                for extra_line in text.split("\n")[1:]:
                    extra_line = extra_line.strip()
                    if not extra_line:
                        continue
                    if re.fullmatch(r"(?i)\(?cont\.?\)?", extra_line):
                        part["chunk_marker"] = part["chunk_marker"] or extra_line
                    else:
                        part["extras"].append({"kind": "surah_heading_extra",
                                               "text": extra_line})
                seen_surah_heading = True
                continue
            if skip_pre_surah:
                continue  # combined CP+surah file: pre-surah lines are CP text
            if BISMILLAH_RE.search(text) and not is_arabic_dua(text):
                part["bismillah"] = text
                continue
            if JUZ_NUM_RE.search(text) and (p.style.name == "Title" or bold):
                part["juz_banner"] = text
                continue
            part["extras"].append({"kind": "pre_surah_line", "text": text})
            continue

        if re.fullmatch(r"(?i)\(?cont\.?\)?", text):
            part["chunk_marker"] = text
            continue

        m = INTRO_INDEX_RE.match(text)
        if m:
            index_header, index_titles = text.rstrip(":"), []
            index_mode = True
            continue
        if index_mode:
            # index entries are heading-shaped lines; real body content ends
            # the block (translations, Arabic, GROUP banners, labels). For a
            # multi-line paragraph ANY line of it can end the block.
            def _ends(ln):
                return bool(
                    parse_translation_line(ln, part["surah_number"])
                    or is_arabic(ln)
                    or GROUP_RE.match(ln)
                    or SURAH_HEADING_RE.match(ln)
                    or RECUP_RE.search(ln)
                    or _label_of(ln, bold) is not None)
            cand = text.split("\n") if "\n" in text else [text]
            if any(_ends(ln.strip()) for ln in cand if ln.strip()):
                part["section_index"] = {"header": index_header, "titles": index_titles}
                index_header, index_titles, index_mode = None, None, False
                # fall through to normal handling of this line
            else:
                index_titles.append(text)
                continue

        if in_recap or recap is not None or RECUP_RE.match(text):
            if RECUP_RE.match(text):
                close_recap()
                recap = {"title": text, "items": []}
                in_recap = True
                continue
            if in_recap and recap is not None:
                recap["items"].append(_classify_item(p, text, bold))
                continue
            close_recap()
            recap = {"title": None, "items": []}
            recap["items"].append(_classify_item(p, text, bold))
            in_recap = True
            continue

        # -- sections ---------------------------------------------------------
        sec = match_section_heading(text, bold, raw=text)
        if sec and _index_confirms(index_titles, sec["title"]):
            close_section()
            # unlabeled index blocks: an empty earlier section with the same
            # title is the index copy — fold it into section_index (rule 10)
            key = _norm_title(sec["title"])
            for i, s in enumerate(sections):
                if (_norm_title(s["title"]) == key and not s["ayah_units"]
                        and not s["intro"]):
                    sections.pop(i)
                    idx = part["section_index"] or {"header": None, "titles": []}
                    part["section_index"] = idx
                    if s["title"] not in idx["titles"]:
                        idx["titles"].append(s["title"])
                    break
            section = {"title": sec["title"], "ord": len(sections) + 1,
                       "from_ayah": sec["from_ayah"], "to_ayah": sec["to_ayah"],
                       "intro": [], "ayah_units": []}
            sections.append(section)
            continue

        # GROUP header: colon form is a section heading; em-dash form is a
        # juz-wide group header (rule 4)
        g = GROUP_RE.match(text)
        if g and ":" not in text:
            group_sink.append({"title": text, "text": "", "found_in": path.name})
            continue

        # -- ayah units --------------------------------------------------------
        tr = parse_translation_line(text, part["surah_number"])
        if tr:
            same_surah = tr["ref_surah"] in (None, part["surah_number"])
            if same_surah:
                # a same-surah translation always opens a new unit — this is
                # how translation-only ayat chain (and repeats stay in order)
                close_unit()
                unit = new_unit()
                unit["translation"] = tr
            elif unit is not None:
                # cross-surah ayah quoted inside commentary
                unit["commentary"].append(
                    {"kind": "quote", "text": tr["text"], "ref": tr["ref"]})
            elif section is not None:
                section["intro"].append(
                    {"kind": "quote", "text": tr["text"], "ref": tr["ref"]})
            else:
                front.append({"label": None, "text": f"({tr['ref']}) {tr['text']}", "items": []})
            continue
        if is_arabic(text):
            # an Arabic paragraph may carry an embedded translation line
            # (rule 5: split at the line break)
            embedded = None
            if "\n" in text:
                for k, ln in enumerate(text.split("\n")):
                    tr = parse_translation_line(ln.strip(), part["surah_number"])
                    if tr and tr["ref_surah"] in (None, part["surah_number"]):
                        embedded = (text.split("\n")[:k], tr)
                        break
            if embedded:
                close_unit()
                unit = new_unit()
                unit["arabic_lines"] = [l.strip() for l in embedded[0] if l.strip()]
                unit["translation"] = embedded[1]
                continue
            if unit is not None and (unit["commentary"] or unit["translation"]):
                # mid-unit requote: commentary kind quote (rule 8)
                unit["commentary"].append({"kind": "quote", "text": text})
            else:
                close_unit()
                unit = new_unit()
                unit["arabic_lines"].append(text)
            continue
        # a known front-matter label (Name / Period of Revelation / ...) ends
        # any open unit — it is structure, not commentary
        if unit is not None and any(
                text.lower().startswith(k.lower()) and
                (text[len(k):][:2] in (":", " -") or text[len(k):].strip() == "")
                for k in KNOWN_LABELS if len(text) >= len(k)):
            close_unit()

        # a mixed paragraph (prose/Arabic + an embedded translation line) is
        # split at the embedded line (rule 5) — only at a unit boundary;
        # inside open commentary the paragraph stays whole (lossless)
        if unit is None and "\n" in text:
            lines_ = [l.strip() for l in text.split("\n") if l.strip()]
            def _same(l):
                t = parse_translation_line(l, part["surah_number"])
                return t and t["ref_surah"] in (None, part["surah_number"])
            tr_idx = next((k for k, l in enumerate(lines_) if _same(l)), None)
            if tr_idx is not None:
                tr = parse_translation_line(lines_[tr_idx], part["surah_number"])
                close_unit()
                unit = new_unit()
                for l in lines_[:tr_idx]:
                    if is_arabic(l):
                        unit["arabic_lines"].append(l)
                    else:
                        unit["extras"].append({"kind": "pre_translation_line",
                                               "text": l})
                unit["translation"] = tr
                for l in lines_[tr_idx + 1:]:
                    unit["commentary"].append(_classify_item(p, l, bold))
                continue
        if unit is not None:
            unit["commentary"].append(_classify_item(p, text, bold))
            continue

        # -- front matter / intro ---------------------------------------------
        label = _label_of(text, bold)
        if label is not None:
            front.append({"label": label, "text": "", "items": []})
            continue
        if front:
            _append_front(front[-1], p, text, bold)
        elif section is not None:
            section["intro"].append(_classify_item(p, text, bold))
        else:
            front.append({"label": None, "text": text, "items": []})

    close_unit()
    close_section()
    close_recap()
    if index_titles is not None:
        part["section_index"] = {"header": index_header, "titles": index_titles}

    # part range + chunk flags from the CP coverage map
    row = next((c for c in cp_coverage if c["surah_number"] == part["surah_number"]), None)
    if row:
        part["from_ayah"], part["to_ayah"] = row["from_ayah"], row["to_ayah"]
    return part


def is_arabic_dua(text: str) -> bool:
    return False


def _label_of(text: str, bold: bool) -> str | None:
    t = text.strip()
    for label in KNOWN_LABELS:
        if t.lower().startswith(label.lower()):
            rest = t[len(label):]
            if rest[:2] in (":", " -") or rest.strip() == "":
                # raw label as written (rule: verbatim, not canonical form)
                return t.split(":")[0].strip() or t
    if bold and len(t) <= 60 and t.endswith(":"):
        return t.rstrip(":").strip()
    return None


def _append_front(unit: dict, p, text: str, bold: bool):
    if unit["text"]:
        unit["text"] += "\n" + text
    else:
        unit["text"] = text


def _classify_item(p, text: str, bold: bool) -> dict:
    if _label_of(text, bold) == "Lesson" or re.match(r"(?i)^Lesson\s*:", text):
        return {"kind": "lesson", "text": text}
    if re.match(r"(?i)^\s*hadith\s*:", text):
        return {"kind": "hadith", "text": text}
    if re.match(r"(?i)^\s*(also see|see also|see\s|ref|under)\b", text):
        return {"kind": "cross_ref", "text": text}
    if is_arabic(text):
        return {"kind": "quote", "text": text}
    if p.style.name.startswith("List Paragraph"):
        return {"kind": "list_item", "text": text}
    if (bold or _italic(p)) and len(text) <= 90 and not text.endswith((".", ",", ";")):
        return {"kind": "heading", "text": text}
    return {"kind": "prose", "text": text}


# ------------------------------------------------------------------ juz top

def docx_files(folder: Path) -> list[Path]:
    files = [f for f in folder.rglob("*.docx")
             if not f.name.startswith("~$")]
    # natural sort: by the leading number when the name has one
    def key(f: Path):
        m = re.match(r"\s*(\d+)", f.name)
        return (int(m.group(1)) if m else 999, f.name)
    return sorted(files, key=key)


def parse_juz(number: int, folder: Path, prev_coverage: list[dict] | None,
              next_coverage: list[dict] | None) -> dict:
    files = docx_files(folder)
    # every docx may hold surah content (combined 'CP and Surah' files exist);
    # pure CP docx yield no parts because they carry no SURAH heading
    content_files = files
    cp_file = next((f for f in files if re.search(r"(?i)\bcp\b", f.stem)), None)
    if cp_file is None:
        # fallback: the docx that is not a surah doc (no SURAH heading) is the
        # cover page — some CP file names never say "CP" (e.g. "1 - JUZ 6.docx")
        from docx import Document as _D
        for f in files:
            text = "\n".join(clean(p.text) for p in _body_items(_D(str(f)))
                             if isinstance(p, Paragraph))
            if not SURAH_HEADING_RE.search(text):
                cp_file = f
                break

    juz_rec, coverage = parse_cp(cp_file, number) if cp_file else ({
        "number": number, "folder": folder.name, "arabic_header": None,
        "arabic_header_translit": None, "arabic_header_meaning": None,
        "credits": None, "cp_text": "", "cp_header_lines": [],
        "group_headers": [], "extras": []}, [])

    parts = []
    for f in content_files:
        for part in parse_content(f, coverage, number, juz_rec["group_headers"]):
            row = next((c for c in coverage if c["surah_number"] == part["surah_number"]), None)
            if row:
                part["from_ayah"], part["to_ayah"] = row["from_ayah"], row["to_ayah"]
            if prev_coverage and part["surah_number"] in {c["surah_number"] for c in prev_coverage}:
                part["continues_from_prev_juz"] = True
            if next_coverage and part["surah_number"] in {c["surah_number"] for c in next_coverage}:
                part["continues_in_next_juz"] = True
            # duplicates: a surah appears at most once per juz. CP files that
            # embed whole surahs repeat content the standalone files also
            # carry — keep the first occurrence, record the duplicate.
            if any(p["surah_number"] == part["surah_number"] for p in parts):
                juz_rec["extras"].append(
                    {"kind": "duplicate_surah_content",
                     "text": f"{part['source_file']} (surah {part['surah_number']})"})
                continue
            parts.append(part)
    for i, part in enumerate(parts, start=1):
        part["ord"] = i

    # a part the CP does not list still gets a range: derive it from the
    # captured ayat (CP-authority rule — the body wins, v7)
    for part in parts:
        if part.get("from_ayah") is None:
            refs = [u["translation"]["from_ayah"]
                    for s in part["sections"] for u in s["ayah_units"]
                    if u.get("translation") and u["translation"].get("from_ayah")]
            tos = [u["translation"]["to_ayah"]
                   for s in part["sections"] for u in s["ayah_units"]
                   if u.get("translation") and u["translation"].get("to_ayah")]
            if refs:
                part["from_ayah"], part["to_ayah"] = min(refs), max(tos or refs)
        part.setdefault("from_ayah", 0)
        part.setdefault("to_ayah", 0)

    juz_rec["coverage"] = coverage
    coverage_check = check_coverage(juz_rec, parts, coverage)
    return {"juz": juz_rec, "coverage_check": coverage_check, "parts": parts, "anomalies": []}


def check_coverage(juz_rec: dict, parts: list[dict], coverage: list[dict]) -> dict:
    body_refs: dict[int, set[int]] = {}
    for part in parts:
        for sec in part["sections"]:
            for u in sec["ayah_units"]:
                t = u.get("translation")
                if not t:
                    continue
                s = t.get("ref_surah") or part["surah_number"]
                for a in range(t["from_ayah"] or 0, (t["to_ayah"] or 0) + 1):
                    body_refs.setdefault(s, set()).add(a)
    notes = []
    result = "pass"
    cov_surahs = {c["surah_number"] for c in coverage}
    # captured ayat of surahs this juz does not cover at all are outside-range
    for s in sorted(set(body_refs) - cov_surahs):
        result = "fail"
        notes.append(f"captured ayat of surah {s} (not in this juz's CP)")
    for c in coverage:
        s = c["surah_number"]
        got = body_refs.get(s, set())
        expected = set(range(c["from_ayah"], c["to_ayah"] + 1))
        missing_bounds = []
        if c["from_ayah"] not in got:
            missing_bounds.append(f"{s}:{c['from_ayah']}")
        if c["to_ayah"] not in got:
            missing_bounds.append(f"{s}:{c['to_ayah']}")
        outside = sorted(a for a in got if a not in expected)
        if missing_bounds or outside:
            result = "fail"
            if missing_bounds:
                notes.append(f"missing boundary ayat: {', '.join(missing_bounds)}")
            if outside:
                notes.append(f"captured outside CP range: {outside}")
    return {"result": result, "notes": " | ".join(notes)}


def parse_archive(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    folders = find_juz_folders()

    def cp_of(d: Path):
        files = docx_files(d)
        hits = [f for f in files if re.search(r"(?i)\bcp\b", f.stem)]
        if hits:
            return hits[0]
        # fallback: the docx that is not a surah doc (no SURAH heading)
        from docx import Document as _D
        for f in files:
            text = "\n".join(clean(p.text) for p in _body_items(_D(str(f)))
                             if isinstance(p, Paragraph))
            if not SURAH_HEADING_RE.search(text):
                return f
        return None

    coverages = {n: (parse_cp(cp_of(d), n)[1] if cp_of(d) else [])
                 for n, d in folders}
    for i, (n, d) in enumerate(folders):
        prev_cov = coverages[folders[i - 1][0]] if i > 0 else None
        next_cov = coverages[folders[i + 1][0]] if i + 1 < len(folders) else None
        inst = parse_juz(n, d, prev_cov, next_cov)
        out = out_dir / f"juz-{n:02d}.json"
        out.write_text(json.dumps(inst, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{out.name}: {inst['coverage_check']['result']} "
              f"({len(inst['parts'])} parts)")
