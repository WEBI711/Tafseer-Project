/**
 * Background pre-generation queue: walks the corpus in reading order (juz 1
 * up, per the tree) and renders every speakable chunk into the durable TTS
 * cache, so the first play of a section finds warm audio instead of waiting
 * minutes on a cold engine. Runs one chunk at a time in this process, yields
 * between chunks and stands down while foreground requests synthesize, so it
 * never blocks the app. Resumable: cached chunks are skipped, so restarting
 * (after a stop or a process restart) continues where the last run left off
 * without re-synthesizing anything already rendered.
 */
import { tree } from "./db";
import { surahView } from "./search";
import { chunkText, speakableText, speechLang } from "./speech";
import { cacheKey, isCached, modelFor, synthesize } from "./tts";

/** Progress snapshot for /api/tts/pregen. */
export type PregenStatus = {
  running: boolean;
  /** True when the run was cancelled (POST DELETE) rather than completed. */
  stopped: boolean;
  /** Surah number currently being rendered, null when idle or finished. */
  surah: number | null;
  done: number;
  cached: number;
  synthesized: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const idle: PregenStatus = {
  running: false,
  stopped: false,
  surah: null,
  done: 0,
  cached: 0,
  synthesized: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

let state: PregenStatus = { ...idle };
let cancel = false;

/** Pre-generation is already running — starting again is a no-op. */
export function pregenRunning(): boolean {
  return state.running;
}

export function pregenStatus(): PregenStatus {
  return { ...state };
}

/** Kicks off one queue run in the background; returns false when busy. */
export function startPregen(): boolean {
  if (state.running) return false;
  cancel = false;
  state = { ...idle, running: true, startedAt: new Date().toISOString() };
  void run();
  return true;
}

export function stopPregen(): void {
  cancel = true;
}

/* ---------------- helpers ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  try {
    // Reading order is the tree's: juz 1 up, surah number, from-ayah. A surah
    // spanning two juzes appears twice; its chunks cache-hit on the second pass.
    const t = await tree();
    const surahNumbers = [...new Set(t.surahs.map((s) => s.number))];
    outer: for (const number of surahNumbers) {
      if (cancel) break;
      state.surah = number;
      const view = await surahView(number);
      if (!view) continue;
      for (const doc of view.documents) {
        if (cancel) break outer;
        for (const block of doc.blocks) {
          if (cancel) break outer;
          const voice = speechLang(block.kind);
          for (const chunk of chunkText(speakableText(block))) {
            if (cancel) break outer;
            await renderChunk(chunk, voice);
            // Low-priority: never synthesize back-to-back, let the app breathe.
            await sleep(100);
          }
        }
      }
    }
    state.stopped = cancel;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.running = false;
    state.surah = null;
    state.finishedAt = new Date().toISOString();
  }
}

/** Renders one client-shaped chunk, skipping whatever is already cached. */
async function renderChunk(chunk: string, voice: string): Promise<void> {
  state.done += 1;
  // Rate 1 is the default playback rate — the warm case worth pre-rendering.
  if (await isCached(cacheKey(chunk, voice, 1, modelFor(voice)))) {
    state.cached += 1;
    return;
  }
  const audio = await synthesize(chunk, voice, 1, { background: true });
  if (audio) state.synthesized += 1;
  else state.failed += 1;
}
