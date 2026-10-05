# Juz-level document structure (extracted so far)

Reference for issue #9 follow-up: replace the one-pass, blanket ingestion with a
per-juz structured format. This doc records the structure observed in the source
archive, starting with Juz 1. Evidence lives in `source/Archive/Juz 1/`.

## The archive layout

`source/Archive/` is organized exactly as we want to model it:

```
source/Archive/
├── Intro to the Quran/        (front matter, outside the 30 juz)
├── Juz 1/                     (30 folders, one per juz; mixed case: "JUZ 26", "JUz 8")
│   ├── 1 - JUZ 1 CP.docx      (juz cover page)
│   ├── 2 - Juz 1 Surah 1 Fat.docx
│   └── 3 - JUz 1 Surah 2 .docx
└── JUZ 30/                    (cover + one docx per short surah, 78–114)
```

One folder per juz. Inside, one docx per unit: a cover page, then one docx per
surah or per juz-chunk of a long surah. Long surahs span several juz folders as
separate files (`3 - JUz 1 Surah 2 .docx` ends at 2:141; its next chunk is in
`Juz 2`). File naming is inconsistent (case, spaces, numbering) — the folder
hierarchy is the reliable signal, not file names.

## The three document roles

### 1. Juz cover page (CP)

Pure metadata, no commentary. Contains:

- juz number ("JUZ 1", Title style)
- the juz's Arabic header (the letter code of its opening, e.g. آلم)
- **the coverage map** — each surah with its exact ayah range in this juz:
  `Surah 1 – Al Fatiha (1:1 till 1:7)`, `Surah 2 – Al Baqara (2:1 till 2:141)`
- curator credits (author, course, tafsir sources used)

The coverage map is an authoritative juz → surah → ayah-range list written by
the author. The current ingestion ignores it. It doubles as an integrity check:
every captured ayah must fall inside the range the CP claims.

### 2. Surah document (complete surah in one juz)

Recurring skeleton, top to bottom:

1. Bismillah (Arabic line)
2. "JUZ n" (Title style)
3. "SURAH n – NAME" heading
4. **Front matter** — labeled prose units: Name / other names, Period of
   Revelation, Subject and Topics, (sometimes Historical Background)
5. **Body** — one or more sections (`GROUP n: TITLE`), each containing
   **ayah units**:
   - one or more Arabic verse lines
   - `(s:a) translation` line
   - commentary paragraphs: prose, `Lesson:` notes, hadith, list items, and
     cross-references to other surahs kept inline (e.g. 4:69–70 under 1:7)
6. **End matter** — author recap devices that repeat `(s:a)` translations as
   summary lists ("BEAUTIFUL DIVISION…", "MY KEY TAKEAWAYS")

### 3. Surah chunk (long surah cut at a juz boundary)

Same skeleton as (2), but the body stops at the juz's last ayah. The surah
continues as another docx in the next juz folder. A reader view of a juz needs
to treat these chunks as parts of one surah.

## What the current ingestion does instead

`ingestion/tafseer_ingest/parse.py` parses every docx as one flat paragraph
stream with generic per-paragraph role guesses (no folder awareness, no CP
coverage map). Roles: juz_header, surah_header, section_heading, heading,
list_item, arabic, translation, prose, table → `doc_block` table. Section rows
for the tree come from "GROUP n:" / "n-m TITLE" lines. Lines the rules misread
(e.g. "GROUP 2 — TITLE" without a colon) fall out of the structure.

## Extractable juz model (target)

```
Juz n  (from CP: label, Arabic header, coverage map, credits)
├── Surah s  (from CP: from_ayah–to_ayah; "continued" flag if it spans juz)
│     ├── front matter (Name / Period / Topics …)
│     ├── section ("GROUP n: TITLE" or "n-m TITLE")
│     │     └── ayah unit (arabic lines, translation, commentary, cross-refs)
│     └── recap / key takeaways
└── Surah s+1 …
```

Verified against Juz 1: Fatiha = 1 section, 17 translations, 8 Arabic lines;
Baqara chunk = 12 sections, 55 translations, 123 list items; no tables in
either. Covers 1:1–1:7 and 2:1–2:141 exactly as the CP states.
