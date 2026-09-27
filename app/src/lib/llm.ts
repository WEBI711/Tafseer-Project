import OpenAI from "openai";

/**
 * LLM gateway (OpenRouter by default).
 *
 * Env names are prefixed with TAFSEER_ on purpose: developer shells commonly
 * export their own OPENAI_API_KEY, which would shadow a plain name and send
 * requests to the wrong provider.
 */
export const client = new OpenAI({
  apiKey: process.env.TAFSEER_LLM_KEY,
  baseURL: process.env.TAFSEER_LLM_BASE ?? "https://api.openai.com/v1",
});

export const EMBEDDING_MODEL =
  process.env.TAFSEER_EMBED_MODEL ?? "text-embedding-3-small";

/** Front-end agent model (per project decision). */
export const CHAT_MODEL = process.env.TAFSEER_CHAT_MODEL ?? "glm-5.3-flash";

export async function embed(text: string): Promise<number[]> {
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: [text],
  });
  return res.data[0].embedding;
}