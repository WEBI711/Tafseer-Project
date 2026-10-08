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
