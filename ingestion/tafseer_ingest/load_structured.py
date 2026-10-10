"""Load structured per-juz JSON (FORMAT.md v7) into the new Postgres schema.

Reads the parser output (ingestion/build/juz-NN.json) and fills
juz / juz_coverage / part / front_matter_unit / section / ayah_unit /
commentary_item / recap. Idempotent per juz: the juz row is deleted and
re-inserted.

    python -m tafseer_ingest.load_structured             # parse + load all juz
    python -m tafseer_ingest.load_structured 3 17        # selected juz only
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from .structured import find_juz_folders, parse_juz

load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tafseer:tafseer@localhost:5433/tafseer")
BUILD_DIR = Path(__file__).resolve().parents[1] / "build"


def build_instance(juz_number: int) -> dict:
    """Parse a juz from the archive, reusing a saved build when present."""
    cached = BUILD_DIR / f"juz-{juz_number:02d}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    folders = dict(find_juz_folders())
    if juz_number not in folders:
        raise SystemExit(f"no juz {juz_number} folder in source/Archive")
    return parse_juz(juz_number, folders[juz_number], None, None)


def load_juz(conn: psycopg.Connection, inst: dict) -> dict:
    """Insert one juz instance. Returns row counts."""
    jz = inst["juz"]
    counts = {"parts": 0, "sections": 0, "units": 0, "commentary": 0}
    with conn.cursor() as cur:
        cur.execute("DELETE FROM juz WHERE number = %s", (jz["number"],))
        cur.execute(
            """INSERT INTO juz (number, folder, arabic_header, arabic_header_translit,
                 arabic_header_meaning, credits, cp_text, cp_header_lines,
                 group_headers, extras)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (jz["number"], jz["folder"], jz["arabic_header"],
             jz["arabic_header_translit"], jz["arabic_header_meaning"],
             jz["credits"], jz["cp_text"],
             json.dumps(jz.get("cp_header_lines") or []),
             json.dumps(jz.get("group_headers") or []),
             json.dumps(jz.get("extras") or [])))
        juz_id = cur.fetchone()[0]

        for cov in jz.get("coverage") or []:
            cur.execute(
                """INSERT INTO juz_coverage (juz_id, surah_number, name_en, from_ayah, to_ayah)
                   VALUES (%s,%s,%s,%s,%s)""",
                (juz_id, cov["surah_number"], cov["name_en"],
                 cov["from_ayah"], cov["to_ayah"]))

        # Stored ord must match reading order, not source-file order: juz 30's
        # files arrived out of sequence (#31). Ascending (surah, from_ayah) is
        # correct for every juz — continued surahs still sort within their juz.
        parts = sorted(inst["parts"], key=lambda p: (p["surah_number"], p["from_ayah"]))
        for ord_, part in enumerate(parts, start=1):
            cur.execute(
                """INSERT INTO part (juz_id, surah_number, name_en, from_ayah, to_ayah,
                     continues_from_prev_juz, continues_in_next_juz, source_file, ord,
                     bismillah, juz_banner, chunk_marker, section_index, extras)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (juz_id, part["surah_number"], part["name_en"], part["from_ayah"],
                 part["to_ayah"], part["continues_from_prev_juz"],
                 part["continues_in_next_juz"], part["source_file"], ord_,
                 part["bismillah"], part["juz_banner"], part["chunk_marker"],
                 json.dumps(part.get("section_index")),
                 json.dumps(part.get("extras") or [])))
            part_id = cur.fetchone()[0]
            counts["parts"] += 1

            for ord_, fm in enumerate(part.get("front_matter") or [], start=1):
                cur.execute(
                    """INSERT INTO front_matter_unit (part_id, ord, label, text, items)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (part_id, ord_, fm.get("label"), fm.get("text"),
                     json.dumps(fm.get("items") or [])))

            for sec in part.get("sections") or []:
                cur.execute(
                    """INSERT INTO section (part_id, ord, title, from_ayah, to_ayah, intro)
                       VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (part_id, sec["ord"], sec["title"], sec.get("from_ayah"),
                     sec.get("to_ayah"), json.dumps(sec.get("intro") or [])))
                sec_id = cur.fetchone()[0]
                counts["sections"] += 1

                for ord_, unit in enumerate(sec.get("ayah_units") or [], start=1):
                    tr = unit.get("translation")
                    cur.execute(
                        """INSERT INTO ayah_unit (section_id, ord, arabic_lines,
                             translation, extras)
                           VALUES (%s,%s,%s,%s,%s) RETURNING id""",
                        (sec_id, ord_,
                         json.dumps(unit.get("arabic_lines") or []),
                         json.dumps(tr), json.dumps(unit.get("extras") or [])))
                    unit_id = cur.fetchone()[0]
                    counts["units"] += 1

                    for ord_, item in enumerate(unit.get("commentary") or [], start=1):
                        cur.execute(
                            """INSERT INTO commentary_item
                               (ayah_unit_id, ord, kind, text, ref)
                               VALUES (%s,%s,%s,%s,%s)""",
                            (unit_id, ord_, item["kind"], item["text"], item.get("ref")))
                        counts["commentary"] += 1

            for ord_, recap in enumerate(part.get("recaps") or [], start=1):
                cur.execute(
                    """INSERT INTO recap (part_id, ord, title, items)
                       VALUES (%s,%s,%s,%s)""",
                    (part_id, ord_, recap.get("title"),
                     json.dumps(recap.get("items") or [])))
    conn.commit()
    return counts


def main(argv: list[str]):
    numbers = [int(a) for a in argv] or [n for n, _ in find_juz_folders()]
    with psycopg.connect(DATABASE_URL) as conn:
        for n in numbers:
            inst = build_instance(n)
            counts = load_juz(conn, inst)
            print(f"juz {n:02d}: {counts['parts']} parts, {counts['sections']} sections, "
                  f"{counts['units']} ayah units, {counts['commentary']} commentary items")


if __name__ == "__main__":
    main(sys.argv[1:])