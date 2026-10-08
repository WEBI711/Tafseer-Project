# Agentic, conversational search (pi-durable)

## Problem

Today `/api/chat` runs a fixed pipeline on every message: `search()` → render doc → one answer
over the top 8 chunks. The agent makes no decisions. It can not search again, narrow to one
surah, ask a clarifying question, or combine two lookups. The UI shows results on every turn,
even for simple questions. Follow-up turns re-run the full pipeline, with no memory.

We also chose a foundation: the agent runs on **pi-durable** (`@earendil-works/pi-durable`),
the durable agent harness. This gives the tool loop, persistent conversations, crash recovery,
and committed doc state without hand-building them.

## Goals

1. The agent controls retrieval through **tools**. The UI renders results only when the agent
   calls a render tool. Normal turns are only conversation.
2. Answers stay **grounded in the corpus**: every claim cites a passage that a tool returned in
   this conversation. Nothing comes from the model's general knowledge.
3. Conversations are **durable**: a browser session's chat survives a server restart, and
   unfinished work resumes from its last checkpoint.

## Non-goals

- Changes to the ingestion/DB schema or the embedding model.
- The Reader view and surah browsing stay as they are.
- A UI rewrite on pi-durable `viewState()`. V1 bridges to the existing SSE events.
- `/api/search` stays a plain function. pi-durable powers the chat agent only.
- Named "study sessions" (multiple saved conversations per user). V1 has one durable
  conversation per browser session.

## Requirements

**Architecture**

- AR1 — A small persistent Node process ("agent server") owns the pi-durable harness. It opens
  SQLite storage (`agent.sqlite`) at startup and calls `resume()`.
- AR2 — The agent server exposes a small HTTP API: submit a question, stream harness events.
  The Next.js route `/api/chat` is a thin bridge: it proxies the browser's request and maps
  harness events to the existing SSE events (`delta`, `doc`, `tool`, `done`, `error`).
- AR3 — Conversation per browser session. The client generates an id once, stores it in
  localStorage, and sends it with each request. The agent server resolves it to a durable
  conversation (`root()` on first use, otherwise the stored one).
- AR4 — The chat agent runs on pi-durable with `@earendil-works/pi-ai` pointed at OpenRouter
  (our existing `TAFSEER_LLM_KEY` / `TAFSEER_LLM_BASE`). Default model stays `glm-5.3-flash`
  via `TAFSEER_CHAT_MODEL`; verify its tool-call behavior with pi-ai before commit and swap
  through config if it fails. Pin the pi-durable version exactly.
- AR5 — Dependencies: `@earendil-works/pi-durable`, `@earendil-works/pi-ai`,
  `@earendil-works/chord` (peer of the other two).

**Functional**

- FR1 — The agent loop is pi-durable's built-in `pi.generation` task. The model emits tool
  calls; pi-durable runs each as a durable tool task and hands the run to the next turn.
- FR2 — Tools, defined with TypeBox schemas and registered in the registry:
  - `search_corpus(query, surah?, juz?, limit?)` — wraps the existing `retrieve()`. Returns raw
    ranked hits. No relevance floor and no gap filling. The agent filters the hits itself.
    Declared `replay: "safe"` (read-only).
  - `get_surah(number)` — wraps `surahView()`. For "walk me through Surah X". Truncate output
    for long surahs in v1. `replay: "safe"`.
  - `render_results(title, ayah_refs[])` — collects refs from earlier tool results, calls
    `buildDoc()`, and commits the `ResponseDoc` as a pi-durable document in the same commit as
    the tool result. `replay: "safe"`.
- FR3 — Only `render_results` produces a document. Answers, clarifying questions, and refusals
  render nothing.
- FR4 — Multi-turn history comes from the durable transcript. No client-side `history` array.
- FR5 — Grounding rules in the system prompt section: cite (S:A) for every claim; copy quotes
  word for word from tool output; if the tools did not return relevant passages, say so, and
  search again with different wording. Never fall back to general knowledge.
- FR6 — A follow-up submitted while the agent runs is queued (pi-durable inbox), not lost.

**API**

- AR6 — Same endpoint (`/api/chat`), same SSE event names. New `tool` event (`{ name, args }`)
  mapped from harness tool-task events, so the UI can show "searching the tafseer…".
