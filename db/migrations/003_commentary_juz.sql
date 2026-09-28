-- Query-mode grouping needs the juz a commentary passage was written under
-- (a surah spans several juz; surah.juz_id is only its first juz).
ALTER TABLE commentary ADD COLUMN IF NOT EXISTS juz INT;
CREATE INDEX IF NOT EXISTS commentary_juz_idx ON commentary (juz);