"use client";

import type { TreeDoc, TreeSurah } from "@/lib/types";

type Props = {
  tree: TreeSurah[];
  docs: TreeDoc[];
  active: { surah?: number; sectionId?: number; doc?: string };
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenSurah: (number: number, juz: number, sectionId?: number) => void;
  onOpenDoc: (sourceFile: string) => void;
  onCollapse: () => void;
};

export default function Explorer({
  tree,
  docs,
  active,
  expanded,
  onToggle,
  onOpenSurah,
  onOpenDoc,
  onCollapse,
}: Props) {
  const juzGroups = tree.reduce<Record<number, TreeSurah[]>>((acc, s) => {
    (acc[s.juz] ??= []).push(s);
    return acc;
  }, {});

  return (
    <aside className="side">
      <div className="head">
        <span className="brand">Tafseer</span>
        <button className="icon-btn" onClick={onCollapse} title="Hide explorer">
          ‹
        </button>
      </div>
      <div className="scroll">
        {/* Standalone documents (e.g. the Introduction) sit above the juz tree */}
        {docs.map((d) => (
          <button
            key={d.source_file}
            className={`item${active.doc === d.source_file ? " on" : ""}`}
            onClick={() => onOpenDoc(d.source_file)}
          >
            <span>{d.title}</span>
          </button>
        ))}

        {Object.entries(juzGroups).map(([juz, surahs]) => {
          const juzKey = `juz:${juz}`;
          const juzOpen = expanded.has(juzKey);
          return (
            <div key={juz} className={`node${juzOpen ? "" : " closed"}`}>
              <div className="row" onClick={() => onToggle(juzKey)}>
                <span className="caret">▾</span>
                <span className="jt">Juz {juz}</span>
                <small>{surahs.length} surahs</small>
              </div>
              <div className="kids">
                {surahs.map((s) => {
                  // Per-juz key: the same surah can span several juz, and each
                  // part must expand independently.
                  const surahKey = `surah:${juz}:${s.number}`;
                  const surahOpen = expanded.has(surahKey);
                  const isActive = active.surah === s.number;
                  return (
                    <div key={s.number} className={`node${surahOpen ? "" : " closed"}`}>
                      <div
                        className={`row${isActive ? " on" : ""}`}
                        onClick={() => {
                          // Collapsing the active surah should stay collapsed,
                          // so don't re-open it in the reader on this click.
                          if (surahOpen && isActive) {
                            onToggle(surahKey);
                            return;
                          }
                          if (!surahOpen) onToggle(surahKey);
                          onOpenSurah(s.number, s.juz);
                        }}
                      >
                        <span className="caret">▾</span>
                        <span>Surah {s.number}
                          {s.continued ? " · continued" : ` · ${shortName(s.name_en)}`}
                        </span>
                        <small>{s.ayat}</small>
                      </div>
                      <div className="kids">
                        {s.sections.map((sec) => (
                          <button
                            key={sec.id}
                            className={`item sub${
                              active.sectionId === sec.id ? " on" : ""
                            }`}
                            onClick={() => onOpenSurah(s.number, s.juz, sec.id)}
                          >
                            <span>{titleCase(sec.title)}</span>
                            <small>
                              {sec.from_ayah != null
                                ? `${s.number}:${sec.from_ayah}${
                                    sec.to_ayah && sec.to_ayah !== sec.from_ayah
                                      ? `–${sec.to_ayah}`
                                      : ""
                                  }`
                                : ""}
                            </small>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {tree.length === 0 && <p className="hint">Loading the tree…</p>}
      </div>
    </aside>
  );
}

/** "AL BAQARA (THE COW)" -> "Al Baqara" — keep the author's words, shorten. */
function shortName(s: string) {
  return titleCase(s.split("(")[0].trim());
}

/** Section titles come from the author as ALL CAPS — keep the words, soften case. */
function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s(\[“‘-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
}