- AR7 — `/api/search` stays as it is.

**UX**

- UR1 — The chat bubble shows a small tool-activity line while a tool runs.
- UR2 — Follow-up turns do not clear or re-render the reader. The reader updates only when a
  bridged `doc` event arrives.
- UR3 — Suggestion chips stay. The empty-state text changes to conversation framing.
- UR4 — After a server restart, the same browser session continues its conversation with full
  history. No new UI for this; it just works.

## Alternative approaches

| Approach | Pros | Cons |
|---|---|---|
| A. Keep the fixed pipeline, better heuristics | Cheap. No agent loop. | Not conversational. Can not clarify or search again. Grounding does not improve. |
| B. Hand-rolled tool loop on the OpenAI SDK | Smallest diff. No new process. | No persistence, crash recovery, or queueing. We rebuild harness parts by hand. |
| C. **pi-durable harness** (chosen) | Tool loop, durable conversations, doc state, queueing, and crash recovery built in. Matches the goal of an agentic, conversational product. | Experimental API that moves fast. Needs one owning process and three new dependencies. |

C wins. The user chose it with full knowledge of the risks in the feasibility report
(`docs/reports/pi-durable-feasibility.md`). B remains the fallback if pi-durable blocks us.

## Implementation plan

1. **New file `agent-server/` — the harness owner.** A small Node process. Top: startup code —
   open SQLite storage, build the pi-ai model list with the OpenRouter provider, create the
   registry with the three tools and the system prompt section, `Harness.open()`, `resume()`,
   then an HTTP server with two routes: `POST /ask` (conversation id + question; `submit()`,
   returns receipt) and `GET /events/:conversationId` (streams harness events for that
   conversation). Helpers below: tool implementations (thin wrappers over the functions from
   `app/src/lib/search.ts`), the system prompt text, and the event-to-SSE mapper.
2. **`app/src/lib/search.ts` — export `retrieve` and add `buildDoc(refs, title)`.** Extract the
   grouping code from `search()` into a helper that both use. Keep `search()` for `/api/search`.
   Move nothing else; the agent server imports these functions.
3. **`app/src/app/api/chat/route.ts` — thin bridge.** Read the conversation id from the request
   (client sends it; first request may omit it and the agent server mints one and returns it in
   the stream header). Forward the question to the agent server. Map its events back to our SSE
   names. Delete the direct `search()` call and the hand-rolled answer loop.
4. **`app/src/components/Workspace.tsx`** — generate and store the session id in localStorage;
   send it with each POST. Handle the `tool` event: show "searching…" on the current message.
   Mutate `docs` only when a `doc` event arrives (this part already works).
5. **`app/src/components/ChatPanel.tsx`** — render the tool-activity line and the new
   empty-state text.
6. **Run book** — `docker-compose.yml` gains the agent server as a second service. It needs
   `TAFSEER_LLM_KEY`, `TAFSEER_LLM_BASE`, `TAFSEER_CHAT_MODEL`, and a volume for
   `agent.sqlite`. The Next.js service reaches it at `agent-server:PORT`.

Verification: typecheck and build both apps (`cd app && npx tsc --noEmit && npm run build`;
same in `agent-server/`). Then test by hand: start a chat, kill the agent server mid-answer,
restart, and confirm the conversation resumes with full history. Test a follow-up question,
"show me those ayat", and an out-of-scope question (the agent must refuse and render no doc).

## Risks / open questions

- **Model tool-call quality**: verify `glm-5.3-flash` tool calls through pi-ai before commit.
- **Experimental API**: pi-durable moved 1.0.0 → 1.1.0 in one week. Pin the exact version and
  expect migration work on upgrades.
- **Process ownership**: one process owns the storage. Never run two agent servers against one
  `agent.sqlite`.
- **Event mapping fidelity**: harness events must map cleanly onto `delta`/`doc`/`tool`. If a
  needed event is missing, we fall back to polling `viewState()` — check during step 1.
- **Render tool overuse**: tune the prompt: "Render only when the user asked for passages or a
  search-style answer."
- **Long surahs**: `get_surah` truncates in v1. A per-section tool can come later.