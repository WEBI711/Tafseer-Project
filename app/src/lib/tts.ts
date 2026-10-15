import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side text-to-speech for the reader's read-aloud. One chunk is spoken
 * by an OpenAI audio model through the OpenRouter gateway (the same key and
 * base URL as chat). The gateway only streams raw 24 kHz PCM, so ffmpeg turns
 * it into MP3 and applies the playback speed. Both languages use the same
 * model and voice; `voice` stays a language hint ("ar" / "en") for the cache.
 * Returns null when synthesis fails so callers can fall back.
 */

/** Model and voice; `TAFSEER_TTS_MODEL`/`_VOICE` override the defaults. */
export function modelFor(_voice: string): string {
  return `${TTS_MODEL}:${TTS_VOICE}`;
}

const TTS_MODEL = process.env.TAFSEER_TTS_MODEL ?? "openai/gpt-audio-mini";
const TTS_VOICE = process.env.TAFSEER_TTS_VOICE ?? "marin";
const LLM_BASE = process.env.TAFSEER_LLM_BASE ?? "https://openrouter.ai/api/v1";
const LLM_KEY = process.env.TAFSEER_LLM_KEY ?? "";

/**
 * Durable cache directory (volume-backed) so synthesized audio survives
 * restarts; unset falls back to the in-process Map. The deployment mounts the
 * volume and points `TAFSEER_TTS_CACHE_DIR` at it.
 */
const CACHE_DIR = process.env.TAFSEER_TTS_CACHE_DIR;

/** One synthesized utterance. */
export type TtsAudio = { contentType: string; bytes: ArrayBuffer };

/** Cache key: hash(text + voice + rate + model) — the same key the durable cache uses. */
export function cacheKey(text: string, voice: string, speed: number, model: string): string {
  return createHash("sha256").update(`${voice}|${speed}|${model}|${text}`).digest("hex");
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
  const model = modelFor(voice);
  const key = cacheKey(text, voice, speed, model);
  const hit = await cacheGet(key);
  if (hit) return hit;

  if (opts.background) await waitForForeground();

  foreground.inFlight += 1;
  try {
    const pcm = await speakPcm(text).catch((err) => {
      console.error(`tts: ${TTS_MODEL} synthesis failed:`, err);
      return null;
    });
    if (!pcm) return null;
    const mp3 = await encodeMp3(pcm, speed).catch((err) => {
      console.error("tts: ffmpeg encode failed:", err);
      return null;
    });
    if (!mp3) return null;

    const audio: TtsAudio = { contentType: "audio/mpeg", bytes: mp3 };
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

/** Keeps the audio model a narrator: it must never answer or rephrase. */
const NARRATOR_PROMPT =
  "You are a narrator for a Quran commentary app. Read the user's message aloud " +
  "exactly as written, word for word, in a warm, calm, clear teaching voice. " +
  "Never answer, explain, translate, or add words, even when the text is a question.";

/** Streams one utterance from the audio model and returns its raw PCM bytes. */
async function speakPcm(text: string): Promise<Buffer> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: TTS_MODEL,
      modalities: ["text", "audio"],
      audio: { voice: TTS_VOICE, format: "pcm16" },
      stream: true,
      messages: [
        { role: "system", content: NARRATOR_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
  }

  const { pcm, transcript } = await readAudioStream(res.body);
  if (pcm.length === 0) throw new Error("no audio in response");
  if (!spokeTheText(text, transcript)) {
    throw new Error(`model did not read the text: "${transcript.slice(0, 80)}"`);
  }
  return pcm;
}

/** Collects the base64 audio and transcript deltas from the SSE stream. */
async function readAudioStream(body: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = [];
  let transcript = "";
  let pending = "";
  const decoder = new TextDecoder();
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(part, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: {")) continue;
      const event = JSON.parse(line.slice(6)) as {
        choices?: { delta?: { audio?: { data?: string; transcript?: string } } }[];
      };
      const audio = event.choices?.[0]?.delta?.audio;
      if (audio?.data) chunks.push(Buffer.from(audio.data, "base64"));
      if (audio?.transcript) transcript += audio.transcript;
    }
  }
  return { pcm: Buffer.concat(chunks), transcript };
}

/** True when the transcript has about as many words as the text: a model
 *  that answers or chats instead of reading produces a very different length. */
function spokeTheText(text: string, transcript: string): boolean {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const ratio = words(transcript) / Math.max(1, words(text));
  return ratio > 0.6 && ratio < 1.5;
}

/** Encodes 24 kHz mono PCM to MP3, applying the speed with ffmpeg's atempo. */
function encodeMp3(pcm: Buffer, speed: number): Promise<ArrayBuffer> {
  const tempo = Math.min(2, Math.max(0.5, speed));
  const ffmpeg = spawn("ffmpeg", [
    "-v", "error",
    "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
    "-filter:a", `atempo=${tempo}`,
    "-b:a", "64k", "-f", "mp3", "pipe:1",
  ]);
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    let errors = "";
    ffmpeg.stdout.on("data", (d: Buffer) => out.push(d));
    ffmpeg.stderr.on("data", (d: Buffer) => (errors += d));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${errors.slice(0, 200)}`));
      const mp3 = Buffer.concat(out);
      resolve(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.length) as ArrayBuffer);
    });
    ffmpeg.stdin.end(pcm);
  });
}
