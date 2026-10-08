"use client";

/**
 * Section-by-section read-aloud for the reader. The Reader builds the section
 * list (the document intro plus one section per section heading) and hands it
 * here; this component owns the transport — play/pause/stop, a shared
 * playback rate, and the "keep reading" switch that flows playback into the
 * following sections until the end of the work — plus the follow-along
 * highlight on the block currently being read.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  primeVoices,
  speakSupported,
  startSpeaking,
  type SpeechSegment,
  type Speaker,
} from "@/lib/speech";

/** Spoken form of one rendered block. */
export type SpeechBlock = { ord: number; text: string; lang: string };

/** One playable stretch: a section heading plus everything under it. */
export type SpeechSection = {
  /** Source document within the work (`doc-0`, `doc-1`, … in the DOM). */
  docIndex: number;
  /** Ord of the section_heading that starts the section (null: document intro). */
  headingOrd: number | null;
  /** Ord of the section's first block — where its play button sits. */
  firstOrd: number;
  blocks: SpeechBlock[];
};

type DictationApi = {
  sections: SpeechSection[];
  /** Starts the section whose first block sits at `ord` in document `docIndex`. */
  playFrom: (docIndex: number, ord: number) => void;
  activeSection: SpeechSection | null;
  playing: boolean;
  paused: boolean;
  togglePause: () => void;
  stop: () => void;
  rate: number;
  setRate: (rate: number) => void;
  keepReading: boolean;
  setKeepReading: (on: boolean) => void;
  readHeadings: boolean;
  setReadHeadings: (on: boolean) => void;
};

const DictationContext = createContext<DictationApi | null>(null);

export function useDictation(): DictationApi | null {
  return useContext(DictationContext);
}

const RATE_KEY = "dictation-rate";
const KEEP_KEY = "dictation-keep-reading";
const HEADINGS_KEY = "dictation-read-headings";

const RATES = [0.75, 1, 1.25, 1.5, 2];

export default function Dictation({
  sections,
  children,
}: {
  sections: SpeechSection[];
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activeSection, setActiveSection] = useState<SpeechSection | null>(null);
  const [rate, setRateState] = useState(1);
  const [keepReading, setKeepReadingState] = useState(true);
  const [readHeadings, setReadHeadingsState] = useState(true);

  const speakerRef = useRef<Speaker | null>(null);
  const activeElRef = useRef<HTMLElement | null>(null);
  // refs so the utterance callbacks always see the latest settings
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const keepRef = useRef(keepReading);
  keepRef.current = keepReading;
  const headingsRef = useRef(readHeadings);
  headingsRef.current = readHeadings;

  useEffect(() => {
    setMounted(true);
    primeVoices();
    const stored = (key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    const r = Number(stored(RATE_KEY));
    if (RATES.includes(r)) setRateState(r);
    if (stored(KEEP_KEY) === "0") setKeepReadingState(false);
    if (stored(HEADINGS_KEY) === "0") setReadHeadingsState(false);
  }, []);

  const highlight = useCallback((block: SpeechBlock, docIndex: number) => {
    const el = document.querySelector<HTMLElement>(
      `#doc-${docIndex} [data-ord="${block.ord}"]`,
    );
    if (!el || el === activeElRef.current) return;
    activeElRef.current?.classList.remove("spk-active");
    el.classList.add("spk-active");
    activeElRef.current = el;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const clearHighlight = useCallback(() => {
    activeElRef.current?.classList.remove("spk-active");
    activeElRef.current = null;
  }, []);

  const stop = useCallback(() => {
    speakerRef.current?.stop();
    speakerRef.current = null;
    setActiveSection(null);
    setPlaying(false);
    setPaused(false);
    clearHighlight();
  }, [clearHighlight]);

  const playSection = useCallback(
    (i: number) => {
      const secs = sectionsRef.current;
      if (i >= secs.length) {
        stop();
        return;
      }
      const section = secs[i];
      speakerRef.current?.stop();
      speakerRef.current = null;
      setPlaying(true);
      setPaused(false);
      setActiveSection(section);
      // one segment per block; the heading block itself is muted when the
      // reader turns headings off (intro sections have no heading to mute)
      const skipHeading = section.headingOrd !== null && !headingsRef.current;
      const segments: SpeechSegment[] = section.blocks
        .filter((_, i) => !(skipHeading && i === 0))
        .map((b) => ({ text: b.text, lang: b.lang }));
      let ended = false;
      const speaker = startSpeaking(segments, {
        rate: rateRef.current,
        onSegment: (bi) => {
          const block = section.blocks[skipHeading ? bi + 1 : bi];
          if (block) highlight(block, section.docIndex);
        },
        onEnd: () => {
          ended = true;
          speakerRef.current = null;
          if (keepRef.current && i + 1 < sectionsRef.current.length) playSection(i + 1);
          else stop();
        },
      });
      if (!speaker) {
        stop();
        return;
      }
      // an empty queue fires onEnd synchronously and may already have started
      // the next section — only install our speaker when it did not
      if (!ended) speakerRef.current = speaker;
    },
    [highlight, stop],
  );

  const playFrom = useCallback(
    (docIndex: number, ord: number) => {
      const i = sectionsRef.current.findIndex(
        (s) => s.docIndex === docIndex && s.firstOrd === ord,
      );
      if (i !== -1) playSection(i);
    },
    [playSection],
  );

  const togglePause = useCallback(() => {
    const speaker = speakerRef.current;
    if (!speaker) return;
    if (paused) {
      speaker.resume();
      setPaused(false);
    } else {
      speaker.pause();
      setPaused(true);
    }
  }, [paused]);

  // playback never survives navigation to another document or unmount
  useEffect(() => stop(), [sections, stop]);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    speakerRef.current?.setRate(r);
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {}
  }, []);

  const setKeepReading = useCallback((on: boolean) => {
    setKeepReadingState(on);
    try {
      localStorage.setItem(KEEP_KEY, on ? "1" : "0");
    } catch {}
  }, []);

  const setReadHeadings = useCallback((on: boolean) => {
    setReadHeadingsState(on);
    try {
      localStorage.setItem(HEADINGS_KEY, on ? "1" : "0");
    } catch {}
  }, []);

  const api: DictationApi = {
    sections,
    playFrom,
    activeSection,
    playing,
    paused,
    togglePause,
    stop,
    rate,
    setRate,
    keepReading,
    setKeepReading,
    readHeadings,
    setReadHeadings,
  };

  // speech is browser-only, and an empty section list has nothing to play
  if (!mounted || !speakSupported() || sections.length === 0) {
    return <DictationContext value={null}>{children}</DictationContext>;
  }

  return (
    <DictationContext value={api}>
      {children}
      <div className={`speech-bar${playing ? " on" : ""}`}>
        {playing ? (
          <>
            <button className="icon-btn" onClick={togglePause} title={paused ? "Resume" : "Pause"}>
              {paused ? "▶" : "⏸"}
            </button>
            <button className="icon-btn" onClick={stop} title="Stop">
              ⏹
            </button>
          </>
        ) : (
          <span className="speech-hint">Read aloud</span>
        )}
        <label className="speech-opt">
          <input
            type="checkbox"
            checked={keepReading}
            onChange={(e) => setKeepReading(e.target.checked)}
          />
          Keep reading
        </label>
        <label className="speech-opt">
          <input
            type="checkbox"
            checked={readHeadings}
            onChange={(e) => setReadHeadings(e.target.checked)}
          />
          Headings
        </label>
        <label className="speech-rate">
          Rate
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </DictationContext>
  );
}
