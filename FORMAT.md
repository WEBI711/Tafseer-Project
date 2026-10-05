# FORMAT.md — the uniform juz format (draft v7 — final)

Status: **draft v7 (final)**. All 30 juz audited. v7 folds in the final
batch's residuals (closing requotes, recap restatements outside the chunk,
front-matter quoted ayat, dua transliterations, date stamps, OLE-embedded
CP). Earlier revisions: v2 = spot-check; v3 = Juz 30; v4 = batch 1; v5 =
batch 2; v6 = batch 3. Earlier revisions: v2 folded in the
spot-check audits (Juz 1, 2, 26 + a timed-out Juz 30); v3 folded in Juz 30's
full audit. Each juz folder is audited against this draft by filling a JSON
instance and reporting where the draft breaks. The draft evolves from those
reports until all 30 juz fit. Reference: `JUZ-STRUCTURE.md` (evidence from
Juz 1).

Changelog v1 → v2 (from auditor reports):

- Named fields for Bismillah and "JUZ n" banner (was "TBD").
- Added juz-level `group_headers` (juz-wide "GROUP n — TITLE" headers).
- Added part-level `extras` catch-all (section indexes, stray lines).
- Added commentary kind `heading` for bold sub-headings inside commentary.
- Recap items get `kind` (heading | prose | translation | arabic | list_item).
- Sections get `intro` (prose before the first ayah unit); empty sections valid.
- Section-heading patterns widened: `GROUP n: TITLE`, `GROUP n — TITLE`,
  `n-m TITLE`, single-number `n TITLE`, inverted `TITLE (n-n)`.
- `translation.ref` is the verbatim string; normalized `from_ayah`/`to_ayah`
  added when parseable; suspect refs keep a `ref_as_written` note.
- LabeledUnit gets optional `items` (labeled list blocks, sub-headings).
- Juz record gets `arabic_header_translit` and `arabic_header_meaning`.
- Coverage-check result is recorded in the JSON (`coverage_check`).
- `translation.ref` may be empty when the source prints no `(s:a)` prefix; an
  inferred ref gets `ref_inferred: true`. Normalized `ref_surah` added.
- Index-vs-body-heading rule for repeated section titles; unheaded index-only
  sections stay in `part.extras` with an anomaly.
- `group_headers` entries carry `found_in` (file + paragraph position) so the
  ordered stream keeps its place.
- Recap title = first line only; the rest becomes the first item.
- Translations spanning two paragraphs merge with a line break.
- `hadith` kind is only for explicit "HADITH:"-style lines; `cross_ref` only
  for line-initial references; mid-sentence references stay `prose`.
- `name_en` drops the redundant "SURAH " heading prefix.
- **v4:** `Section.intro` holds typed items `{kind, text}` (same kind set as
  commentary) — bold sub-headings and `Lesson:` lines in ayah-less or preamble
  sections keep their kind.
- **v4:** recap items reuse the full commentary kind set (adds `cross_ref`,
  `lesson`, `hadith`).
- **v4:** `SurahPart.section_index` names the opening title-index block
  (`{header, titles}`); an index listing the WHOLE surah in a chunk doc is
  expected, not an anomaly. `SurahPart.chunk_marker` holds the verbatim
  "Cont." line. `part.extras` elements are `{kind, text}`.
- **v4:** `LabeledUnit.label` may be null (unlabeled part-level intro prose).
- **v4:** conventions pinned — `translation.ref` keeps inner separators
  verbatim but drops the enclosing parentheses; `name_en` drops the whole
  `SURAH n – ` prefix; `hadith` detection is case-insensitive; a bold line is
  a `heading` when short (≤90 chars), a bold full sentence stays `prose`;
  private-use-area font glyphs are stripped; a quoted cross-surah ayah inside
  commentary is `kind: quote` with the bare ref line as its neighbour
  `cross_ref`; section titles carry optional `from_ayah`/`to_ayah` parsed
  from the title.
