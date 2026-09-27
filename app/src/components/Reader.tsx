"use client";

import type { RefObject } from "react";
import type { ResponseDoc, SurahView, TreeSurah } from "@/lib/types";
import { workLabel } from "./Workspace";
import CommentaryText from "./CommentaryText";

type Props = {
  mode: "reader" | "query";
  surah: SurahView | null;
  doc: ResponseDoc | null;
  activeSection?: number;
  ref: RefObject<HTMLElement | null>;
  tree: TreeSurah[];
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export default function Reader({
  mode,
  surah,
  doc,
  activeSection,
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
      : surah
        ? { label: <>Juz {surah.juz} / Surah {surah.number} / <b>{surah.name_en}</b></> }
        : { label: <>Reading</> };

  return (
    <main className="main" ref={ref}>
      <div className="top">
        <span className="crumb">{crumb.label}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" onClick={onToggleLeft} title="Toggle explorer">
            ☰
          </button>
          <button className="icon-btn" onClick={onToggleRight} title="Toggle chat">
            💬
          </button>
        </span>
      </div>

      <div className="wrap">
        {mode === "query"
          ? doc && <ResponseDocument doc={doc} tree={tree} />
          : surah && <SurahDocument surah={surah} activeSection={activeSection} />}
      </div>
    </main>
  );
}

/* ---------------- shared commentary rendering ---------------- */

type Row = { id: number; content: string; source_file: string | null };

/**
 * Attribution for a whole block (a section, or the surah's notes): one line,
 * once. Reading flow matters more than repeating the same file name under every
 * paragraph, and the line still names every file the block draws on.
 */
function SourceLine({ rows }: { rows: Row[] }) {
  const files = [...new Set(rows.map((r) => r.source_file))];
  if (files.length === 0) return null;
  return (
    <span className="src sec">
      {files.length > 1 ? "Sources" : "Source"} · {files.map(workLabel).join(" · ")}
    </span>
  );
}

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

type SectionAyah = SurahView["sections"][number]["ayahs"][number];

/**
 * A verse the source lists without commentary or quoted Arabic is a listing, not
 * a passage to read on its own. Consecutive ones render as one compact list; the
 * commentary keeps belonging to whichever verse it was written under.
 */
type GroupedAyah =
  | { kind: "list"; ayahs: SectionAyah[] }
  | { kind: "block"; ayah: SectionAyah };

function groupAyahs(ayahs: SectionAyah[]): GroupedAyah[] {
  const out: GroupedAyah[] = [];
  for (const a of ayahs) {
    const listed = a.commentary.length === 0 && !a.text_ar;
    const last = out[out.length - 1];
    if (listed) {
      if (last?.kind === "list") last.ayahs.push(a);
      else out.push({ kind: "list", ayahs: [a] });
    } else {
      out.push({ kind: "block", ayah: a });
    }
  }
  return out;
}

/* ---------------- reader mode ---------------- */

function SurahDocument({
  surah,
  activeSection,
}: {
  surah: SurahView;
  activeSection?: number;
}) {
  const ayat = surah.sections.reduce((n, s) => n + s.ayahs.length, 0);
  const sources = new Set(
    surah.sections.flatMap((s) => s.ayahs.flatMap((a) => a.commentary.map((c) => c.source_file))),
  );
  return (
    <>
      <div className="kicker">
        Juz {surah.juz} · Surah {surah.number}
      </div>
      <h1>{surah.name_en}</h1>
      <div className="meta">
        <div>
          Ayat<br />
          <b>{ayat}</b>
        </div>
        <div>
          Sections<br />
          <b>{surah.sections.length}</b>
        </div>
        <div>
          Sources<br />
          <b>{sources.size}</b>
        </div>
      </div>

      {surah.intro && (
        <>
          <h2 className="section">The Name</h2>
          <div className="orn">
            <span>۞</span>
          </div>
          <div className="commentary">
            <CommentaryText content={surah.intro} />
          </div>
        </>
      )}

      {surah.notes.length > 0 && (
        <>
          <h2 className="section">Notes on the surah</h2>
          <SourceLine rows={surah.notes} />
          <div className="orn">
            <span>۞</span>
          </div>
          <div className="commentary">
            <CommentaryRows rows={surah.notes} />
          </div>
        </>
      )}

      {surah.sections.map((sec) => {
        return (
          <section key={sec.id} id={`sec-${sec.id}`}>
            <h2 className="section">Group · {sec.title}</h2>
            {/* one attribution line per section, not per paragraph */}
            <SourceLine rows={sec.ayahs.flatMap((a) => a.commentary)} />
            <div className="orn">
              <span>۞</span>
            </div>
            {groupAyahs(sec.ayahs).map((item) =>
              item.kind === "list" ? (
                // The author lists short verses one after another and comments on
                // the group afterwards. Rendering them as a compact list keeps
                // that shape instead of a column of near-empty verse blocks.
                <div className="vlist" key={`list-${item.ayahs[0].number}`}>
                  {item.ayahs.map((a) => (
                    <p className="vitem" key={a.number} id={`ayah-${surah.number}-${a.number}`}>
                      <span className="vnum">{a.number}</span>
                      <span>{a.translation}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <AyahBlock
                  key={`${sec.id}-${item.ayah.number}`}
                  id={`ayah-${surah.number}-${item.ayah.number}`}
                  highlight={activeSection === sec.id}
                  labelRuns={
                    new Set(item.ayah.commentary.map((c) => c.source_file)).size > 1
                  }
                  number={item.ayah.number}
                  text_ar={item.ayah.text_ar}
                  translation={item.ayah.translation}
                  commentary={item.ayah.commentary}
                />
              ),
            )}
          </section>
        );
      })}
    </>
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
        </div>
      )}
      <div className="vrow">
        <span className="ayah-n">{number}</span>
        {/* Blank means the source doc quotes no Arabic for this ayah — it is
            never borrowed from a neighbour. */}
        {text_ar && (
          <p className="ar" dir="rtl">
            {text_ar}
          </p>
        )}
      </div>
      <div className="body">
        {translation && <p className="translation">{translation}</p>}
        {commentary.length > 0 && (
          <div className="commentary">
            <CommentaryRows rows={commentary} labelRuns={labelRuns} />
          </div>
        )}
      </div>
    </div>
  );
}