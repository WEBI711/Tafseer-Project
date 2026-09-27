"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Citation,
  Filters,
  ResponseDoc,
  SurahView,
  TreeSurah,
} from "@/lib/types";
import Explorer from "./Explorer";
import Reader from "./Reader";
import ChatPanel, { type Message } from "./ChatPanel";

export type RecentQuery = { id: string; query: string; docId: string };

const RECENT_KEY = "tafseer.recent";

export default function Workspace() {
  const [tree, setTree] = useState<TreeSurah[]>([]);
  const [surah, setSurah] = useState<SurahView | null>(null);
  const [mode, setMode] = useState<"reader" | "query">("reader");
  const [active, setActive] = useState<{ surah?: number; sectionId?: number }>({});
  const [recent, setRecent] = useState<RecentQuery[]>([]);
  const [docs, setDocs] = useState<Record<string, ResponseDoc>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["juz:1"]));

  const docsRef = useRef(docs);
  docsRef.current = docs;
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("/api/tree")
      .then((r) => r.json())
      .then(setTree)
      .catch(() => setTree([]));
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        setDocs(Object.fromEntries(saved.map((r: RecentQuery & { doc: ResponseDoc }) => [r.docId, r.doc])));
        setRecent(saved.map(({ id, query, docId }: RecentQuery) => ({ id, query, docId })));
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
    async (number: number, sectionId?: number) => {
      const res = await fetch(`/api/surah/${number}`);
      if (!res.ok) return;
      const view: SurahView = await res.json();
      setSurah(view);
      setMode("reader");
      setActive({ surah: number, sectionId });
      setExpanded((prev) => {
        const next = new Set(prev);
        const juz = view.juz;
        if (juz) next.add(`juz:${juz}`);
        next.add(`surah:${number}`);
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

  const openDoc = useCallback((docId: string) => {
    const doc = docsRef.current[docId];
    if (!doc) return;
    setMode("query");
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
          body: JSON.stringify({ query: q, refine: opts.refine, ...opts.filters }),
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

            if (event === "doc") {
              const doc: ResponseDoc = data.doc;
              docId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              setDocs((d) => ({ ...d, [docId]: doc }));
              setMode("query");
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
              patchLast((msg) => ({ ...msg, text: msg.text + data.text }));
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
      setMode("query");
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
      setActive({});
      openDoc(r.docId);
    },
    [openDoc],
  );

  return (
    <div className={`app${leftHidden ? " left-hidden" : ""}${rightHidden ? " right-hidden" : ""}`}>
      <Explorer
        tree={tree}
        active={mode === "reader" ? active : {}}
        activeQueryId={
          mode === "query"
            ? [...messages].reverse().find((m) => m.docId)?.docId
            : undefined
        }
        recent={recent}
        expanded={expanded}
        onToggle={(key) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          })
        }
        onOpenSurah={openSurah}
        onOpenRecent={openRecent}
        onCollapse={() => setLeftHidden(true)}
      />

      <Reader
        mode={mode}
        surah={surah}
        doc={docFromMessages(messages, docs)}
        activeSection={active.sectionId}
        ref={mainRef}
        tree={tree}
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
        currentDoc={docFromMessages(messages, docs)}
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

/** The document currently on screen: the newest streamed response. */
function docFromMessages(messages: Message[], docs: Record<string, ResponseDoc>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i].docId;
    if (id && docs[id]) return docs[id];
  }
  return null;
}

export function workLabel(source?: string | null) {
  if (!source) return "unknown source";
  return source.replace(/\.docx$/i, "").replace(/^[\d\s\-–.]+/, "").trim();
}

export type { Citation };