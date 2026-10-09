import { createHash } from "node:crypto";

/**
 * Server-side bridge to the VoiceStudio TTS engine that reads the reader aloud.
 * The engine exposes an OpenAI-compatible endpoint: POST {base}/v1/audio/speech
 * with `Authorization: Bearer $OMNIVOICE_API_KEY` and body
 * `{ model: "tts-1", voice, input, speed }`, answering with audio/mpeg.
 * Returns null when the engine is unreachable so callers can fall back.
 */

/** Engine URL; `voice` is a language hint ("ar" / "en"), `speed` a rate multiplier. */
export const TTS_URL =
  process.env.TAFSEER_TTS_URL ??
  process.env.OMNIVOICE_BASE_URL ??
  "http://omnivoice-studio:3900";
const TTS_API_KEY = process.env.OMNIVOICE_API_KEY ?? "";

/** One synthesized utterance. */
export type TtsAudio = { contentType: string; bytes: ArrayBuffer };

/** In-memory audio cache, keyed by hash(text + voice + speed). */
const cache = new Map<string, TtsAudio>();
const MAX_CACHE_ENTRIES = 200;

/** Synthesizes one chunk via the engine, serving repeats from the cache. */
export async function synthesize(
  text: string,
  voice: string,
  speed: number,
): Promise<TtsAudio | null> {
  const key = createHash("sha256").update(`${voice}|${speed}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const upstream = await fetch(`${TTS_URL}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TTS_API_KEY}`,
    },
    body: JSON.stringify({ model: "tts-1", voice, input: text, speed }),
  }).catch((err) => {
    console.error(`tts: engine unreachable at ${TTS_URL}:`, err);
    return undefined;
  });
  if (!upstream) return null;
  if (!upstream.ok) {
    console.error(
      `tts: engine returned ${upstream.status} ${upstream.statusText} for POST ${TTS_URL}/v1/audio/speech`,
    );
    return null;
  }

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
