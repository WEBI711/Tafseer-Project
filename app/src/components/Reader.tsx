"use client";

import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { DocBlock, DocView, ResponseDoc, SurahView, TreeSurah } from "@/lib/types";
import { speakSupported, speakText, stopSpeaking } from "@/lib/speech";
import Dictation, { useDictation, type SpeechSection } from "./Dictation";
import { tidy } from "@/lib/text";
import { workLabel } from "./Workspace";
import CommentaryText from "./CommentaryText";

type Props = {
  mode: "reader" | "query";
  surah: SurahView | null;
  standalone: DocView | null;
  doc: ResponseDoc | null;
  ref: RefObject<HTMLElement | null>;
  tree: TreeSurah[];
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export default function Reader({
  mode,
  surah,
  standalone,
  doc,
  ref,
  tree,
  onToggleLeft,
  onToggleRight,
}: Props) {
  const crumb =
    mode === "query" && doc
      ? {
          label: (
            <>
              Query / <b>“{doc.query}”</b>
              <span className="count">
                {doc.stats.ayat} ayat · {doc.stats.surahs} surahs · {doc.stats.juz} juz
              </span>
            </>
          ),
        }
      : standalone
        ? { label: <><b>{standalone.title}</b></> }
        : surah
          ? { label: <>Juz {surah.juz} / Surah {surah.number} / <b>{surah.name_en}</b></> }
          : { label: <>Reading</> };

  // reader mode plays the whole work: one intro section per source document
  // plus one per section heading, across every document in reading order
  const sections = useMemo(
    () => buildSpeechSections(standalone, surah),
    [standalone, surah],
  );

  return (
    <main className="main" ref={ref}>
      <div className="top">
        <span className="crumb">{crumb.label}</span>
        <span className="top-actions">
          <button className="icon-btn" onClick={onToggleLeft} title="Toggle explorer">
            ☰
          </button>
          <button className="icon-btn" onClick={onToggleRight} title="Toggle chat">
            💬
          </button>
        </span>
      </div>

      <div className="wrap">
        {mode === "query" ? (
          doc && <ResponseDocument doc={doc} tree={tree} />
        ) : (
          <Dictation sections={sections}>
            {standalone
              ? <StandaloneDocument doc={standalone} />
              : surah && <SurahDocument surah={surah} />}
          </Dictation>
        )}
      </div>
    </main>
  );
}

/* ---------------- shared commentary rendering ---------------- */

type Row = { id: number; content: string; source_file: string | null };

/**
 * Consecutive passages from one file form a run. A run is only labelled when
 * the block itself mixes files — 95% of ayat come from a single docx.
 */
function CommentaryRows({ rows, labelRuns }: { rows: Row[]; labelRuns?: boolean }) {
  const runs: { file: string | null; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.file === r.source_file) last.rows.push(r);
    else runs.push({ file: r.source_file, rows: [r] });
  }
  return (
    <>
      {runs.map((run, ri) => (
        <div className="run" key={ri}>
          {labelRuns && <span className="src">Source · {workLabel(run.file)}</span>}
          {run.rows.map((r, i) => (
            <CommentaryText key={r.id || i} content={r.content} />
          ))}
        </div>
      ))}
    </>
  );
}

/* ---------------- reader mode: the source document, block by block ---------------- */

function StandaloneDocument({ doc }: { doc: DocView }) {
  return (
    <section className="doc" id="doc-0">
      <DocumentBody blocks={doc.blocks} docIndex={0} />
    </section>
  );
}

function SurahDocument({ surah }: { surah: SurahView }) {
  const multi = surah.documents.length > 1;
  return (
    <>
      {surah.documents.map((doc, i) => (
        <section className="doc" key={doc.source_file} id={`doc-${i}`}>
          {/* app chrome, not document text: keep attribution when a surah is
              covered by more than one source file */}
          {multi && <div className="doc-source">Source · {workLabel(doc.source_file)}</div>}
          <DocumentBody blocks={doc.blocks} docIndex={i} />
        </section>
      ))}
    </>
  );
}

