"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Citation,
  DocView,
  Filters,
  ResponseDoc,
  SurahView,
  Tree,
} from "@/lib/types";
import Explorer from "./Explorer";
import Reader from "./Reader";
import ChatPanel, { type Message } from "./ChatPanel";

export type RecentQuery = { id: string; query: string; docId: string };

const RECENT_KEY = "tafseer.recent";
const CONVERSATION_KEY = "tafseer.conversation";

/** The durable conversation id this browser talks to; empty until the agent mints one. */
function conversationId(): string | undefined {
  try {
    return localStorage.getItem(CONVERSATION_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function toolLabel(name: string, args?: Record<string, unknown>): string {
  if (name === "search_corpus") return "Searching the corpus…";
  if (name === "get_surah") return `Reading Surah ${args?.number ?? ""}…`;
  if (name === "render_results") return "Rendering the passages…";
  return "Working…";
}

export default function Workspace() {
  const [tree, setTree] = useState<Tree>({ surahs: [], docs: [] });
  const [surah, setSurah] = useState<SurahView | null>(null);
  const [standalone, setStandalone] = useState<DocView | null>(null);
  // What the reader is showing. Tracked explicitly: inferring it from the last
  // chat message left the reader blank when a saved query was opened directly.
  const [view, setView] = useState<{ kind: "reader" } | { kind: "query"; docId: string }>(
    { kind: "reader" },
  );
  const [active, setActive] = useState<{ surah?: number; sectionId?: number; doc?: string }>({});
  const [recent, setRecent] = useState<RecentQuery[]>([]);
  const [docs, setDocs] = useState<Record<string, ResponseDoc>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["juz:1"]));

  // On phones the three columns cannot fit: the panels become off-canvas
  // overlays, so start with both tucked away and let the top-bar buttons
  // summon them.
  useEffect(() => {
    if (window.innerWidth <= 1100) {
      setLeftHidden(true);
      setRightHidden(true);
    }
  }, []);

  const docsRef = useRef(docs);
  docsRef.current = docs;
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("/api/tree")
      .then((r) => r.json())
      .then(setTree)
      .catch(() => setTree({ surahs: [], docs: [] }));
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        // drop entries whose document is missing (cache written by older code)
        const valid = saved.filter((r: RecentQuery & { doc?: ResponseDoc }) => r.doc);
        setDocs(
          Object.fromEntries(
            valid.map((r: RecentQuery & { doc: ResponseDoc }) => [r.docId, r.doc]),
          ),
        );
        setRecent(valid.map(({ id, query, docId }: RecentQuery) => ({ id, query, docId })));
      }
    } catch {
      /* ignore malformed cache */
    }
  }, []);

  const persist = useCallback((next: RecentQuery[], nextDocs: Record<string, ResponseDoc>) => {
    setRecent(next);
    try {
      localStorage.setItem(
        RECENT_KEY,
        JSON.stringify(next.map((r) => ({ ...r, doc: nextDocs[r.docId] }))),
      );
    } catch {
      /* quota — recent queries stay session-only */
    }
  }, []);

  const openSurah = useCallback(
    async (number: number, juz: number, sectionId?: number) => {
      const res = await fetch(`/api/surah/${number}`);
      if (!res.ok) return;
      const opened: SurahView = await res.json();
      setSurah(opened);
      setStandalone(null);
      setView({ kind: "reader" });
      setActive({ surah: number, sectionId });
      setExpanded((prev) => {
        const next = new Set(prev);
        // Expansion keys are per-juz so a surah that spans juz only opens the
        // part that was clicked, leaving continuation nodes elsewhere closed.
        next.add(`juz:${juz}`);
        next.add(`surah:${juz}:${number}`);
        return next;
      });
      if (sectionId) {
        window.setTimeout(() => {
          document.getElementById(`sec-${sectionId}`)?.scrollIntoView({ block: "start" });
        }, 50);
      } else {
        mainRef.current?.scrollTo({ top: 0 });
      }
    },
    [],
  );

  const openDocument = useCallback(async (sourceFile: string) => {
    const res = await fetch(`/api/doc/${encodeURIComponent(sourceFile)}`);
    if (!res.ok) return;
    const opened: DocView = await res.json();
    setStandalone(opened);
    setSurah(null);
    setView({ kind: "reader" });
    setActive({ doc: sourceFile });
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  const openDoc = useCallback((docId: string) => {
    if (!docsRef.current[docId]) return;
    setView({ kind: "query", docId });
    setActive({});
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  /** Sends a question to the agent, streams the answer, renders the document. */
  const ask = useCallback(
    async (question: string, opts: { refine?: boolean; filters?: Filters } = {}) => {
      const q = question.trim();
      if (!q || busy) return;
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "q", text: q, refine: opts.refine },
        { role: "a", text: "", streaming: true },
      ]);

      const patchLast = (fn: (msg: Message) => Message) =>
        setMessages((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, conversationId: conversationId() }),
        });
        if (!res.body) throw new Error("no stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let docId = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const dataRaw = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!event || !dataRaw) continue;
            const data = JSON.parse(dataRaw);

            if (event === "session") {
              try {
                localStorage.setItem(CONVERSATION_KEY, String(data.conversationId));
              } catch {
                /* private mode — the conversation just starts fresh each load */
              }
            } else if (event === "tool") {
              patchLast((msg) => ({ ...msg, tool: toolLabel(data.name, data.args) }));
            } else if (event === "doc") {
              const doc: ResponseDoc = data.doc;
              docId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              setDocs((d) => ({ ...d, [docId]: doc }));
              setView({ kind: "query", docId });
              setActive({});
              mainRef.current?.scrollTo({ top: 0 });
              patchLast((msg) => ({
                ...msg,
                docId,
                docQuery: doc.query,
                cites: doc.cites,
                refine: Boolean(data.refine),
              }));
              if (data.refine) {
                // Refinements re-emit the document for the same question, so the
                // question's "rendered in reader" link points at the new one.
                setMessages((m) => {
                  const i = m.map((x) => x.role).lastIndexOf("q");
                  if (i === -1) return m;
                  return m.map((x, xi) => (xi === i ? { ...x, docId } : x));
                });
              } else {
                const next = [{ id: docId, query: doc.query, docId }, ...recentRef.current].slice(0, 20);
                persist(next, { ...docsRef.current, [docId]: doc });
              }
            } else if (event === "delta") {
              patchLast((msg) => ({ ...msg, text: msg.text + data.text, tool: undefined }));
            } else if (event === "done") {
              patchLast((msg) => ({ ...msg, streaming: false }));
            } else if (event === "error") {
              patchLast((msg) => ({
                ...msg,
                streaming: false,
                text: msg.text || `The agent could not answer: ${data.message}`,
              }));
            }
          }
        }
        patchLast((msg) => ({ ...msg, streaming: false }));
      } catch (err) {
        patchLast((msg) => ({
          ...msg,
          streaming: false,
          text: msg.text || `Request failed: ${err instanceof Error ? err.message : err}`,
        }));
      } finally {
        setBusy(false);
      }
    },
    [busy, persist],
  );

  /** Refinement: same query-space, narrowed by a user-applied filter. */
  const refine = useCallback(
    async (filters: Filters) => {
      const lastQuery = [...messages].reverse().find((m) => m.role === "q")?.text;
      if (!lastQuery) return;
      setBusy(true);
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: lastQuery, ...filters }),
      });
      const doc: ResponseDoc = await res.json();
      const docId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setDocs((d) => ({ ...d, [docId]: doc }));
      setView({ kind: "query", docId });
      setActive({});
      mainRef.current?.scrollTo({ top: 0 });
      const label = filters.surah
        ? `Only Surah ${filters.surah}`
        : filters.juz
          ? `Only Juz ${filters.juz}`
          : "All sources";
      setMessages((m) => [...m, { role: "a", text: `${label} — the reader now shows ${doc.stats.ayat} ayat.`, refine: true }]);
      setBusy(false);
    },
    [messages],
  );

  const openRecent = useCallback(
    (r: RecentQuery) => {
      openDoc(r.docId);
    },
    [openDoc],
  );

  const currentDoc = view.kind === "query" ? (docs[view.docId] ?? null) : null;

  return (
    <div className={`app${leftHidden ? " left-hidden" : ""}${rightHidden ? " right-hidden" : ""}`}>
      <Explorer
        tree={tree.surahs}
        docs={tree.docs}
        active={view.kind === "reader" ? active : {}}
        expanded={expanded}
        onToggle={(key) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          })
        }
        onOpenSurah={openSurah}
        onOpenDoc={openDocument}
        onCollapse={() => setLeftHidden(true)}
      />

      <Reader
        mode={view.kind === "query" ? "query" : "reader"}
        surah={surah}
        standalone={standalone}
        doc={currentDoc}
        ref={mainRef}
        tree={tree.surahs}
        onToggleLeft={() => setLeftHidden((v) => !v)}
        onToggleRight={() => setRightHidden((v) => !v)}
      />

      <ChatPanel
        messages={messages}
        busy={busy}
        onAsk={(q) => ask(q)}
        onRefine={refine}
        onShowInReader={openDoc}
        onCollapse={() => setRightHidden(true)}
        currentDoc={currentDoc}
        recent={recent}
        activeQueryId={view.kind === "query" ? view.docId : undefined}
        onOpenRecent={openRecent}
      />

      {leftHidden && (
        <button className="edge left" onClick={() => setLeftHidden(false)} title="Show explorer">
          ›
        </button>
      )}
      {rightHidden && (
        <button className="edge right" onClick={() => setRightHidden(false)} title="Show chat">
          ‹
        </button>
      )}
    </div>
  );
}

export function workLabel(source?: string | null) {
  if (!source) return "unknown source";
  return source.replace(/\.docx$/i, "").replace(/^[\d\s\-–.]+/, "").trim();
}

export type { Citation };