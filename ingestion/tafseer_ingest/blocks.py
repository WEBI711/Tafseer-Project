"""Refresh doc_block only — the reader's source of truth — without embedding.

Use this when the document structure changed (parser fix, new source files):
it re-parses the archive and rewrites the blocks, leaving ayah/section/
commentary rows and their embeddings untouched. The full pipeline
(`python -m tafseer_ingest.load <dir>`) does the same plus the derived tables and
embeddings, and re-embeds every commentary row it rewrites.

    python -m tafseer_ingest.blocks ../source/Archive
"""
from __future__ import annotations

import sys

import psycopg

from .load import DATABASE_URL, store_blocks
from .parse import parse_directory


def refresh(data_dir: str) -> dict:
    docs = parse_directory(data_dir)
    blocks = 0
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            for doc in docs:
                blocks += store_blocks(cur, doc)
        conn.commit()
    return {"files": len(docs), "blocks": blocks}


if __name__ == "__main__":
    print(refresh(sys.argv[1] if len(sys.argv) > 1 else "../source/Archive"))
