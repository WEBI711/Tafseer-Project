-- Tafseer AI — initial schema
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE juz (
    id      SERIAL PRIMARY KEY,
    number  INT NOT NULL UNIQUE
);

CREATE TABLE surah (
    id          SERIAL PRIMARY KEY,
    juz_id      INT REFERENCES juz(id),
    number      INT NOT NULL UNIQUE,
    name_en     TEXT,
    name_ar     TEXT,
    intro       TEXT,          -- Name / Period of Revelation / Subject & Topics
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE section (
    id          SERIAL PRIMARY KEY,
    surah_id    INT NOT NULL REFERENCES surah(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    ord         INT NOT NULL
);

CREATE TABLE ayah (
    id          SERIAL PRIMARY KEY,
    surah_id    INT NOT NULL REFERENCES surah(id) ON DELETE CASCADE,
    section_id  INT REFERENCES section(id) ON DELETE SET NULL,
    number      INT NOT NULL,
    text_ar     TEXT,
    translation TEXT,
    ord         INT NOT NULL DEFAULT 0,
    UNIQUE (surah_id, number)
);

CREATE TABLE commentary (
    id          SERIAL PRIMARY KEY,
    ayah_id     INT REFERENCES ayah(id) ON DELETE CASCADE,   -- NULL = surah-level note
    surah_id    INT NOT NULL REFERENCES surah(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    ord         INT NOT NULL DEFAULT 0,
    source_file TEXT,
    embedding   VECTOR(1536),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semantic search index (HNSW, cosine distance)
CREATE INDEX commentary_embedding_idx
    ON commentary USING hnsw (embedding vector_cosine_ops);

-- Keyword search (English full-text on content)
ALTER TABLE commentary ADD COLUMN tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX commentary_tsv_idx ON commentary USING gin (tsv);

-- Browsable tree lookups
CREATE INDEX ayah_surah_idx   ON ayah (surah_id, number);
CREATE INDEX section_surah_idx ON section (surah_id, ord);
CREATE INDEX commentary_ayah_idx ON commentary (ayah_id, ord);