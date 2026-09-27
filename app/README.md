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
- Every commentary block carries its `source_file`, shown as a source line so a
  passage is always traceable to the docx it came from.
- Surah-level notes (`commentary.ayah_id IS NULL`) render as "Notes on the
  surah"; multi-file surahs keep all their files' commentary.

## Known gaps

- Retrieval quality: commentary paragraphs are embedded, not `ayah.translation`
  (PLAN.md calls for both). Short keyword-heavy queries can rank loosely.
- Chat latency follows the configured agent model; there is no caching.
- No auth or per-user history — recent queries live in `localStorage`.