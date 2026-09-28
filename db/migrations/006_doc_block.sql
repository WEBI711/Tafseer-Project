-- The source document itself, paragraph by paragraph, in order.
--
-- The ayah/section/commentary tables are a derived view built for search and
-- citation; they lose structure (per-file front matter, sub-headings, list
-- items, unquoted Arabic). This table keeps the document as the author wrote it
-- so the reader can show the source structure rather than our guess at it.
CREATE TABLE IF NOT EXISTS doc_block (
    id            SERIAL PRIMARY KEY,
    source_file   TEXT NOT NULL,
    juz           INT,
    surah_number  INT,
    ord           INT NOT NULL,
    kind          TEXT NOT NULL,   -- juz_header | surah_header | section_heading
                                   -- | heading | list_item | arabic
                                   -- | translation | prose
    text          TEXT NOT NULL,
    ref_surah     INT,             -- for kind = translation
    ref_ayah      INT,
    -- the reader's fidelity invariants, enforced by the database itself:
    -- one row per position within a file, and only the roles the parser emits.
    CONSTRAINT doc_block_file_ord_unique UNIQUE (source_file, ord),
    CONSTRAINT doc_block_kind_check CHECK (kind IN (
        'juz_header', 'surah_header', 'section_heading', 'heading',
        'list_item', 'arabic', 'translation', 'prose'))
);

CREATE INDEX IF NOT EXISTS doc_block_file_idx  ON doc_block (source_file, ord);
CREATE INDEX IF NOT EXISTS doc_block_surah_idx ON doc_block (surah_number, juz, source_file, ord);
