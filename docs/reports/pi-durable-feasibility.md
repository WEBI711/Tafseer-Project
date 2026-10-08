# pi-durable — feasibility report for this project

## What it is

`@earendil-works/pi-durable` is a durable agent harness from Earendil. It is not the Pi coding agent. It is a framework for any agent application. It shipped with Pi 1.0 on 2026-10-01 and is now at version 1.1.0 on npm ([npm](https://www.npmjs.com/package/@earendil-works/pi-durable), [earendil.com](https://earendil.com/posts/pi-durable/)).

Core parts ([package README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/README.md)):

- **Harness** — opens over a storage backend and runs one or more conversations.
- **Conversations** — transcripts of immutable entries. They can fork at any point.
- **Tasks** — every model request and tool call is a task with a checkpoint. After a crash, a new process reopens the storage and continues each task.
- **Tools** — defined with a TypeBox schema. Each call runs as its own durable task. A tool reruns after a crash only if it declares `replay: "safe"`.
- **Documents** — typed JSON state stored next to the transcript, changed in atomic commits.
- **Multi-client** — `viewState()` gives any UI the full conversation state; clients can steer a running conversation or queue follow-ups.
- **Compaction** — a background task summarizes old messages when context fills.

It depends on `@earendil-works/pi-ai` (model access) and `@earendil-works/chord` (document state). Storage ships as memory, SQLite, and JSONL. One process owns a storage at a time.

## Maturity

- The package is **experimental**. Both Earendil and Cloudflare say the API can still change ([earendil.com](https://earendil.com/posts/pi-durable/), [Cloudflare docs](https://developers.cloudflare.com/agents/harnesses/pi/)).
- It moves fast: 1.0.0 on 2026-10-01, 1.0.4 on 2026-10-05, 1.1.0 by 2026-10-07. Community projects pin exact 1.0.x versions ([piindex.dev](https://piindex.dev/topics/pi-durable/)).
- A real ecosystem already exists: chat bots, a Slack/team agent, an iMessage bot, Home Assistant, and a Cloudflare Agents SDK adapter. All are early and mostly self-hosted ([piindex.dev](https://piindex.dev/topics/pi-durable/)).

## Fit with our plan

Our scoped plan makes `/api/chat` a tool loop: `search_corpus`, `get_surah`, `render_results`. The model decides when to search. Only `render_results` sends a doc to the reader. pi-durable can host that loop:

| Our need | pi-durable gives |
|---|---|
| Tool-calling agent loop | Built in. `pi.generation` calls the model, owns the tool tasks, and hands the run to the next turn. |
| Multi-turn history | Stored in the transcript. No client-side `history` array needed. |
| Crash safety | Checkpoints after every step. A cut-off model request is sent again. |
| Doc state | The `ResponseDoc` can live in a document, changed in the same commit as the render tool call. |
| UI state | `viewState()` can replace our hand-made SSE `delta`/`doc` events. |
| Follow-ups while busy | `steer()` queues a correction into the running turn. |

## Risks for this project

1. **Runtime shape.** Our app is a Next.js route. A harness needs one long-running process that owns its storage. We would run the harness in a persistent Node process next to Next.js, and the SSE route would attach to it. This is new moving parts.
2. **Experimental API.** Expect breaking changes. Pin the exact version.
3. **Storage choice.** We run Postgres. pi-durable ships SQLite/JSONL/memory. A community Postgres backend exists (`@netzlabor/pi-durable-postgres`) but it is unofficial. One SQLite file would also work for a single-server app.
4. **Model access.** We use OpenRouter through the OpenAI SDK. pi-durable uses pi-ai. We must confirm pi-ai can point at our OpenRouter base URL and key.
5. **Simplicity cost.** Our tool loop is about one file (agent.ts). pi-durable brings three dependencies, a registry, and a process boundary. For one chat panel, that is heavy. The payoff grows if we later want saved sessions, resume, steering, or several agents.

## Verdict

**Feasible but not yet justified.** The tool loop plan needs only a small loop in `agent.ts`. pi-durable is the right base if this app grows into a product with persistent study sessions, crash recovery, and real-time multi-client views. It is the wrong base for a v1 search feature: experimental API, extra process, and three new dependencies for problems we do not have yet.

Recommended path: build the scoped tool loop with the OpenAI SDK now. Keep the tools as plain functions so they can move into pi-durable extensions later. Revisit pi-durable when sessions must survive restarts or when more than one client must watch one conversation.

## Sources

- Used: [earendil.com/posts/pi-durable](https://earendil.com/posts/pi-durable/) · [package README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/README.md) · [Cloudflare Agents docs](https://developers.cloudflare.com/agents/harnesses/pi/) · [piindex.dev community list](https://piindex.dev/topics/pi-durable/) · [mindstudio.ai analysis](https://www.mindstudio.ai/blog/pi-durable-long-running-agents) · npm registry (version 1.1.0)
- Dropped: none
- Unverified: pi-ai support for custom OpenRouter base URLs. Test before any adoption decision.