- **v5:** `Recap.title` may be null (untitled end-matter blocks).
- **v5:** `chunk_marker` is the line verbatim as printed ("Cont.", "(Cont.)").
- **v5:** section-heading pattern widened with bare trailing ranges:
  `TITLE n-m` (no parentheses).
- **v5:** commentary items may carry an optional `ref` — a quoted cross-surah
  ayah printed WITH its ref inside commentary is `kind: quote` plus `ref`.
- **v5:** a `heading` is a short (≤90 chars) line without a terminal period
  that is bold, italic, or all-caps — the source does not always use bold.
- **v5:** `juz.cp_header_lines` keeps ALL cover-page header lines verbatim and
  ordered (the parsed `arabic_header` fields stay).
- **v5:** `LabeledUnit.items` entries may carry `kind` (e.g. a `(s:a)`
  translation line inside "Topics of Discussion").
- **v6:** section-heading pattern adds `VERSES n-m TITLE`.
- **v6:** `cp_header_lines` = the ordered verbatim header lines between the
  "JUZ n" title and the coverage map.
- **v6:** CP authority rule — when a CP range contradicts the surah's real
  length or the body (a CP typo, e.g. "17:01 till 17:99" for a 111-ayah
  surah), capture the body as-is and record the CP mismatch as a high
  anomaly with both values. Do not force the body into a wrong range.
- **v6:** a CP that embeds content docs verbatim records the duplication in
  `juz.extras` as `{kind: "cp_duplicate_content", text: <file list>}` — the
  duplicated text stays only in the parts.
