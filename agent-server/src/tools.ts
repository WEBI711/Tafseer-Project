import { Type } from "@earendil-works/pi-ai";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type Extension,
} from "@earendil-works/pi-durable";
import { buildDoc, retrieve, surahView } from "../../app/src/lib/search";
import type { Hit, ResponseDoc } from "../../app/src/lib/search";

/** The rendered document of this conversation, committed by render_results. */
export const RenderedDoc = defineDoc<{ doc: ResponseDoc | null }>({
  kind: "app.response_doc",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ doc: null }),
});

const SYSTEM_PROMPT = () => `You are the tafseer study companion of a Quran commentary app.
You talk with the user in a relaxed conversation. You decide yourself when to search.

Grounding rules — these always win:
- Your ONLY source of knowledge is what your tools return. Never answer from
  your own general knowledge about the Quran, tafseer, or Islam.
- Cite every claim as (S:A) with the surah:ayah of the passage you relied on.
- Any quoted text must be copied VERBATIM from tool output. Never paraphrase
  a quote or invent wording.
- If a search returns nothing relevant, say so, then try different wording or
  a narrower surah/juz filter. If nothing works, tell the user plainly.
- You may summarise and explain in your own words, but quotes stay exact.

When to render:
- Call render_results ONLY when the user asked for passages, or asked a
  search-style question whose answer is a set of ayat.
- A plain question that one or two passages answer needs no render.
- Never render on small talk, clarifications, or refusals.

Style: short paragraphs, no markdown headers, no HTML.`;

const MAX_OUTPUT_CHARS = 15_000;

const searchCorpusTool = defineTool({
  name: "search_corpus",
  description:
    "Search the tafseer corpus. Returns ranked commentary passages with their surah:ayah. " +
    "Use this for any question about the corpus. Re-search with different wording when results are weak.",
  parameters: Type.Object({
    query: Type.String({ description: "What to search for, in natural words" }),
    surah: Type.Optional(Type.Number({ description: "Limit to one surah number" })),
    juz: Type.Optional(Type.Number({ description: "Limit to one juz number" })),
    limit: Type.Optional(Type.Number({ description: "Max passages, default 12, max 30" })),
  }),
  replay: "safe",
  execute: async (args, api) => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 30);
    const hits = await retrieve(args.query, { surah: args.surah, juz: args.juz }, limit);
    if (!hits.length) {
      return {
        content: [{ type: "text", text: "No passages matched. Try different wording." }],
      };
    }
    let out = "";
    for (const h of hits) {
      const block = formatHit(h);
      if (out.length + block.length > MAX_OUTPUT_CHARS) break;
      out += block;
    }
    return { content: [{ type: "text", text: out.trim() }] };
  },
});

const getSurahTool = defineTool({
  name: "get_surah",
  description:
    "Read one full surah from the corpus: sections, ayat with translations, and verbatim commentary, in order.",
  parameters: Type.Object({ number: Type.Number({ description: "Surah number, 1-114" }) }),
  replay: "safe",
  execute: async (args) => {
    const view = await surahView(args.number);
    if (!view) {
      return { content: [{ type: "text", text: `Surah ${args.number} is not in the corpus.` }] };
    }
    let out = "";
    for (const d of view.documents) {
      for (const b of d.blocks) {
        const line = formatBlock(b.kind, b.text);
        if (out.length + line.length > MAX_OUTPUT_CHARS) {
          out += "\n[truncated]";
          return { content: [{ type: "text", text: out }] };
        }
        out += line;
      }
    }
    return { content: [{ type: "text", text: out.trim() }] };
  },
});

const renderResultsTool = defineTool({
  name: "render_results",
  description:
    "Render ayat in the reader pane. Only call this when the user asked for passages or a " +
    "search-style answer. The ayat must come from passages your tools returned in this conversation.",
  parameters: Type.Object({
    title: Type.String({ description: "Short title for the rendered set" }),
    ayah_refs: Type.Array(
      Type.Object({
        surah: Type.Number(),
        ayah: Type.Number(),
      }),
      { description: "The surah:ayah pairs to render" },
    ),
  }),
  replay: "safe",
  execute: async (args, api, context) => {
    const doc = await buildDoc(args.ayah_refs, args.title);
    if (!doc) {
      return {
        content: [{ type: "text", text: "None of those ayat have commentary in the corpus." }],
      };
    }
    await api.commit(
      async (tx) => {
        (await tx.doc(RenderedDoc, api.conversationId)).doc = doc;
      },
      context,
    );
    return {
      content: [
        {
          type: "text",
          text: `Rendered ${doc.stats.ayat} ayat from ${doc.stats.surahs} surah(s) in the reader.`,
        },
      ],
    };
  },
});

export const Tafseer: Extension = defineExtension({
  name: "tafseer",
  sections: [section("tafseer", SYSTEM_PROMPT, { tag: false })],
  tools: [searchCorpusTool, getSurahTool, renderResultsTool],
});


// Helpers

function formatHit(h: Hit): string {
  const ref = h.ayah_number !== null ? `${h.surah_number}:${h.ayah_number}` : `Surah ${h.surah_number}`;
  const head = `\n[${ref} · juz ${h.cjuz ?? "?"} · ${h.source_file ?? "unknown source"}]\n`;
  const translation = h.translation ? `Ayah translation: ${h.translation}\n` : "";
  return head + translation + clip(h.content, 1_500) + "\n";
}

function formatBlock(kind: string, text: string): string {
  const label =
    kind === "arabic" ? "arabic"
    : kind === "translation" ? "translation"
    : kind === "section_heading" || kind === "heading" ? "heading"
    : kind === "juz_header" || kind === "surah_header" ? "header"
    : "prose";
  return `\n<${label}>${clip(text, 600)}</${label}>\n`;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}