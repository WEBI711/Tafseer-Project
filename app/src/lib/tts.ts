import { createHash } from "node:crypto";

/**
 * Server-side bridge to the TTS engine that reads the reader aloud. The engine
 * runs on the host itself (outside docker-compose), listens on localhost only,
 * and needs no API keys — the only configuration is its URL via env var.
 * POSTs `{ text, voice, speed }` and gets the synthesized audio back.
 */

/** Engine URL; `voice` is a language hint ("ar" / "en"), `speed` a rate multiplier. */
export const TTS_URL = process.env.TAFSEER_TTS_URL ?? "http://127.0.0.1:3900";

/** One synthesized utterance. */
export type TtsAudio = { contentType: string; bytes: ArrayBuffer };

/** In-memory audio cache, keyed by hash(text + voice + speed). */
const cache = new Map<string, TtsAudio>();
const MAX_CACHE_ENTRIES = 200;

/** Synthesizes one chunk via the engine, serving repeats from the cache.
 *  Returns null when the engine is unreachable so callers can fall back. */
export async function synthesize(
  text: string,
  voice: string,
  speed: number,
): Promise<TtsAudio | null> {
  const key = createHash("sha256").update(`${voice}|${speed}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const upstream = await fetch(`${TTS_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  }).catch(() => undefined);
  if (!upstream?.ok) return null;

  const audio: TtsAudio = {
    contentType: upstream.headers.get("content-type") ?? "audio/mpeg",
    bytes: await upstream.arrayBuffer(),
  };
  // Trivial invalidation: the cache never outlives the process and resets
  // wholesale once full, so stale entries cannot linger.
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, audio);
  return audio;
}
