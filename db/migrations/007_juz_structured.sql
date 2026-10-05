-- Per-juz structured model (FORMAT.md v7). Drops the legacy flat-stream
-- tables; the docx -> doc_block pipeline they served is replaced by the
-- structured parser and loader in ingestion/.

DROP TABLE IF EXISTS doc_block CASCADE;
DROP TABLE IF EXISTS commentary CASCADE;
DROP TABLE IF EXISTS ayah CASCADE;
DROP TABLE IF EXISTS section CASCADE;
DROP TABLE IF EXISTS surah CASCADE;
DROP TABLE IF EXISTS source_doc CASCADE;
DROP TABLE IF EXISTS juz CASCADE;

CREATE EXTENSION IF NOT EXISTS vector;  -- kept for the later search bolt-on

-- One juz: metadata from its cover page (CP) plus verbatim CP text.
CREATE TABLE juz (
    id                      SERIAL PRIMARY KEY,
    number                  INT NOT NULL UNIQUE,
    folder                  TEXT NOT NULL,
    arabic_header           TEXT,
    arabic_header_translit  TEXT,
    arabic_header_meaning   TEXT,
    credits                 TEXT,
    cp_text                 TEXT NOT NULL,
    cp_header_lines         JSONB NOT NULL DEFAULT '[]',
    group_headers           JSONB NOT NULL DEFAULT '[]',
    extras                  JSONB NOT NULL DEFAULT '[]'
);

-- The CP's authoritative surah -> ayah-range map for this juz.
CREATE TABLE juz_coverage (
    id            SERIAL PRIMARY KEY,
    juz_id        INT NOT NULL REFERENCES juz(id) ON DELETE CASCADE,
    surah_number  INT NOT NULL,
    name_en       TEXT,
    from_ayah     INT NOT NULL,
    to_ayah       INT NOT NULL,
    UNIQUE (juz_id, surah_number)
);

-- One content docx inside a juz: a full surah or a juz-chunk of one.
CREATE TABLE part (
    id                        SERIAL PRIMARY KEY,
    juz_id                    INT NOT NULL REFERENCES juz(id) ON DELETE CASCADE,
    surah_number              INT NOT NULL,
    name_en                   TEXT,
    from_ayah                 INT NOT NULL,
    to_ayah                   INT NOT NULL,
    continues_from_prev_juz   BOOLEAN NOT NULL DEFAULT false,
    continues_in_next_juz     BOOLEAN NOT NULL DEFAULT false,
    source_file               TEXT NOT NULL,
    ord                       INT NOT NULL,
    bismillah                 TEXT,
    juz_banner                TEXT,
    chunk_marker              TEXT,
    section_index             JSONB,
    extras                    JSONB NOT NULL DEFAULT '[]'
    -- a combined "CP and Surah" file may hold several parts; identity is (juz_id, ord)
);

-- Front matter: labeled prose units (Name / Period of Revelation / ...).
-- label may be NULL for unlabeled part-level intro prose.
CREATE TABLE front_matter_unit (
    id       SERIAL PRIMARY KEY,
    part_id  INT NOT NULL REFERENCES part(id) ON DELETE CASCADE,
    ord      INT NOT NULL,
    label    TEXT,
    text     TEXT,
    items    JSONB NOT NULL DEFAULT '[]'
);

-- "GROUP n: TITLE" / "n-m TITLE" / single-number / inverted / VERSES forms.
-- intro holds typed {kind, text} items; ayah_units may be empty (valid).
CREATE TABLE section (
    id         SERIAL PRIMARY KEY,
    part_id    INT NOT NULL REFERENCES part(id) ON DELETE CASCADE,
    ord        INT NOT NULL,
    title      TEXT NOT NULL,
    from_ayah  INT,
    to_ayah    INT,
    intro      JSONB NOT NULL DEFAULT '[]'
);

-- One ayah's block inside a section: arabic lines, its translation, extras.
-- translation is NULL for translation-less preamble units.
CREATE TABLE ayah_unit (
    id             SERIAL PRIMARY KEY,
    section_id     INT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
    ord            INT NOT NULL,
    arabic_lines   JSONB NOT NULL DEFAULT '[]',
    translation    JSONB,
    extras         JSONB NOT NULL DEFAULT '[]'
);

-- Commentary pieces, one row each (fine-grained for a later search bolt-on).
CREATE TABLE commentary_item (
    id            SERIAL PRIMARY KEY,
    ayah_unit_id  INT NOT NULL REFERENCES ayah_unit(id) ON DELETE CASCADE,
    ord           INT NOT NULL,
    kind          TEXT NOT NULL,   -- prose|heading|lesson|hadith|list_item
                                   -- |cross_ref|quote|arabic|translation
    text          TEXT NOT NULL,
    ref           TEXT
);

-- End matter: "BEAUTIFUL DIVISION…", "MY KEY TAKEAWAYS", untitled blocks.
CREATE TABLE recap (
    id       SERIAL PRIMARY KEY,
    part_id  INT NOT NULL REFERENCES part(id) ON DELETE CASCADE,
    ord      INT NOT NULL,
    title    TEXT,
    items    JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX part_juz_idx          ON part (juz_id, ord);
CREATE INDEX part_surah_idx        ON part (surah_number, juz_id, ord);
CREATE INDEX section_part_idx      ON section (part_id, ord);
CREATE INDEX ayah_unit_section_idx ON ayah_unit (section_id, ord);
CREATE INDEX commentary_unit_idx   ON commentary_item (ayah_unit_id, ord);
CREATE INDEX front_matter_part_idx ON front_matter_unit (part_id, ord);
CREATE INDEX recap_part_idx        ON recap (part_id, ord);
