# Ingestion pipeline

Turns the tafsir `.docx` files in `../source/Archive` into the Postgres corpus the
app reads. Python only; the app (`../app`, Next.js) never writes.

The pipeline is **idempotent per source file**: re-running it replaces that file's
rows instead of duplicating them.

## What it produces

| table | what it holds |
| --- | --- |
| `doc_block` | **the document itself** — every paragraph and table, in order, with its role. This is what the reader renders. |
| `ayah`, `section`, `commentary` | a *derived* view (verses, boundaries, commentary) built for search and citation |
| `juz`, `surah`, `source_doc` | reference data and provenance: which docx belongs to which juz |
| `commentary.embedding` | `vector(1536)` used for semantic search |

Blocks are the source of truth for reading; the derived tables are lossy by
design (they exist so a question can be answered and a passage cited).

## One-time setup

```bash
# 1. database (pgvector on :5433)
docker compose up -d db

# 2. schema — applies db/migrations/*.sql in order, safe to re-run
./db/migrate.sh
#    (equivalent, by hand:)
#    for f in db/migrations/*.sql; do
#      docker exec -i tafseer-db psql -U tafseer -d tafseer < "$f"
#    done

# 3. python env
cd ingestion
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 4. credentials — copy and fill in
cp .env.example .env
```

`.env`:

```
DATABASE_URL=postgresql://tafseer:tafseer@localhost:5433/tafseer
OPENAI_API_KEY=<key for the embedding gateway>
OPENAI_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
```

Without `OPENAI_API_KEY` the text still loads and only the vectors are missing —
then semantic search silently returns nothing. The verifier reports this.

**If the key looks ignored**, a developer shell usually exports its own
`OPENAI_API_KEY`; the loader calls `load_dotenv(override=True)`, so `.env` wins
there. In the Next.js app the names are prefixed (`TAFSEER_LLM_KEY`) for the same
reason.

## Running it

```bash
cd ingestion

# full pipeline: parse -> blocks, sections, ayat, commentary, embeddings
.venv/bin/python -m tafseer_ingest.load ../source/Archive

# parse only, no database: writes parsed.json and prints a per-file summary
.venv/bin/python -m tafseer_ingest ../source/Archive

# structure only: rewrite doc_block (and nothing else) — no API calls, no
# re-embedding. Use after a parser fix.
.venv/bin/python -m tafseer_ingest.blocks ../source/Archive
```

The full run prints a summary of what it wrote, e.g.
`{'juz': [1..30], 'surah': 138, 'section': 742, 'ayah': 3751, 'commentary': 12998}`.
(`ayah` there counts upserts; the table holds fewer because a verse that several
files cover is one row.)

Embedding is batched to stay inside the gateway's limits — at most 1000 inputs and
about 200k estimated tokens per request, chunked by an `len(text)//4` estimate. If
embedding fails the rows are still loaded and a warning is printed; re-run the
loader to fill the vectors in.

## Verifying it worked

```bash
cd ingestion

# 1. unit tests for the parser's two historic bugs (borrowed Arabic, artifacts)
.venv/bin/python tests/test_parse.py

# 2. acceptance test: every docx, paragraph and table, in order, vs doc_block
.venv/bin/python tests/verify_source_fidelity.py ../source/Archive
```

The fidelity check is the one that matters for the reader. It must print
`files identical to source: <all files>`; a single mismatch means the app will
show something the author did not write.

Row counts, if you want them by hand:

```sql
SELECT (SELECT count(*) FROM doc_block) blocks,
       (SELECT count(*) FROM ayah) ayat,
       (SELECT count(*) FROM commentary) commentary,
       (SELECT count(*) FROM commentary WHERE embedding IS NOT NULL) embedded;
```

## Rules the pipeline must keep

These are not stylistic preferences; each one fixes a bug that shipped:

1. **Verbatim.** No paraphrasing, rewriting or "improving" of source text at any
   stage. Commentary and translations are the author's exact words.
2. **No inferred text.** `ayah.text_ar` is filled only when an Arabic paragraph
   directly precedes *that* ayah's `(s:a)` line. Never borrow a neighbour's verse:
   the docs usually quote Arabic once per section, which once caused 51 verse
   numbers in Surah 4 to display 4:34.
3. **Nothing dropped, nothing reordered.** Every paragraph and table becomes a
   block, in document order, including the bismillah, the `JUZ n` banner,
   sub-headings, list items, Arabic the author never tied to a verse, and tables.
   Blocks may be ordered only by the file's own sequence.
4. **Provenance.** Each row records its `source_file`; `commentary.juz`,
   `section.juz` and `source_doc` record the juz of the docx it came from — the
   explorer and grouping need it because `section.ord` restarts per file.
5. **Scoped writes.** A file's rows are replaced by `source_file`, never by
   `surah_id`: surahs span several files (Surah 2 is covered by three), and
   deleting per surah once wiped a whole file's commentary.
6. **Font artifacts are not text.** Private-use glyphs (`U+E000–U+F8FF`) and
   invisible marks (`U+200B`, `U+200E/F`, `U+2060`, `U+FEFF`, `U+00AD`) are
   stripped. They render as empty boxes in every other font.

## What the parser expects

- `Title`-styled line with a number → juz banner
- `SURAH 12 – NAME` → surah boundary (prose mentioning "Surah" is ignored)
- `GROUP 1: TITLE` or `6-7 TITLE` → section heading
- Arabic-dominant paragraph → verse Arabic (see rule 2); a fragment of 1–2 letters
  is still Arabic (disjoined openings: طٰهٰ, يٰسٓ, حمٓ)
- `(2:6) translation` → verse translation and boundary
- a paragraph with **every run bold**, ≤ 90 chars → sub-heading
- `List Paragraph` style → list item
- everything else → prose

Tables lose their Word list numbering and merge styling: Word's `1.`, `2.` markers
live in `numbering.xml`, not in the paragraph text, so they render as bullets.
Content is unaffected.

## Re-building from scratch

```bash
docker exec tafseer-db psql -U tafseer -d tafseer \
  -c "TRUNCATE section, commentary, ayah, doc_block RESTART IDENTITY CASCADE"
.venv/bin/python -m tafseer_ingest.load ../source/Archive
```

`TRUNCATE ... CASCADE` also empties anything referencing the truncated tables.
A full rebuild re-embeds every commentary row (roughly 200 gateway requests for
this corpus); use `tafseer_ingest.blocks` when only the structure changed.

## Troubleshooting

| symptom | cause |
| --- | --- |
| `role "postgres" does not exist` | the compose user is `tafseer`, not `postgres` |
| no documents parsed | the archive is nested in `Juz n/` folders; the loader globs recursively, a custom directory must too |
| `PackageNotFoundError` on a `~$…docx` | Word lock files; they are skipped by name |
| 401 from the gateway | key shadowed by the shell, or wrong `OPENAI_BASE_URL` |
| `Invalid 'input': array length must be 2048 or less` | request batching broke; see the chunking limits above |
| search returns nothing | embeddings missing — check the verifier's coverage line |
| reader shows a verse twice | blocks were ordered by a per-block juz instead of the file's; keep the `ORDER BY` in `app/src/lib/search.ts` as is |
