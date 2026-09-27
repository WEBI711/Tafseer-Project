import { CHAT_MODEL, client } from "./llm";
import type { Hit } from "./search";

const SYSTEM = `You are the tafseer study companion of a Quran commentary app.
You answer questions about the Quran using ONLY the retrieved passages provided.

Rules:
- Cite every claim as (S:A) using the surah:ayah of the passage you relied on.
- Any quoted text must be copied VERBATIM from the passages. Never paraphrase
  a quote, trim it mid-sentence, or invent wording that is not in the passages.
- You may summarise and explain in your own words, but quotes stay exact.
- If the passages do not answer the question, say so plainly.
- Be concise: short paragraphs, no markdown headers, no HTML.`;

function context(hits: Hit[], max = 8): string {
  return hits
    .slice(0, max)
    .map(
      (h) =>
        `[${h.surah_number}:${h.ayah_number ?? "-"} · ${h.source_file ?? "unknown source"}]\n${h.content}`,
    )
    .join("\n\n");
}

/** Streams the grounded answer token by token. */
export async function* answer(question: string, hits: Hit[]): AsyncGenerator<string> {
  const stream = await client.chat.completions.create({
    model: CHAT_MODEL,
    stream: true,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Question: ${question}\n\nRetrieved passages:\n${context(hits)}`,
      },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}