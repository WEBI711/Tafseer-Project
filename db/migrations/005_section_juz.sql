-- The juz of a section is the juz of the docx it came from; denormalised on
-- section so the explorer does not need a join for the common query.
ALTER TABLE section ADD COLUMN IF NOT EXISTS juz INT;

UPDATE section sec
SET juz = sd.juz
FROM source_doc sd
WHERE sd.source_file = sec.source_file AND sec.juz IS NULL;

CREATE INDEX IF NOT EXISTS section_juz_idx ON section (juz);