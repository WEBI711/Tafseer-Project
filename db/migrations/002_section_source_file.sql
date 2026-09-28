-- Scope sections (and their commentary) to the source docx they came from,
-- so multi-file surahs (e.g. Juz 1 and Juz 3 both covering Surah 2) coexist
-- instead of the last file wiping earlier files' content.
ALTER TABLE section ADD COLUMN IF NOT EXISTS source_file TEXT;
CREATE INDEX IF NOT EXISTS section_surah_src_idx ON section (surah_id, source_file, ord);