# Query-Response View — UX Plan

Reference for the AI-driven reading experience in the Tafseer app.
Demo: `demos/07-query-response.html` (static mock of this spec).

## Concept

The chat panel (right) is the query engine; the center panel is a rendered
**response document**. When the user asks a cross-cutting question — e.g.
*"all information related to inheritance laws"* — the agent retrieves every
relevant ayah across the whole corpus and renders them in the center panel,
**preserving the material's structure**:

```
Query response document
  └─ Juz n            (juz divider, styled like the reader)
       └─ Surah n     (surah header: name EN + AR, meta chips)
            └─ Ayah   (full manuscript-style block: arabic, translation,
                       full section commentary, relevance chip)
```

The user scrolls continuously through multiple juz inside one response.
Matches are NOT excerpts: each hit renders the full section commentary it
belongs to, so the reading flow stays intact.

## Decisions (agreed)

1. **No "clear query" button.** To move on, the user either picks a surah/
   section from the explorer (left) or asks something new in chat. A query
   that was rendered before must remain **re-navigable** — the explorer
   keeps recent queries as entries (e.g. under a "Recent queries" group)
   so the user can return to a previous response document.
2. **Ordering is canonical**: Juz 1 → 30, then surah number, then ayah
   number. Relevance is surfaced as a small chip/badge per matched ayah
   (e.g. `0.92` or High/Medium), never as the sort order.
3. **Chat refines the view live.** Follow-ups like *"only the Madani
   ones"* or *"drop the tafsir excerpts"* re-render the current response
   document. The chat shows a small "refining current view" indicator when
   this happens, as opposed to starting a new response document.
4. **Full section commentary per match** (no excerpt-only blocks).

## UI contract

Center panel (response document mode):
- Sticky top bar shows the query as the crumb: `Query / "inheritance laws"`
  + match count (`23 ayat · 4 juz · 3 surahs`).
- Body: for each juz — kicker line (`Juz 2 · 2 surahs · 9 ayat`), ornamental
  emerald divider, then surah headers and ayah blocks exactly like the
  standard reader (same classes/styles as demo 06).
- No pagination; the document is one continuous scroll.

Explorer (left):
- While a response document is open, shows it as the selected item under
  "Recent queries" (plus the normal Juz tree above it).

Chat (right):
- The user's query message carries a "rendered in reader ↗" affordance.
- Follow-ups that refine show the indicator (see decision 3); follow-ups
  that go off-topic start a new response document.

## Data flow (maps to PLAN.md schema)

1. Chat message → retrieval (hybrid pgvector + tsvector) over
   `commentary` + `ayah.translation` chunks.
2. Hits are grouped by their metadata: `juz → surah → section → ayah`.
3. API returns a **response document**: ordered groups + relevance score
   per hit + the original query id (persisted for re-navigation).
4. Frontend renders groups with the same components as the reading view —
   the response document is "just" a virtual surah/juz tree, so no new
   rendering path is needed.

## Open items

- How recent queries persist (session-only vs saved per user) — decide later.
- Whether a surah header inside a response should deep-link into the normal
  reader (nice-to-have).
