import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side bridge to the VoiceStudio TTS engine that reads the reader aloud.
 * The engine exposes an OpenAI-compatible endpoint: POST {base}/v1/audio/speech
 * with `Authorization: Bearer $OMNIVOICE_API_KEY` and body
 * `{ model, voice, input, speed }`, answering with audio/mpeg.
 * The engine runs the fast CPU model (sherpa-onnx VITS, vits-mms ara+en) per
 * its server-side config; the model id is passed through so it can be switched
 * there without touching this file. Returns null when the engine is
 * unreachable so callers can fall back.
 */

/** Engine URL; `voice` is a language hint ("ar" / "en"), `speed` a rate multiplier. */
export const TTS_URL =
  process.env.TAFSEER_TTS_URL ??
  process.env.OMNIVOICE_BASE_URL ??
  "http://omnivoice-studio:3900";

/** Model id the engine serves; `TAFSEER_TTS_MODEL` overrides it. */
export const TTS_MODEL = process.env.TAFSEER_TTS_MODEL ?? "vits-mms-ara-eng";
const TTS_API_KEY = process.env.OMNIVOICE_API_KEY ?? "";

/**
 * Durable cache directory (volume-backed) so synthesized audio survives
 * restarts; unset falls back to the in-process Map. The deployment mounts the
 * volume and points `TAFSEER_TTS_CACHE_DIR` at it.
 */
const CACHE_DIR = process.env.TAFSEER_TTS_CACHE_DIR;

/** One synthesized utterance. */
export type TtsAudio = { contentType: string; bytes: ArrayBuffer };

/** Cache key: hash(text + voice + rate) — the same key the durable cache uses. */
export function cacheKey(text: string, voice: string, speed: number): string {
  return createHash("sha256").update(`${voice}|${speed}|${text}`).digest("hex");
}

/** True when the audio for `key` is already in the cache (no bytes read). */
export async function isCached(key: string): Promise<boolean> {
  if (!CACHE_DIR) return memoryCache.has(key);
  try {
    await stat(path.join(CACHE_DIR, `${key}.audio`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesizes one chunk via the engine, serving repeats from the durable
 * cache. `background: true` marks pre-generation work: it stands down while
 * any foreground request is synthesizing, so it never blocks the app.
 */
export async function synthesize(
  text: string,
  voice: string,
  speed: number,
  opts: { background?: boolean } = {},
): Promise<TtsAudio | null> {
  const key = cacheKey(text, voice, speed);
  const hit = await cacheGet(key);
  if (hit) return hit;

  if (opts.background) await waitForForeground();

  foreground.inFlight += 1;
  try {
    const upstream = await fetch(`${TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TTS_API_KEY}`,
      },
      body: JSON.stringify({ model: TTS_MODEL, voice, input: text, speed }),
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
    await cachePut(key, audio);
    return audio;
  } finally {
    foreground.inFlight -= 1;
  }
}

/* ---------------- helpers ---------------- */

/** In-memory fallback used only when no durable cache dir is configured. */
const memoryCache = new Map<string, TtsAudio>();
const MAX_CACHE_ENTRIES = 200;

/** Foreground synthesis count — background work yields while it is above zero. */
const foreground = { inFlight: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForForeground(): Promise<void> {
  while (foreground.inFlight > 0) await sleep(200);
}

/** File layout: `<sha256>.audio` = content-type line + raw audio bytes. */
function cachePath(key: string): string {
  return path.join(CACHE_DIR ?? "", `${key}.audio`);
}

async function cacheGet(key: string): Promise<TtsAudio | null> {
  if (!CACHE_DIR) return memoryCache.get(key) ?? null;
  let raw: Buffer;
  try {
    raw = await readFile(cachePath(key));
  } catch {
    return null;
  }
  const sep = raw.indexOf(0x0a);
  if (sep < 0) return null;
  const body = new ArrayBuffer(raw.length - sep - 1);
  new Uint8Array(body).set(raw.subarray(sep + 1));
  return {
    contentType: raw.subarray(0, sep).toString("utf8") || "audio/mpeg",
    bytes: body,
  };
}

async function cachePut(key: string, audio: TtsAudio): Promise<void> {
  if (!CACHE_DIR) {
    // The cache never outlives the process and resets wholesale once full,
    // so stale entries cannot linger.
    if (memoryCache.size >= MAX_CACHE_ENTRIES) memoryCache.clear();
    memoryCache.set(key, audio);
    return;
  }
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const head = Buffer.from(`${audio.contentType}\n`, "utf8");
    await writeFile(cachePath(key), Buffer.concat([head, Buffer.from(audio.bytes)]));
  } catch (err) {
    console.error(`tts: durable cache write to ${CACHE_DIR} failed:`, err);
  }
}
