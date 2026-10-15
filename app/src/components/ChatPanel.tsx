"use client";

import { useEffect, useRef, useState } from "react";
import type { Citation, Filters, ResponseDoc } from "@/lib/types";
import { dictationSupported, startDictation, type Dictation } from "@/lib/speech";
import { workLabel, type RecentQuery } from "./Workspace";

export type Message = {
  role: "q" | "a";
  text: string;
  streaming?: boolean;
  refine?: boolean;
  tool?: string;
  cites?: Citation[];
  docId?: string;
  docQuery?: string;
};

type Props = {
  messages: Message[];
  busy: boolean;
  currentDoc: ResponseDoc | null;
  recent: RecentQuery[];
  activeQueryId?: string;
  onOpenRecent: (r: RecentQuery) => void;
  onAsk: (question: string) => void;
  onRefine: (filters: Filters) => void;
  onShowInReader: (docId: string) => void;
  onCollapse: () => void;
};

export default function ChatPanel({
  messages,
  busy,
  currentDoc,
  recent,
  activeQueryId,
  onOpenRecent,
  onAsk,
  onRefine,
  onShowInReader,
  onCollapse,
}: Props) {
  const [draft, setDraft] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [listening, setListening] = useState(false);
  // Speech exists only in the browser, so wait until after hydration before
  // rendering the mic button — otherwise the server HTML won't match.
  const [mounted, setMounted] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => () => dictationRef.current?.stop(), []);
  const last = messages[messages.length - 1];
  const showSuggestions = Boolean(last && last.role === "a" && !last.streaming && currentDoc);

  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    dictationRef.current?.stop();
    setDraft("");
    onAsk(q);
  };

  const toggleDictation = () => {
    if (listening) {
      dictationRef.current?.stop();
      return;
    }
    const base = draft;
    const session = startDictation({
      onText: (text) => setDraft(base ? `${base} ${text}` : text),
      onEnd: () => {
        dictationRef.current = null;
        setListening(false);
      },
    });
    if (!session) return;
    dictationRef.current = session;
    setListening(true);
  };

  const topSurah = currentDoc?.groups[0];
  const juzes = [...new Set(currentDoc?.groups.map((g) => g.juz) ?? [])];

  return (
    <section className="chat">
      <div className="ch">
        <b>Search The Tafseer</b>
        <button className="icon-btn" onClick={onCollapse} title="Hide chat">
          ›
        </button>
      </div>

      <div className="thread">
        {recent.length > 0 && (
          <>
            <button
              className="juz queries"
              onClick={() => setRecentOpen((v) => !v)}
              title={recentOpen ? "Hide recent queries" : "Show recent queries"}
            >
              <span className="caret">{recentOpen ? "▾" : "▸"}</span> Recent queries
            </button>
            {recentOpen &&
              recent.map((r) => (
              <button
                key={r.id}
                className={`item q${r.docId === activeQueryId ? " on" : ""}`}
                onClick={() => onOpenRecent(r)}
              >
                <span>“{r.query}”</span>
              </button>
            ))}
          </>
        )}

        {messages.length === 0 && (
          <div className="a">
            <p>
              Ask about anything in the corpus — a theme, a ruling, a word. The
              agent searches the tafseer itself, answers in conversation, and
              shows you the passages it used on request.
            </p>
            <div className="suggest">
              {[
                "Inheritance laws",
                "Patience in hardship",
                "Mercy before judgement",
              ].map((q) => (
                <button key={q} onClick={() => onAsk(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "q" ? "q" : "a"}>
            {m.role === "q" ? (
              <>
                {m.text}
                {m.docId && (
                  <button className="rendered" onClick={() => onShowInReader(m.docId!)}>
                    rendered in reader ↗
                  </button>
                )}
              </>
            ) : (
              <>
                {m.refine && (
                  <div className="refine">
                    <span className="dot" />
                    Refining the document in the reader
                  </div>
                )}
                {m.text && <p>{m.text}</p>}
                {m.streaming && <p className="empty">{m.tool ?? "Thinking…"}</p>}
                {!m.streaming &&
                  (m.cites ?? []).slice(0, 3).map((c, ci) => (
                    <div
                      key={ci}
                      className="citeblock"
                      onClick={() => {
                        if (m.docId) onShowInReader(m.docId);
                        const [s, a] = c.ref.split(":");
                        window.setTimeout(
                          () =>
                            document
                              .getElementById(`ayah-${s}-${a}`)
                              ?.scrollIntoView({ block: "center" }),
                          60,
                        );
                      }}
                    >
                      <b>
                        {c.ref} · {c.surah}
                      </b>
                      <p>“{c.excerpt}…”</p>
                      <small>
                        {workLabel(c.source_file)} · relevance {c.score.toFixed(2)}
                      </small>
                    </div>
                  ))}
              </>
            )}
          </div>
        ))}

        {showSuggestions && (
          <div className="suggest">
            {topSurah && (
              <button
                className="refinebtn"
                onClick={() => onRefine({ surah: topSurah.surah })}
              >
                Only Surah {topSurah.surah}
              </button>
            )}
            {juzes.length > 1 && (
              <button className="refinebtn" onClick={() => onRefine({ juz: juzes[0] })}>
                Only Juz {juzes[0]}
              </button>
            )}
            {messages.some((m) => m.refine) && (
              <button className="refinebtn" onClick={() => onRefine({})}>
                Show all sources
              </button>
            )}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="box">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={currentDoc ? "Refine this, or ask something new…" : "Ask about the tafseer…"}
          />
          {mounted && dictationSupported() && (
            <button
              className={`mic${listening ? " listening" : ""}`}
              onClick={toggleDictation}
              title={listening ? "Stop dictation" : "Speak your question"}
            >
              {listening ? "◼" : "🎙"}
            </button>
          )}
          <button onClick={submit} disabled={busy || !draft.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}
