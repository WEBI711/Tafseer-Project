"use client";

import { useState } from "react";
import type { Citation, Filters, ResponseDoc } from "@/lib/types";
import { workLabel } from "./Workspace";

export type Message = {
  role: "q" | "a";
  text: string;
  streaming?: boolean;
  refine?: boolean;
  cites?: Citation[];
  docId?: string;
  docQuery?: string;
};

type Props = {
  messages: Message[];
  busy: boolean;
  currentDoc: ResponseDoc | null;
  onAsk: (question: string) => void;
  onRefine: (filters: Filters) => void;
  onShowInReader: (docId: string) => void;
  onCollapse: () => void;
};

export default function ChatPanel({
  messages,
  busy,
  currentDoc,
  onAsk,
  onRefine,
  onShowInReader,
  onCollapse,
}: Props) {
  const [draft, setDraft] = useState("");
  const last = messages[messages.length - 1];
  const showSuggestions = Boolean(last && last.role === "a" && !last.streaming && currentDoc);

  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    onAsk(q);
  };

  const topSurah = currentDoc?.groups[0];
  const juzes = [...new Set(currentDoc?.groups.map((g) => g.juz) ?? [])];

  return (
    <section className="chat">
      <div className="ch">
        <b>Search</b>
        <button className="icon-btn" onClick={onCollapse} title="Hide chat">
          ›
        </button>
      </div>

      <div className="thread">
        {messages.length === 0 && (
          <div className="a">
            <p>
              Ask about anything in the corpus — a theme, a ruling, a word. The
              answer searches every surah and renders the matching ayat, with the
              commentary around each verse intact, in the reader.
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
                {m.streaming && <p className="empty">Consulting the corpus…</p>}
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
          <button onClick={submit} disabled={busy || !draft.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}