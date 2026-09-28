"""Source-fidelity check: does the database hold the documents as written?

For every docx in the archive it compares, in order, the paragraphs and tables of
the file against its `doc_block` rows. This is the acceptance test for the
reader's content: the app is supposed to show the source, not our reading of it.

    cd ingestion && .venv/bin/python tests/verify_source_fidelity.py [archive_dir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import psycopg  # noqa: E402
from docx import Document  # noqa: E402
from docx.table import Table  # noqa: E402
from docx.text.paragraph import Paragraph  # noqa: E402

from tafseer_ingest.load import DATABASE_URL  # noqa: E402
from tafseer_ingest.parse import _body_items, _table_text, clean  # noqa: E402


def source_items(path: Path) -> list[str]:
    """Every body item of the docx, in order, as it is stored."""
    out: list[str] = []
    for item in _body_items(Document(str(path))):
        if isinstance(item, Table):
            out.append(_table_text(item))
        elif isinstance(item, Paragraph) and clean(item.text):
            out.append(clean(item.text))
    return out


def main() -> int:
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "../source/Archive")
    files = sorted(p for p in data_dir.rglob("*.docx") if not p.name.startswith("~$"))

    mismatched: list[tuple[str, int, int, int | None]] = []
    blocks_total = 0
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            for f in files:
                expected = source_items(f)
                cur.execute(
                    "SELECT text FROM doc_block WHERE source_file = %s ORDER BY ord",
                    (f.name,),
                )
                stored = [r[0] for r in cur.fetchall()]
                blocks_total += len(stored)
                if stored != expected:
                    first = next(
                        (
                            i
                            for i, (a, b) in enumerate(zip(expected, stored))
                            if a != b
                        ),
                        None,
                    )
                    mismatched.append((f.name, len(expected), len(stored), first))

            cur.execute(
                """SELECT count(*), count(*) FILTER (WHERE embedding IS NOT NULL)
                   FROM commentary"""
            )
            commentary, embedded = cur.fetchone()
            cur.execute("SELECT count(*) FROM doc_block")
            db_blocks = cur.fetchone()[0]

    print(f"source files compared : {len(files)}")
    print(f"files identical to source: {len(files) - len(mismatched)}")
    print(f"blocks stored         : {db_blocks} (parsed {blocks_total})")
    print(f"commentary embedded   : {embedded}/{commentary}")

    if mismatched:
        print("\nMISMATCHES (file, source items, stored blocks, first difference):")
        for name, n_src, n_db, first in mismatched[:10]:
            print(f"  {name}: source={n_src} stored={n_db} first diff at {first}")
        return 1

    print("\nsource fidelity: OK — every file matches its docx in order and content")
    if commentary and embedded < commentary:
        print(
            f"note: {commentary - embedded} commentary rows have no embedding; "
            "vector search will not see them (re-run the loader with a key set)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
