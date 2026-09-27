# Tafseer app (Next.js + TypeScript)

The reading app: a three-panel manuscript workspace — explorer, reader, and the
AI study companion — built to the UX contract in `../QUERY-VIEW.md` and the
visual language of `../demos/06-manuscript-workspace.html` and
`../demos/07-query-response.html`.

The database is the contract between the Python ingestion pipeline
(`../ingestion`) and this app. The app only reads.

## Run

```bash
# 1. database (pgvector, port 5433)
docker compose -f ../docker-compose.yml up -d db

# 2. env — copy the template and fill in the key
cp .env.example .env.local

# 3. app
npm install
npm run dev            # http://localhost:3000
```

### Environment

| variable | purpose |
| --- | --- |
| `DATABASE_URL` | Postgres used by the ingestion pipeline |
| `TAFSEER_LLM_KEY` | key for the OpenAI-compatible gateway |
| `TAFSEER_LLM_BASE` | gateway base URL (OpenRouter by default) |
| `TAFSEER_EMBED_MODEL` | embedding model — must match the 1536-dim column |
| `TAFSEER_CHAT_MODEL` | front-end agent model |

The names are prefixed on purpose: a developer shell usually exports its own
`OPENAI_API_KEY`, which would shadow a plain name and silently send requests to
the wrong provider.

## Layout

```
src/app/api/tree/route.ts          Juz -> surah -> section tree
src/app/api/surah/[number]/route  reader payload (sections, ayat, commentary)
src/app/api/search/route.ts       retrieval -> response document
src/app/api/chat/route.ts         agent: SSE (doc, delta, done, error)
src/lib/db.ts                     pool + tree query
src/lib/search.ts                 hybrid retrieval + response-document builder
src/lib/agent.ts                  grounded answer streaming
src/components/Explorer.tsx       collapsible Juz/surah/section tree
src/components/Reader.tsx         reader mode + query-response mode
src/components/ChatPanel.tsx      thread, citations, refinement chips
src/app/globals.css               manuscript theme (ported from demos 06/07)
```

## How the reader works

The reader shows the **source document**, not our model of it. Ingestion stores
every paragraph of every docx as a block — `juz_header`, `surah_header`,
`section_heading`, `heading`, `list_item`, `arabic`, `translation`, `prose` — in
document order (`doc_block`), and the reader renders those blocks in sequence.
Structure, wording, and order are the author's: the surah's own `JUZ 1` /
`SURAH 2 – …` banners, sub-headings such as `Period of Revelation`, list items,
the bismillah, Arabic the author quoted without attaching it to a verse.

Acceptance check (`ingestion`): for every source file, the block sequence must
equal the docx paragraph sequence, and the rendered DOM must equal the payload.
Both are verified for all 167 files today.

The `ayah`/`section`/`commentary` tables are a **derived view** built for search
and citation. Query-response mode renders from that view; reader mode does not.

## How retrieval works

1. `embeddings` + `tsvector` candidates are fetched in one query, fused per row
   (`GREATEST(cosine, rank * 3)`), then grouped to ayah level.
2. A relevance gate drops the tail that embedding search always returns, with a
   floor of six ayat so a document never renders nearly empty.
3. The document is ordered canonically — juz, then surah, then ayah — and
   rendered by React, never by the model.

## Fidelity rules the code enforces

- Arabic, translation, and commentary come from the DB untouched; the agent may
  summarise in chat but every quote is retrieved verbatim.
- The response document is generated markup: the model chooses nothing about
  layout. It receives passages as context and streams prose only.
- Every commentary block carries its `source_file`. Attribution is stated once
  per section (and once for the surah's notes): 95% of ayat draw on a single
  docx, and repeating its name between paragraphs broke the reading flow. Blocks
  that mix files list each source, and a passage is labelled individually only
  when its own ayah mixes sources.
- Verses the source lists without commentary or quoted Arabic render as a compact
  numbered list inside the section, matching how the author wrote them (a batch
  of short verses followed by commentary on the group). That commentary stays
  attached to the verse it was written under — the reader never moves text
  between verses to tidy things up, and shows no invented placeholder lines.
- Surah-level notes (`commentary.ayah_id IS NULL`) render as "Notes on the
  surah"; multi-file surahs keep all their files' commentary.

## Known gaps

- Arabic coverage is partial by design: only 591 of 3,551 ayat have `text_ar`,
  because the source docs quote Arabic once per section rather than per verse.
  The rest render translation + commentary. Filling them would need a canonical
  Quran text — an outside source, so it is a product decision, not a bug fix.
- Some source paragraphs are run fragments Word joined without spaces
  (`الٓرتِلۡكَ`), kept as-is because they are the author's characters.
- Retrieval quality: commentary paragraphs are embedded, not `ayah.translation`
  (PLAN.md calls for both). Short keyword-heavy queries can rank loosely.
- Chat latency follows the configured agent model; there is no caching.
- No auth or per-user history — recent queries live in `localStorage`.

## Data integrity

`ingestion/tests/test_parse.py` pins the two bugs found during the first full
 ingest: an ayah inheriting a neighbouring verse's Arabic, and font-artifact
codepoints (private use area / invisible marks) reaching the database.