-- Provenance table: which juz a source docx belongs to.
-- Sections carry source_file, so this is what lets the explorer place a surah
-- under every juz it actually covers (Surah 2 spans Juz 1-3) instead of only
-- the juz where it starts.
CREATE TABLE IF NOT EXISTS source_doc (
    source_file TEXT PRIMARY KEY,
    juz         INT NOT NULL
);

INSERT INTO source_doc (source_file, juz)
SELECT source_file, min(juz)
FROM commentary
WHERE source_file IS NOT NULL AND juz IS NOT NULL
GROUP BY source_file
ON CONFLICT (source_file) DO UPDATE SET juz = EXCLUDED.juz;

CREATE INDEX IF NOT EXISTS source_doc_juz_idx ON source_doc (juz);