- **v7:** coverage counts BODY ayah units only — recap restatements and
  closing requotes of the surah opening (a body unit that restates an ayah
  outside this chunk's range, printed as an end-of-chunk transition) are
  exempt from the range check; the unit itself is kept (lossless), flagged
  with an anomaly note so the UI can treat it as a transition.
- **v7:** commentary kinds add `arabic` and `translation` (dua
  transliterations, restated ayat) — the full set is now prose | heading |
  lesson | hadith | list_item | cross_ref | quote | arabic | translation.
- **v7:** `LabeledUnit.items` entries may carry `kind: arabic | translation`
  — front matter sometimes quotes a full ayah (Arabic + (s:a) translation).
- **v7:** a date stamp (Title-styled `M/D/YY` line) is `part.extras` element
  `{kind: "date_line", text}`.
- **v7:** a CP may be an OLE-embedded docx inside the cover file; extract it
  from `word/embeddings/*.docx` and note the source in an anomaly.

Agreed decisions baked into this draft (unchanged):

- **Lossless.** Every content line in a docx lands somewhere in the model. No
  search columns. No display decisions here — the UI filters later.
- **Chunks stay per-juz.** A long surah cut at a juz boundary is stored as a
  separate surah-part inside each juz that contains it. A whole-surah view is
  derived later at read time. No stitching during ingestion. Chunk flags are
  independent: a middle chunk can have both `continues_from_prev_juz` and
  `continues_in_next_juz` true.
- **Coverage as numbers.** The cover page's ayah ranges are stored as
  `from_ayah` / `to_ayah` integers. The cover page's raw text is kept verbatim
  on the juz record.
- **Out of scope:** `Intro to the Quran/` folder, search/embeddings, the UI
  design, dropping/rebuilding DB tables (that is the implementation phase).

---

## 1. Entities

```
Juz
├── record: number, folder name,
│           arabic_header, arabic_header_translit, arabic_header_meaning,
│           credits (verbatim, null if absent), cp_text (verbatim),
│           group_headers: [ { title, text (group intro prose, may be empty),
│                             found_in (file + paragraph position, so the
│                             reading order can reconstruct where it sat) } ],
│           cp_header_lines: [verbatim, ordered cover-page header lines]
├── coverage: one row per surah the CP lists → surah_number, name_en (verbatim),
│             from_ayah, to_ayah
├── extras: lossless catch-all for CP items with no slot above
└── parts: one per content docx in the folder (SurahPart, below)

SurahPart            (one docx = one part)
├── record: surah_number, name_en (verbatim from the SURAH heading),
│           from_ayah, to_ayah,
│           continues_from_prev_juz (bool), continues_in_next_juz (bool),
│           source_file, ord (reading order inside the juz),
│           bismillah (verbatim line, null if absent),
│           juz_banner (the "JUZ n" Title line, null if absent),
│           chunk_marker (the continuation line verbatim as printed, e.g.
│           "Cont." or "(Cont.)", null if absent),
│           section_index ({header, titles[]} for the opening title-index
│           block; in a chunk doc the index may legitimately list the WHOLE
│           surah — titles beyond this chunk's range stay here, no anomaly),
│           extras: lossless catch-all, elements {kind, text} (stray lines,
│           anything else with no slot)
├── front_matter: list of labeled prose units (LabeledUnit)
├── sections: list of Section
└── recaps: list of Recap (end matter)

Section
├── record: title (raw line as written), ord,
│           from_ayah, to_ayah (parsed from the title's range when present,
│           else null — the title's claimed range may exceed what is quoted)
├── intro: ordered list of {kind, text} items (same kind set as commentary)
│          — prose between the heading and the first ayah unit (may be empty)
└── ayah_units: list of AyahUnit (may be empty — an empty section is valid;
    the author sometimes ranges titles over ayat he does not quote)

AyahUnit             (one ayah's block inside a section)
├── arabic_lines: list of strings, in document order, line breaks preserved
│   (often empty — the author prints Arabic only for selected ayat)
├── translation: { ref (verbatim, e.g. "2:204 , 205 and 206"; may be empty
│                 when the source prints no (s:a) prefix), text,
│                 ref_surah (integer from the ref as written, null if
│                 unparseable — kept separate so a wrong surah number is
│                 machine-checkable),
│                 from_ayah, to_ayah (integers when the ref parses, else null),
│                 ref_inferred (true when the ref was absent and inferred from
│                 context),
│                 ref_as_written (optional note when the ref looks wrong, e.g.
│                 "(2:44)" where context shows 2:244, or "inferred 109:1") }
│                 null for translation-less preamble units
├── commentary: ordered list of items, each:
│     { kind: prose | heading | lesson | hadith | list_item | cross_ref | quote,
│       text, ref (optional — for a quoted ayah printed with its ref) }
│   -- "heading" = bold sub-heading inside commentary; "quote" = re-quoted
│   -- Arabic or quoted material mid-unit (may be Arabic, may carry ref)
└── extras: anything inside the unit the kinds above cannot hold (lossless
    catch-all, e.g. ruku markers, embedded heading blocks)

LabeledUnit          (front matter: "Name: …", "Period of Revelation: …")
├── label: the label as written, or null for unlabeled part-level intro prose
├── text: the prose that follows it (paragraphs joined, breaks noted)
└── items: optional ordered list for labeled LIST blocks or bold sub-headings
    inside the unit — { text }; use when flattening would lose structure

Recap                ("BEAUTIFUL DIVISION…", "MY KEY TAKEAWAYS")
├── title: the first line as written, or null for an untitled end-matter block
│          (if the title paragraph continues with prose, the remainder becomes
│          the first item)
└── items: ordered list of { kind: prose | heading | lesson | hadith | list_item
    | cross_ref | quote | translation | arabic, text }   -- same set as
    commentary, plus translation/arabic for restated translations and duas
```

## 2. Reading rules (how a docx maps to the entities)

1. **Order is document order.** `ord` values follow the paragraph stream; the
   reader must never reorder content.
2. **Bismillah** goes in `SurahPart.bismillah`; the **"JUZ n" Title banner** in
   `SurahPart.juz_banner`. Never dropped.
3. **Front matter** = labeled prose units between the surah heading and the
   first section. Known labels: Name (and other names), Period of Revelation,
   Subject and Topics, Historical Background, Theme and Subject Matter.
   Unknown labels are captured too (lossless) and reported.
4. **Section headings** are lines matching `GROUP n: TITLE`, `GROUP n — TITLE`
   (em dash), `n-m TITLE`, `TITLE n-m` (bare trailing range), `VERSES n-m
   TITLE`, single-number `n TITLE` (bold), or inverted `TITLE (n-m)`. A `GROUP n` header that frames
   a whole juz or several surahs (with its own intro prose) belongs in
   `juz.group_headers`, not a section. Bold transition interjections inside
   sections ("NOW NEXT 4 AYATS…") are not headings — keep as commentary of
   the preceding unit. Any other heading-looking line becomes an anomaly
   report, not a section.
5. **Ayah unit boundaries** start at an Arabic verse line; the following
   `(s:a) translation` line closes the unit's identity; commentary continues
   until the next Arabic line or section heading. A section may start with
   prose (`Section.intro`). An Arabic+translation pair sharing one paragraph
   is split at the embedded line break (lossless).
6. **Cross-references** (e.g. "4:69–70 under 1:7") stay inline in commentary as
   `kind: cross_ref` — not extracted into separate records.
7. **A part with no sections** (possible in short surahs) is valid: ayah units
   hang directly off the part in a single default section titled by the surah.
8. **Mid-unit Arabic requotes** with English restatement are commentary
   `kind: quote` — `arabic_lines` is reserved for the unit's opening verse.
9. **Source typos in refs** are kept verbatim with a `ref_as_written` note.
   Never silently correct a ref.
10. **Section-title index vs body headings.** Every multi-section docx opens
    with a block listing its section titles (`SurahPart.section_index`), then
    repeats them as real headings in the body. A chunk doc's index may list
    the WHOLE surah — titles beyond this chunk's range are expected there and
    are NOT anomalies. A title that recurs in the body is a section heading
    (wording/range may drift from the index — record drift as one low
    anomaly per part, both forms kept verbatim). A title that appears only in
    the index and belongs to this chunk's range is an anomaly — its title
    stays in `section_index` and its ayat merge into the preceding section.
    Body headings that drop the numeric range ("STORY OF ADAM'S TWO SONS")
    are valid sections when the index confirms them.
11. **Commentary kind conventions.** `hadith` for "HADITH:"-prefixed lines,
    case-insensitive; `cross_ref` only for line-initial references
    ("Also see…", "see also…"); mid-sentence references stay `prose`. A
    quoted cross-surah ayah inside commentary is `kind: quote`; a bare ref
    line introducing it is a neighbouring `cross_ref`. A bold line is a
    `heading` when short (≤90 chars) without a terminal period — bold,
    italic, or all-caps; a bold full sentence stays `prose`.
    Private-use-area font glyphs (U+E000–U+F8FF) are stripped everywhere.
12. **Ref and name conventions.** `translation.ref` keeps inner separators
    verbatim ("6: 137", "6-112") but drops the enclosing parentheses as
    printed. `name_en` drops the whole "SURAH n – " prefix
    ("AN NISA (THE WOMEN)").

## 3. Verification rule (per juz)

Every ayah captured must satisfy the CP coverage map:

- sum of parts' `[from_ayah … to_ayah]` per surah == the CP's stated range
- no captured ayah outside the range
- every surah the CP lists has ≥ 1 part; every part's surah is listed in the CP
- **Boundary check:** the part's first and last captured ayat should equal the
  CP range boundaries; missing boundary ayat (e.g. the CP starts at 2:142 but
  the body never quotes it) are high-severity anomalies. The author comments on
  a selection of ayat — interior gaps are expected and NOT anomalies.
- **Scope:** BODY ayah units only. Recap items and closing requote units
  (end-of-chunk transitions restating an ayah outside the chunk's range) are
  exempt from the range and boundary checks; keep the units, note the anomaly.
- **CP authority caveat:** if the CP range contradicts the surah's real length
  or the body, treat the CP as the typo: capture the body as-is and record the
  mismatch (both values) as a high anomaly. Never trim the body to fit a wrong
  range; never extend the body to fit a wrong range.

Record the result in the JSON: `coverage_check: { result: "pass"|"fail", notes }`.

## 4. Anomaly list (per juz, in the same JSON file)

Each anomaly: `{ id, file, location, description, severity }`.
Severity: `high` (coverage mismatch incl. missing boundary ayat, missing CP,
unparseable structure), `low` (odd file names, unknown labels, format wrinkles,
source typos).

Known expected findings (not surprises): Word lock files (`~$…`) are skipped
silently; folder/file name case varies; some files are named by ayah
(`2 - 25:46.docx`); a CP may lack credits; a last part may lack a recap.

## 5. JSON instance shape

One file per juz: `ingestion/spec/samples/juz-NN.json`

```jsonc
{
  "juz": {
    "number": 1,
    "folder": "Juz 1",
    "arabic_header": "آلم",
    "arabic_header_translit": null,
    "arabic_header_meaning": null,
    "credits": "…verbatim…",
    "cp_text": "…verbatim cover page text…",
    "group_headers": [],
    "coverage": [
      { "surah_number": 1, "name_en": "Al Fatiha", "from_ayah": 1, "to_ayah": 7 },
      { "surah_number": 2, "name_en": "Al Baqara", "from_ayah": 1, "to_ayah": 141 }
    ],
    "extras": []
  },
  "coverage_check": { "result": "pass", "notes": "" },
  "parts": [
    {
      "surah_number": 1,
      "name_en": "Al Fatiha",
      "from_ayah": 1, "to_ayah": 7,
      "continues_from_prev_juz": false,
      "continues_in_next_juz": false,
      "source_file": "2 - Juz 1 Surah 1 Fat.docx",
      "ord": 1,
      "bismillah": "…",
      "juz_banner": "JUZ 1",
      "extras": [],
      "front_matter": [ { "label": "Name", "text": "…", "items": null } ],
      "sections": [
        {
          "title": "GROUP 1: THE OPENING",
          "ord": 1,
          "intro": [],
          "ayah_units": [
            {
              "arabic_lines": ["…"],
              "translation": { "ref": "1:1", "text": "…", "ref_surah": 1,
                               "from_ayah": 1, "to_ayah": 1,
                               "ref_inferred": false, "ref_as_written": null },
              "commentary": [ { "kind": "prose", "text": "…" } ],
              "extras": []
            }
          ]
        }
      ],
      "recaps": [ { "title": "MY KEY TAKEAWAYS",
                    "items": [ { "kind": "translation", "text": "…" } ] } ]
    }
  ],
  "anomalies": [ { "id": "a1", "file": "…", "location": "…", "description": "…", "severity": "low" } ]
}
```

Fields an auditor cannot fill from the docx are left `null` with an anomaly
noted — never guessed.

## 6. Audit procedure (per juz)

1. Read the CP docx → fill `juz`, `coverage`.
2. Read each content docx (skip `~$…`) → fill one `part`. **Work file by file**:
   finish and validate one part before starting the next, so a timeout still
   leaves a valid partial file.
3. Set chunk flags: a part whose surah's ayah range starts before the CP's
   `from_ayah` (or whose surah appears in the previous juz) sets
   `continues_from_prev_juz: true`; same logic forward for
   `continues_in_next_juz`. Both may be true for a middle chunk.
4. Run the §3 coverage check; record the result and mismatches as high-severity
   anomalies.
5. Write `ingestion/spec/samples/juz-NN.json`. Report anomalies; do not edit
   this file — the main session evolves it between batches.
6. Keep helper/scratch scripts out of the repo (use `/tmp`), and prefer small
   per-file extraction over one large program.
