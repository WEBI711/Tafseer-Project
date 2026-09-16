"""Load parsed JSON into Postgres. Idempotent per source file."""
from __future__ import annotations

import os

import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

load_dotenv(override=True)  # .env wins over any shell-exported OPENAI_API_KEY

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tafseer:tafseer@localhost:5433/tafseer")
EMBED_DIM = 1536


def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Embed via an OpenAI-compatible API (OpenAI, OpenRouter, etc.)."""
    key = os.getenv("OPENAI_API_KEY")
    if not key or not texts:
        return [None] * len(texts)
    from openai import OpenAI

    client = OpenAI(
        api_key=key,
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )
    resp = client.embeddings.create(
        model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"), input=texts
    )
    return [d.embedding for d in resp.data]


def load_docs(docs: list[dict]) -> dict:
    """Upsert parsed documents. Returns counts."""
    # collect all commentary texts for one batched embedding call
    pending: list[tuple[int, str]] = []  # (index into insert list, text)
    stats = {"juz": set(), "surah": 0, "section": 0, "ayah": 0, "commentary": 0}

    with psycopg.connect(DATABASE_URL) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for doc in docs:
                juz = doc.get("juz")
                if juz:
                    cur.execute(
                        "INSERT INTO juz (number) VALUES (%s) ON CONFLICT (number) DO NOTHING",
                        (juz,),
                    )
                    stats["juz"].add(juz)

                for surah in doc["surahs"]:
                    cur.execute(
                        """
                        INSERT INTO surah (number, name_en, intro)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (number) DO UPDATE
                            SET name_en = EXCLUDED.name_en, intro = EXCLUDED.intro
                        RETURNING id
                        """,
                        (surah["number"], surah["name_en"], "\n\n".join(surah["intro"]) or None),
                    )
                    surah_id = cur.fetchone()[0]
                    stats["surah"] += 1

                    # surah-level notes (sections without ayat keep notes too)
                    cur.execute("DELETE FROM section WHERE surah_id = %s", (surah_id,))
                    cur.execute(
                        "DELETE FROM commentary WHERE surah_id = %s", (surah_id,)
                    )

                    for s_ord, section in enumerate(surah["sections"]):
                        cur.execute(
                            """
                            INSERT INTO section (surah_id, title, ord) VALUES (%s, %s, %s)
                            RETURNING id
                            """,
                            (surah_id, section["title"], s_ord),
                        )
                        section_id = cur.fetchone()[0]
                        stats["section"] += 1

                        for n_ord, note in enumerate(section.get("notes", [])):
                            cur.execute(
                                """
                                INSERT INTO commentary (surah_id, content, ord, source_file)
                                VALUES (%s, %s, %s, %s) RETURNING id
                                """,
                                (surah_id, note, n_ord, doc["source_file"]),
                            )
                            pending.append((cur.fetchone()[0], note))
                            stats["commentary"] += 1

                        for a_ord, ayah in enumerate(section["ayahs"]):
                            cur.execute(
                                """
                                INSERT INTO ayah (surah_id, section_id, number, text_ar, translation, ord)
                                VALUES (%s, %s, %s, %s, %s, %s)
                                ON CONFLICT (surah_id, number) DO UPDATE
                                    SET text_ar = EXCLUDED.text_ar,
                                        translation = EXCLUDED.translation,
                                        section_id = EXCLUDED.section_id
                                RETURNING id
                                """,
                                (
                                    surah_id,
                                    section_id,
                                    ayah["number"],
                                    ayah["text_ar"],
                                    ayah["translation"],
                                    a_ord,
                                ),
                            )
                            ayah_id = cur.fetchone()[0]
                            stats["ayah"] += 1

                            for c_ord, content in enumerate(ayah["commentary"]):
                                cur.execute(
                                    """
                                    INSERT INTO commentary (ayah_id, surah_id, content, ord, source_file)
                                    VALUES (%s, %s, %s, %s, %s) RETURNING id
                                    """,
                                    (ayah_id, surah_id, content, c_ord, doc["source_file"]),
                                )
                                pending.append((cur.fetchone()[0], content))
                                stats["commentary"] += 1
        conn.commit()

    # batch-embed then update (non-fatal: rows are already loaded)
    if pending and os.getenv("OPENAI_API_KEY"):
        try:
            vectors = embed_texts([t for _, t in pending])
        except Exception as e:
            print(f"WARNING: embedding skipped ({e.__class__.__name__}: {str(e)[:120]})")
            vectors = [None] * len(pending)
        with psycopg.connect(DATABASE_URL) as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                for (row_id, _), vec in zip(pending, vectors):
                    if vec is not None:
                        cur.execute(
                            "UPDATE commentary SET embedding = %s WHERE id = %s", (vec, row_id)
                        )
                conn.commit()

    stats["juz"] = sorted(stats["juz"])
    return stats


if __name__ == "__main__":
    import sys

    from .parse import parse_directory

    data_dir = sys.argv[1] if len(sys.argv) > 1 else "../data"
    docs = parse_directory(data_dir)
    print(load_docs(docs))