function DocumentBody({ blocks, docIndex }: { blocks: DocBlock[]; docIndex: number }) {
  const out: React.ReactNode[] = [];
  let list: DocBlock[] = [];
  // Arabic before the surah header is the document's opening (the bismillah):
  // it is set centred, not like the right-aligned verse text that follows.
  let surahOpened = false;

  const flushList = () => {
    if (list.length === 0) return;
    out.push(
      <ul className="doc-list" key={`list-${list[0].ord}`}>
        {list.map((b) => (
          <li key={b.ord} data-kind={b.kind} data-ord={b.ord}>
            {b.text}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const b of blocks) {
    if (b.kind === "list_item") {
      list.push(b);
      continue;
    }
    flushList();
    out.push(
      <BlockView
        block={b}
        opening={b.kind === "arabic" && !surahOpened}
        docIndex={docIndex}
        key={b.ord}
      />,
    );
    if (b.kind === "surah_header") surahOpened = true;
    // section headings take the demo's ornamental rule underneath
    if (b.kind === "section_heading") {
      out.push(
        <div className="orn" key={`orn-${b.ord}`}>
          <span>۞</span>
        </div>,
      );
    }
  }
  flushList();
  return <>{out}</>;
}

function BlockView({
  block,
  opening = false,
  docIndex,
}: {
  block: DocBlock;
  opening?: boolean;
  docIndex: number;
}) {
  const sectionAnchor = block.section_id ? `sec-${block.section_id}` : undefined;
  const recapAnchor = block.recap_id ? `recap-${block.recap_id}` : undefined;
  const ayahAnchor =
    block.kind === "translation" && block.ref_ayah
      ? `ayah-${block.ref_surah}-${block.ref_ayah}`
      : undefined;
  const id = sectionAnchor ?? recapAnchor ?? ayahAnchor;
  const meta = { "data-kind": block.kind, "data-ord": block.ord };

  switch (block.kind) {
    case "juz_header":
      return (
        <div className="doc-juz" id={id} {...meta}>
          {block.text}
        </div>
      );
    case "surah_header":
      return (
        <h1 className="doc-surah" id={id} {...meta}>
          <SpeakSectionButton docIndex={docIndex} ord={block.ord} />
          {block.text}
        </h1>
      );
    case "section_heading":
      return (
        <h2 className="section" id={id} {...meta}>
          <SpeakSectionButton docIndex={docIndex} ord={block.ord} />
          {block.text}
        </h2>
      );
    case "heading":
      return (
        <h3 className="doc-heading" id={id} {...meta}>
          <SpeakSectionButton docIndex={docIndex} ord={block.ord} />
          {block.text}
        </h3>
      );
    case "arabic":
      return (
        <p className={opening ? "ar ar-open" : "ar"} dir="rtl" id={id} {...meta}>
          {block.text}
        </p>
      );
    // call-outs the author sets off from the running text: lessons and hadith
    // render as boxed notes, re-quoted ayat and cross-references as pull quotes
    case "lesson":
    case "hadith":
      return (
        <div className="note" id={id} {...meta}>
          <h4>{block.kind === "lesson" ? "Lesson" : "Hadith"}</h4>
          <p>{block.text}</p>
        </div>
      );
    case "quote":
    case "cross_ref":
      return (
        <div className="pull" id={id} {...meta}>
          <CommentaryText content={block.text} className="pull-lead" />
        </div>
      );
    case "translation":
      return (
        <div className="trans-row" id={id} {...meta}>
          <SpeakButton text={block.text} />
          <p className="translation">{block.text}</p>
        </div>
      );
    case "table":
      return <TableBlock block={block} id={id} meta={meta} />;
    default:
      return (
        <CommentaryText
          content={block.text}
          id={id}
          dataKind={block.kind}
          dataOrd={block.ord}
        />
      );
  }
}

function TableBlock({
  block,
  id,
  meta,
}: {
  block: DocBlock;
  id?: string;
  meta: Record<string, string | number>;
}) {
  // Cells are stored as a JSON grid so the table the author wrote survives.
  let rows: string[][] = [];
  try {
    const parsed = JSON.parse(block.text);
    if (Array.isArray(parsed)) rows = parsed.map((r) => (Array.isArray(r) ? r : [String(r)]));
  } catch {
    rows = [[block.text]];
  }
  if (rows.length === 0) return null;
  const [head, ...body] = rows;

  return (
    <div className="doc-table-wrap" id={id} {...meta}>
      <table className="doc-table">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- query-response mode (QUERY-VIEW.md contract) ---------------- */

function ResponseDocument({ doc, tree }: { doc: ResponseDoc; tree: TreeSurah[] }) {
  const sources = new Set(
    doc.groups.flatMap((g) => g.ayat.flatMap((a) => a.commentary.map((c) => c.source_file))),
  );
  if (doc.groups.length === 0) {
    return (
      <>
        <div className="kicker">Query response</div>
        <h1>“{doc.query}”</h1>
        <p className="lede">
          No passage in the corpus matches this query closely enough to render a
          response document.
        </p>
      </>
    );
  }
  return (
    <>
      <div className="kicker">Query response · rendered from {sources.size} tafsir works</div>
      <h1>{doc.query}</h1>
      <p className="lede">
        Every ayah the corpus connects to this question — ordered through the Book
        itself, with the commentary that surrounds each verse kept intact.
      </p>
      <div className="meta">
        <div>
          Matches<br />
          <b>{doc.stats.ayat} ayat</b>
        </div>
        <div>
          Juz<br />
          <b>{doc.stats.juz}</b>
        </div>
        <div>
          Surahs<br />
          <b>{doc.stats.surahs}</b>
        </div>
        <div>
          Order<br />
          <b>Canonical</b>
        </div>
      </div>

      {doc.groups.map((g) => {
        const surahMeta = tree.find((s) => s.number === g.surah);
        const juzAyat = doc.groups
          .filter((x) => x.juz === g.juz)
          .reduce((n, x) => n + x.ayat.length, 0);
        return (
          <div key={`${g.juz}-${g.surah}`}>
            <div className="juz-band">
              <div className="jl">Juz {g.juz}</div>
              <div className="jn">{g.juz_ar}</div>
              <div className="st">
                {g.name_en} · {g.continued ? "continued · " : ""}
                {juzAyat} ayat matched
              </div>
            </div>

            {!g.continued && (
              <div className="surah-head">
                <span className="sn">
                  Surah {g.surah} · {g.name_en}
                </span>
                <span className="ss">{surahMeta?.ayat ?? 0} ayat</span>
              </div>
            )}

            {g.ayat.map((a) => (
              <AyahBlock
                key={`${g.surah}-${a.number}`}
                id={`ayah-${g.surah}-${a.number}`}
                ref_={`${g.surah}:${a.number}${a.section_title ? ` · ${a.section_title}` : ""}`}
                score={a.score}
                labelRuns={new Set(a.commentary.map((c) => c.source_file)).size > 1}
                number={a.number}
                text_ar={a.text_ar}
                translation={a.translation}
                commentary={a.commentary.map((c) => ({
                  id: 0,
                  content: c.content,
                  source_file: c.source_file,
                }))}
              />
            ))}
          </div>
        );
      })}

      <div className="endmark">
        ۞
        <small>End of response · {doc.stats.ayat} ayat</small>
      </div>
    </>
  );
}

/* ---------------- read-aloud (TTS) ---------------- */

function SpeakButton({ text }: { text: string }) {
  // Speech exists only in the browser, so wait until after hydration before
  // rendering the button — otherwise the server HTML won't match.
  const [mounted, setMounted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const dictation = useDictation();
  useEffect(() => setMounted(true), []);
  useEffect(() => () => stopSpeaking(), []);

  const toggle = () => {
    if (speaking) {
      // a running section and a per-verse button share one synthesizer
      if (dictation?.playing) dictation.stop();
      else stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (dictation?.playing) dictation.stop();
    speakText(text, () => setSpeaking(false));
    setSpeaking(true);
  };

  if (!mounted || !speakSupported()) return null;

  return (
    <button
      className={`icon-btn speak${speaking ? " on" : ""}`}
      onClick={toggle}
      title={speaking ? "Stop reading aloud" : "Read aloud"}
    >
      {speaking ? "⏹" : "🔊"}
    </button>
  );
}

/* ---------------- shared ayah block ---------------- */

function AyahBlock({
  id,
  number,
  text_ar,
  translation,
  commentary,
  ref_,
  score,
  labelRuns = false,
}: {
  id: string;
  number: number;
  text_ar: string | null;
  translation: string | null;
  commentary: Row[];
  ref_?: string;
  score?: number;
  highlight?: boolean;
  labelRuns?: boolean;
}) {
  return (
    <div className="ayah" id={id}>
      {ref_ !== undefined && (
        <div className="vhead">
          <span className="ref">{ref_}</span>
          {score !== undefined && <span className="score">{score.toFixed(2)}</span>}
          <SpeakButton
            text={[translation, ...commentary.map((r) => r.content)]
              .filter(Boolean)
              .join(" ")}
          />
        </div>
      )}
      <div className="vrow">
        <span className="ayah-n">{number}</span>
        {/* Blank means the source doc quotes no Arabic for this ayah — it is
            never borrowed from a neighbour. */}
        {text_ar && (
          <p className="ar" dir="rtl">
            {tidy(text_ar)}
          </p>
        )}
      </div>
      <div className="body">
        {translation && <p className="translation">{tidy(translation)}</p>}
        {commentary.length > 0 && (
          <div className="commentary">
            <CommentaryRows rows={commentary} labelRuns={labelRuns} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- section dictation ---------------- */

/**
 * Play control for the section a block starts (surah header starts the
 * document's intro, a section heading starts its section). Renders nothing on
 * blocks that do not start a section — the Reader hands over the section list.
 */
function SpeakSectionButton({ docIndex, ord }: { docIndex: number; ord: number }) {
  // Speech exists only in the browser, so wait until after hydration before
  // rendering the button — otherwise the server HTML won't match.
  const [mounted, setMounted] = useState(false);
  const dictation = useDictation();
  useEffect(() => setMounted(true), []);
  if (!mounted || !dictation) return null;

  const startsSection = dictation.sections.some(
    (s) => s.docIndex === docIndex && s.firstOrd === ord,
  );
  if (!startsSection) return null;
  const active =
    dictation.playing &&
    dictation.activeSection?.docIndex === docIndex &&
    dictation.activeSection?.firstOrd === ord;

  return (
    <button
      className={`icon-btn speak speak-start${active ? " on" : ""}`}
      onClick={() => (active ? dictation.stop() : dictation.playFrom(docIndex, ord))}
      title={active ? "Stop reading aloud" : "Read this section aloud"}
    >
      {active ? "⏹" : "🔊"}
    </button>
  );
}

/* ---------------- section dictation helpers ---------------- */

/** A section starts at each section heading; blocks before the first heading
 *  form the document's intro, played from the surah/document header. */
function splitSections(
  blocks: DocBlock[],
): { headingOrd: number | null; blocks: DocBlock[] }[] {
  const sections: { headingOrd: number | null; blocks: DocBlock[] }[] = [
    { headingOrd: null, blocks: [] },
  ];
  for (const b of blocks) {
    if (b.kind === "section_heading") sections.push({ headingOrd: b.ord, blocks: [b] });
    else sections[sections.length - 1].blocks.push(b);
  }
  return sections.filter((s) => s.blocks.length > 0);
}

/** Tables store a JSON grid — flatten the cells so nothing is left unread. */
function speakableText(block: DocBlock): string {
  if (block.kind !== "table") return block.text;
  try {
    const rows: unknown = JSON.parse(block.text);
    if (Array.isArray(rows)) return rows.flat().map(String).join(". ");
  } catch {
    // not a grid — read the raw text
  }
  return block.text;
}

/** Arabic blocks get an `ar` voice when the browser ships one. */
function blockLang(block: DocBlock): string {
  return block.kind === "arabic" ? "ar" : "en";
}

function buildSpeechSections(
  standalone: DocView | null,
  surah: SurahView | null,
): SpeechSection[] {
  if (standalone) return sectionsFromDoc(standalone.blocks, 0);
  if (!surah) return [];
  return surah.documents.flatMap((doc, docIndex) => sectionsFromDoc(doc.blocks, docIndex));
}

function sectionsFromDoc(blocks: DocBlock[], docIndex: number): SpeechSection[] {
  return splitSections(blocks).map((s) => ({
    docIndex,
    headingOrd: s.headingOrd,
    firstOrd: s.blocks[0].ord,
    blocks: s.blocks.map((b) => ({ ord: b.ord, text: speakableText(b), lang: blockLang(b) })),
  }));
}
