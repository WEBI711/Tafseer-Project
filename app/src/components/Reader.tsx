"use client";

import type { RefObject } from "react";
import type { ResponseDoc, SurahView, TreeSurah } from "@/lib/types";
import { workLabel } from "./Workspace";

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
            <p>{surah.intro}</p>
          </div>
        </>
      )}

      {surah.notes.length > 0 && (
        <>
          <h2 className="section">Notes on the surah</h2>
          <div className="orn">
            <span>۞</span>
          </div>
          <div className="commentary">
            {surah.notes.map((n) => (
              <div key={n.id}>
                <p>{n.content}</p>
                <span className="src">Source · {workLabel(n.source_file)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {surah.sections.map((sec) => (
        <section key={sec.id} id={`sec-${sec.id}`}>
          <h2 className="section">
            Group · {sec.title}
          </h2>
          <div className="orn">
            <span>۞</span>
          </div>
          {sec.ayahs.map((a) => (
            <AyahBlock
              key={`${sec.id}-${a.number}`}
              id={`ayah-${surah.number}-${a.number}`}
              highlight={activeSection === sec.id}
              number={a.number}
              text_ar={a.text_ar}
              translation={a.translation}
              commentary={a.commentary}
            />
          ))}
        </section>
      ))}
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
}: {
  id: string;
  number: number;
  text_ar: string | null;
  translation: string | null;
  commentary: { id: number; content: string; source_file: string | null }[];
  ref_?: string;
  score?: number;
  highlight?: boolean;
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
        <div className="commentary">
          {commentary.map((c, i) => (
            <div key={c.id || i}>
              <p>{c.content}</p>
              <span className="src">Source · {workLabel(c.source_file)}</span>
            </div>
          ))}
          {commentary.length === 0 && (
            <p className="empty">No commentary recorded for this ayah.</p>
          )}
        </div>
      </div>
    </div>
  );
}