"""Build the derived search layer (surah / ayah / commentary) from the
structured model, then embed the commentary.

Reads only what `load_structured.py` wrote; truncates and rebuilds the
search tables. Embedding goes through the same OpenAI-compatible gateway
the loader uses (ingestion/.env). Run with `--no-embed` to build without
embeddings (keyword search only).
"""
from __future__ import annotations

import re
import sys

import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

from .load import embed_texts

load_dotenv(override=True)

# "2:204 , 205 and 206" -> 204, 205, 206.  "253" -> 253 (same surah).
NUM = re.compile(r"\d+")


def ayah_numbers(ref: str, surah_number: int) -> list[int]:
    """Ayah numbers a unit covers, from its translation ref."""
    body = ref.split(":", 1)[1] if ":" in ref else ref
    nums = [int(n) for n in NUM.findall(body)]
    return nums or []


def build_search(embed: bool) -> dict:
    conn = psycopg.connect(
        __import__("os").getenv("DATABASE_URL", "postgresql://tafseer:tafseer@localhost:5433/tafseer"),
        autocommit=False,
    )
    register_vector(conn)
    stats = {"surah": 0, "ayah": 0, "ayah_notes": 0, "surah_notes": 0, "embedded": 0, "unembedded": 0}

    with conn.cursor() as cur:
        cur.execute("TRUNCATE commentary, ayah, surah RESTART IDENTITY CASCADE")

        # One search row per (surah, number); the first part to mention an ayah
        # wins the arabic/translation (they are the same text across parts).
        surah_ids: dict[int, int] = {}
        ayah_ids: dict[tuple[int, int], int] = {}
        pending: list[tuple[int, str]] = []  # (commentary id, content) to embed

        rows = cur.execute(
            """SELECT p.id, p.surah_number, p.name_en, p.source_file, j.number
               FROM part p JOIN juz j ON j.id = p.juz_id
               ORDER BY j.number, p.ord"""
        ).fetchall()

        with conn.cursor() as cur, conn.cursor() as inner:
          for part_id, surah_number, name_en, source_file, juz in cur.execute(
              """SELECT p.id, p.surah_number, p.name_en, p.source_file, j.number
                 FROM part p JOIN juz j ON j.id = p.juz_id
                 ORDER BY j.number, p.ord"""
          ).fetchall():
            sid = surah_ids.get(surah_number)
            if sid is None:
                sid = cur.execute(
                    "INSERT INTO surah (number, name_en) VALUES (%s, %s) RETURNING id",
                    (surah_number, name_en or f"Surah {surah_number}"),
                ).fetchone()[0]
                surah_ids[surah_number] = sid
                stats["surah"] += 1

            # Surah-level notes: front matter (intro prose) and recap (takeaways).
            for label, text, items in cur.execute(
                "SELECT label, text, items FROM front_matter_unit WHERE part_id = %s ORDER BY ord",
                (part_id,),
            ).fetchall():
                content = join_note(label, text, items)
                if content:
                    insert_commentary(inner, None, sid, content, "prose", source_file, juz, pending)
                    stats["surah_notes"] += 1
            for title, items in cur.execute(
                "SELECT title, items FROM recap WHERE part_id = %s ORDER BY ord",
                (part_id,),
            ).fetchall():
                content = join_note(title, None, items)
                if content:
                    insert_commentary(inner, None, sid, content, "prose", source_file, juz, pending)
                    stats["surah_notes"] += 1

            for sec_id, sec_title in cur.execute(
                "SELECT id, title FROM section WHERE part_id = %s ORDER BY ord",
                (part_id,),
            ).fetchall():
              for unit_id, arabic_lines, translation in cur.execute(
                  "SELECT id, arabic_lines, translation FROM ayah_unit WHERE section_id = %s ORDER BY ord",
                  (sec_id,),
              ).fetchall():
                if not translation:
                    # Arabic-only unit (Bismillah, preamble): no ayah to attach
                    # to, but its commentary is still real notes -> surah-level.
                    for item_ord, kind, text in inner.execute(
                        "SELECT ord, kind, text FROM commentary_item WHERE ayah_unit_id = %s ORDER BY ord",
                        (unit_id,),
                    ).fetchall():
                        insert_commentary(inner, None, sid, text, kind, source_file, juz, pending)
                        stats["surah_notes"] += 1
                    continue
                ref = translation["ref"]
                text_ar = "\n".join(arabic_lines or [])
                nums = ayah_numbers(ref, surah_number)
                ayah_row_ids = []
                for n in nums:
                    aid = ayah_ids.get((sid, n))
                    if aid is None:
                        aid = inner.execute(
                            """INSERT INTO ayah (surah_id, number, text_ar, translation, section_title)
                               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                            (sid, n, text_ar, translation["text"], sec_title),
                        ).fetchone()[0]
                        ayah_ids[(sid, n)] = aid
                        stats["ayah"] += 1
                    ayah_row_ids.append(aid)

                for item_ord, kind, text in inner.execute(
                    "SELECT ord, kind, text FROM commentary_item WHERE ayah_unit_id = %s ORDER BY ord",
                    (unit_id,),
                ).fetchall():
                    # A unit may cover several ayat; the note attaches to each.
                    for aid in ayah_row_ids:
                        insert_commentary(inner, aid, sid, text, kind, source_file, juz, pending)
                        stats["ayah_notes"] += 1

        conn.commit()

        if embed and pending:
            # The gateway rejects empty strings; those rows stay keyword-less.
            embeddable = [(cid, t) for cid, t in pending if t.strip()]
            texts = [t for _, t in embeddable]
            vectors = embed_texts(texts)
            done = 0
            for (cid, _), vec in zip(embeddable, vectors):
                if vec is None:
                    continue
                cur.execute("UPDATE commentary SET embedding = %s WHERE id = %s", (vec, cid))
                done += 1
            conn.commit()
            stats["embedded"] = done
            stats["unembedded"] = len(pending) - done

    conn.close()
    return stats


def join_note(label, text, items) -> str:
    """Verbatim note text: the prose body, optionally labeled, plus list items."""
    parts = []
    if label and text:
        parts.append(f"{label}: {text}")
    elif text:
        parts.append(text)
    elif label:
        parts.append(label)
    for it in items or []:
        parts.append(it["text"])
    return "\n".join(p for p in parts if p).strip()


def insert_commentary(cur, ayah_id, surah_id, content, kind, source_file, juz, pending) -> int:
    # ord = the row id: insertion order is stable because we insert in walk order.
    cid = cur.execute(
        """INSERT INTO commentary (ayah_id, surah_id, content, kind, ord, source_file, juz)
           VALUES (%s, %s, %s, %s, DEFAULT, %s, %s) RETURNING id""",
        (ayah_id, surah_id, content, kind, source_file, juz),
    ).fetchone()[0]
    pending.append((cid, content))
    return cid


def main(argv: list[str]) -> int:
    embed = "--no-embed" not in argv
    stats = build_search(embed)
    print(stats)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))