# Tafseer AI — Project Plan

Goal: Ingest Tafsir docx documents into a queryable database with an AI chat interface (RAG with citations).

## Stack (Python + TypeScript split)

- **DB**: Postgres + `pgvector` + full-text search (`tsvector`) — one system for structured data, semantic + keyword search
- **Ingestion (Python)**: CLI/worker script (`python-docx`) — parse → chunk → embed → upsert (idempotent by source-file hash). Offline, no server needed
- **API (TypeScript)**: Next.js API routes / server actions — chat (RAG), search, browse. Reads what Python wrote; DB is the contract between the two
- **Frontend**: Next.js + Tailwind + shadcn/ui, RTL support for Arabic
- **LLM**: GPT-4o-mini (chat) + `text-embedding-3-small` (embeddings)
- **Contract**: SQL migration files define the schema once; both sides derive from it

## Schema

```
juz (id, number)
  └─ surah (id, juz_id, number, name_ar, name_en, revelation, subject, topics)
       └─ section (id, surah_id, title, order)          -- "GROUP 1: OPENING..."
            └─ ayah (id, section_id, surah_id, number, text_ar, translation)
                 └─ commentary (id, ayah_id, content, order, embedding vector(1536))
```

Embeddings also on `ayah.translation`; every chunk carries metadata (juz, surah, ayah, tafsir source).

## Phases

### Phase 1 — Ingestion pipeline (foundation)
1. Parser: docx → JSON, keyed on paragraph patterns:
   - Arabic line → ayah text; `(s:a)` line → translation; following paragraphs → commentary
   - `Title` style = Juz marker; `GROUP n:` = section boundary
2. Batch loader: watch folder → parse → chunk → embed (parallel) → upsert by file hash
3. Re-run safe, error report, progress status
4. Validate against the 3 sample docs in `data/`

### Phase 2 — Search + API
1. Hybrid retrieval: pgvector similarity + `tsvector` keyword (EN + AR)
2. Endpoints: `/search`, `/chat`, `/browse` (juz/surah tree)
3. Chat = RAG: embed question → retrieve top-k → LLM answer with ayah citations

### Phase 3 — Frontend
1. Chat panel with streaming answers + cited sources
2. Quran navigator: Juz → Surah → Section → Ayah tree
3. Click a citation → jump to the ayah in context
4. NOTE: `demos/` pages contain hand-written placeholder commentary (NOT source text) for layout purposes only — the real app renders verbatim DB content (see Non-negotiable principles)

### Phase 4 — Production hardening
1. Ingestion status UI + retries
2. Auth (if multi-user), conversation history
3. Scale path: if >1M chunks, swap vectors to Qdrant; keep Postgres for structure

## Non-negotiable principles

- **Chat is global by default**: the AI chat queries the *entire* corpus — every surah, ayah and tafsir work — via vector search over all passages. It is never scoped to "the document you are reading." Narrowing (`only Ibn Kathir`, `only Juz 1`, `only this surah`) is an **optional user-applied filter** (a WHERE clause on top of the vector search), never a structural constraint implied by the UI. The "Ask AI about this ayah" affordance *seeds context* (pre-fills the question, boosts that passage in ranking) but still searches globally.
- **Verbatim fidelity**: commentary/translation text stored in the DB must be the author's exact words from the source docx — no paraphrasing, rewriting, or "improving" at any stage (parse, load, or LLM chat answers). The LLM may *summarize* or *explain* in chat responses, but every cited quote shown to the user must be retrievable verbatim from the DB, traceable to its source file and ayah.
- **Attribution**: every commentary row keeps `source_file`; the UI must always show which work (Taleem al-Quran, Ibn Kathir, Mawdudi, etc.) a passage comes from.

## Key decisions made
- Postgres over dedicated vector DB: corpus <1M chunks, hybrid queries need SQL filters + vectors in one place
- Hybrid (vector + keyword) retrieval: exact terms (surah names, ayah numbers) need keyword match