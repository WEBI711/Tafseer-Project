-- Derived search layer over the structured model (FORMAT.md v7).
-- Built by `ingestion/tafseer_ingest/build_search.py` from part / section /
-- ayah_unit / commentary_item; safe to truncate and rebuild any time.
--
-- Naming: the structured model owns `section`; the search layer therefore
-- denormalizes the section title onto each ayah instead of a second table
-- with that name.
--
-- These three tables are fully derived: re-running this migration drops and
-- recreates them. 001/003 may recreate older shapes earlier in the sequence;
-- this file has the final say.
DROP TABLE IF EXISTS commentary CASCADE;
DROP TABLE IF EXISTS ayah CASCADE;
DROP TABLE IF EXISTS surah CASCADE;

CREATE TABLE surah (
    id      SERIAL PRIMARY KEY,
    number  INT NOT NULL UNIQUE,
    name_en TEXT NOT NULL
);

CREATE TABLE ayah (
    id            SERIAL PRIMARY KEY,
    surah_id      INT NOT NULL REFERENCES surah(id) ON DELETE CASCADE,
    number        INT NOT NULL,
    text_ar       TEXT,
    translation   TEXT,
    section_title TEXT,
    UNIQUE (surah_id, number)
);

CREATE TABLE commentary (
    id          SERIAL PRIMARY KEY,
    ayah_id     INT REFERENCES ayah(id) ON DELETE CASCADE,   -- NULL = surah-level note
    surah_id    INT NOT NULL REFERENCES surah(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'prose',
    ord         INT NOT NULL DEFAULT 0,
    source_file TEXT,
    juz         INT,
    embedding   VECTOR(1536),
    tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS commentary_embedding_idx
    ON commentary USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS commentary_tsv_idx ON commentary USING gin (tsv);
CREATE INDEX IF NOT EXISTS commentary_juz_idx ON commentary (juz);
CREATE INDEX IF NOT EXISTS commentary_ayah_idx ON commentary (ayah_id, ord);
CREATE INDEX IF NOT EXISTS commentary_surah_idx ON commentary (surah_id);
CREATE INDEX IF NOT EXISTS ayah_surah_idx ON ayah (surah_id, number);