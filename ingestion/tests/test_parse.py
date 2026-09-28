"""Parser regression tests. Run: python tests/test_parse.py (from ingestion/).

Guards the two data-integrity bugs found in the first full ingest:
  1. an ayah must never inherit a neighbouring verse's Arabic text
  2. font-artifact codepoints (private use area, invisible marks) must be dropped
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docx import Document  # noqa: E402

from tafseer_ingest.parse import parse_docx  # noqa: E402

AYAH_1_AR = "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ"
AYAH_2_AR = "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"


def build_docx() -> Path:
    doc = Document()
    for line in [
        "JUZ 1",
        "SURAH 1 – AL FATIHAH",
        "GROUP 1: THE OPENING",
        AYAH_1_AR,
        "(1:1) In the name of Allah, the Most Merciful.",
        "Commentary on the first ayah.",
        # ayah 2 has a translation but (like the real docs) no Arabic quoted
        # next to it — so it must stay blank rather than reuse ayah 1's text.
        "(1:2) All praise belongs to Allah.",
        "Commentary on the second ayah.",
        # artifact characters the author's Word fonts left behind
        f"GROUP 2: ARTIFACTS",
        f"{AYAH_2_AR}\ue01e\u200b",
        "(1:3) The Most Merciful.",
    ]:
        doc.add_paragraph(line)
    path = Path(tempfile.mkdtemp()) / "sample.docx"
    doc.save(str(path))
    return path


def build_muqattaat_docx() -> Path:
    """Surah 20 style opening: the disjoined letters are the whole verse text."""
    doc = Document()
    for line in ["JUZ 16", "SURAH 20 – TA HA", "GROUP 1: THE OPENING", "طه", "(20:1) Ta' Ha'"]:
        doc.add_paragraph(line)
    path = Path(tempfile.mkdtemp()) / "muqattaat.docx"
    doc.save(str(path))
    return path


def build_mixed_fragment_docx() -> Path:
    """A short line that is NOT all-Arabic (one stray glyph + a Latin letter).

    The disjoined-letter rule requires fragments under 3 letters to be entirely
    Arabic; a mixed fragment must fall through to commentary, never verse text.
    """
    doc = Document()
    for line in [
        "JUZ 16",
        "SURAH 20 – TA HA",
        "GROUP 1: THE OPENING",
        AYAH_1_AR,
        "(20:1) Ta' Ha'",
        "Commentary on the first ayah.",
        # stray font-artifact glyph next to a Latin letter: under the old ratio
        # rule (arabic/letters > 0.5) this classified as Arabic verse text
        "بA",
        "(20:2) Commentary verse.",
    ]:
        doc.add_paragraph(line)
    path = Path(tempfile.mkdtemp()) / "mixed_fragment.docx"
    doc.save(str(path))
    return path


def main() -> int:
    from tafseer_ingest.parse import is_arabic

    # the short-fragment rule itself: all-Arabic stays verse text, one
    # non-Arabic letter rejects the fragment (the old ratio test passed it)
    assert is_arabic("حم"), "all-Arabic fragment must stay verse text"
    assert not is_arabic("بA"), "mixed 2-letter fragment must not be verse text"
    parsed = parse_docx(build_docx())
    ayahs = {a["number"]: a for s in parsed["surahs"] for sec in s["sections"] for a in sec["ayahs"]}

    assert ayahs[1]["text_ar"] == AYAH_1_AR, ayahs[1]["text_ar"]
    assert ayahs[2]["text_ar"] is None, f"ayah 2 inherited {ayahs[2]['text_ar']!r}"
    assert ayahs[3]["text_ar"] == AYAH_2_AR, ayahs[3]["text_ar"]
    assert ayahs[2]["translation"].startswith("All praise"), ayahs[2]
    assert ayahs[1]["commentary"] == ["Commentary on the first ayah."], ayahs[1]["commentary"]

    # disjoined-letter openings must be read as verse text, not prose
    solo = parse_docx(build_muqattaat_docx())
    solo_ayahs = {
        a["number"]: a for s in solo["surahs"] for sec in s["sections"] for a in sec["ayahs"]
    }
    assert solo_ayahs[1]["text_ar"] == "طه", solo_ayahs[1]
    assert solo_ayahs[1]["commentary"] == [], solo_ayahs[1]

    # a stray mixed short line is commentary, and never verse text for the
    # next ayah (the false positive the all-Arabic rule guards against)
    mixed = parse_docx(build_mixed_fragment_docx())
    mixed_ayahs = {
        a["number"]: a for s in mixed["surahs"] for sec in s["sections"] for a in sec["ayahs"]
    }
    assert mixed_ayahs[2]["text_ar"] is None, mixed_ayahs[2]
    assert "بA" in mixed_ayahs[1]["commentary"], mixed_ayahs[1]

    blob = "".join(
        [a["text_ar"] or "" for a in ayahs.values()]
        + [c for a in ayahs.values() for c in a["commentary"]]
    )
    bad = [hex(ord(ch)) for ch in blob if 0xE000 <= ord(ch) <= 0xF8FF or ch in "\u200b\u200f"]
    assert not bad, f"artifact codepoints survived: {bad}"

    print("parse.py regression tests: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())