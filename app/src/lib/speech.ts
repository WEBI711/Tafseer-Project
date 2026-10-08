/**
 * Voice helpers on top of the browser's Web Speech API — no server round-trip
 * and no extra dependency. `startDictation` transcribes microphone speech into
 * text for the chat composer; `speakText` reads text aloud. Both degrade to
 * no-ops when the browser lacks support (callers check the `*Supported`
 * helpers before rendering the UI).
 */

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };
type RecognitionResultList = ArrayLike<RecognitionResult>;

type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, RecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== null;
}

export function speakSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export type Dictation = { stop: () => void };

/**
 * Starts one dictation session. `onText` receives the transcript so far
 * (final words plus the phrase still being spoken); `onEnd` fires when the
 * session closes, however it closes. Returns null when unsupported.
 */
export function startDictation(handlers: {
  onText: (text: string) => void;
  onEnd: () => void;
}): Dictation | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;

  let finalText = "";
  rec.onresult = (event) => {
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interimText += result[0].transcript;
    }
    handlers.onText(`${finalText} ${interimText}`.trim());
  };
  rec.onend = handlers.onEnd;
  rec.onerror = handlers.onEnd;
  rec.start();
  return { stop: () => rec.stop() };
}

export function stopSpeaking(): void {
  if (speakSupported()) window.speechSynthesis.cancel();
}

/** One stretch of text with its own language, e.g. Arabic vs English. */
export type SpeechSegment = { text: string; lang: string };

/** Transport for a `startSpeaking` queue. */
export type Speaker = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Applies to utterances not yet started — the current one keeps its rate. */
  setRate: (rate: number) => void;
};

/**
 * Reads a list of segments in document order. Long text is split into queued
 * utterances (browsers truncate very long ones), Arabic gets an `ar` voice
 * when the browser ships one. `onSegment` fires as each segment starts so
 * callers can highlight what is being read. Returns null when unsupported.
 */
export function startSpeaking(
  segments: SpeechSegment[],
  opts: { rate?: number; onSegment?: (index: number) => void; onEnd: () => void },
): Speaker | null {
  if (!speakSupported()) {
    opts.onEnd();
    return null;
  }
  const queue = segments.flatMap((s, seg) =>
    chunkText(s.text).map((text) => ({ text, lang: s.lang, seg })),
  );
  let index = 0;
  let stopped = false;
  let rate = opts.rate ?? 1;

  const speakNext = () => {
    if (stopped) return;
    const item = queue[index];
    if (!item) {
      opts.onEnd();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.lang;
    utterance.rate = rate;
    const voice = pickVoice(item.lang);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (!stopped) {
        index += 1;
        speakNext();
      }
    };
    utterance.onerror = () => {
      if (!stopped) {
        index += 1;
        speakNext();
      }
    };
    opts.onSegment?.(item.seg);
    window.speechSynthesis.speak(utterance);
  };

  speakNext();
  return {
    pause: () => window.speechSynthesis.pause(),
    resume: () => window.speechSynthesis.resume(),
    stop: () => {
      stopped = true;
      // Chrome ignores cancel() while paused unless the queue is resumed first
      window.speechSynthesis.resume();
      window.speechSynthesis.cancel();
    },
    setRate: (r) => {
      rate = r;
    },
  };
}

/** Warms the voice list — Chrome populates it asynchronously after first use. */
export function primeVoices(): void {
  if (speakSupported()) window.speechSynthesis.getVoices();
}

/* ---------------- helpers ---------------- */

/** Longest utterance we queue; browsers silently truncate beyond this. */
const MAX_CHUNK = 200;

/** Splits long text at sentence marks, falling back to word boundaries. */
function chunkText(text: string, max = MAX_CHUNK): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i > max - 80 && i > 0; i--) {
      if (".!?؟؛:".includes(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut < 0) {
      cut = rest.lastIndexOf(" ", max);
      if (cut < 0) cut = max;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** First voice matching a language prefix ("ar", "en"…); null = engine default. */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  return (
    window.speechSynthesis
      .getVoices()
      .find((v) => v.lang.toLowerCase().startsWith(lang)) ?? null
  );
}

/** Reads `text` aloud, cutting off anything already playing. */
export function speakText(text: string, onEnd?: () => void): void {
  if (!speakSupported()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}
