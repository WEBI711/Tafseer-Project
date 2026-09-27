import { query } from "./db";
import { embed } from "./llm";
import type { AyahBlock, Citation, Filters, ResponseDoc, ResponseGroup, SurahView } from "./types";

export type { AyahBlock, Citation, Filters, ResponseDoc, ResponseGroup, SurahView };

const JUZ_AR = [
  "",
  "الجزء الأول", "الجزء الثاني", "الجزء الثالث", "الجزء الرابع", "الجزء الخامس",
  "الجزء السادس", "الجزء السابع", "الجزء الثامن", "الجزء التاسع", "الجزء العاشر",
  "الجزء الحادي عشر", "الجزء الثاني عشر", "الجزء الثالث عشر", "الجزء الرابع عشر",
  "الجزء الخامس عشر", "الجزء السادس عشر", "الجزء السابع عشر", "الجزء الثامن عشر",
  "الجزء التاسع عشر", "الجزء العشرون", "الجزء الحادي والعشرون",
  "الجزء الثاني والعشرون", "الجزء الثالث والعشرون", "الجزء الرابع والعشرون",
  "الجزء الخامس والعشرون", "الجزء السادس والعشرون", "الجزء السابع والعشرون",
  "الجزء الثامن والعشرون", "الجزء التاسع والعشرون", "الجزء الثلاثون",
];


/** Reader mode: one surah, sections -> ayat -> verbatim commentary. */
export async function surahView(number: number): Promise<SurahView | null> {
  const [s] = await query<{ id: number; number: number; name_en: string; juz: number; intro: string | null }>(
    `SELECT id, number, name_en, intro,
            COALESCE(
              (SELECT min(juz) FROM section WHERE surah_id = surah.id AND juz IS NOT NULL),
              (SELECT number FROM juz WHERE id = surah.juz_id),
              juz_id
            ) AS juz
     FROM surah WHERE number = $1`,
    [number],
  );
  if (!s) return null;

  const rows = await query<{
    number: number;
    text_ar: string | null;
    translation: string | null;
    section_id: number;
    section_title: string;
    commentary: { id: number; content: string; source_file: string | null }[];
  }>(
    `SELECT a.number, a.text_ar, a.translation,
            sec.id AS section_id, sec.title AS section_title,
            COALESCE(json_agg(json_build_object('id', c.id, 'content', c.content,
                                                'source_file', c.source_file)
                              ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS commentary
     FROM ayah a
     JOIN section sec ON sec.id = a.section_id
     LEFT JOIN commentary c ON c.ayah_id = a.id
     WHERE a.surah_id = $1
     GROUP BY a.id, a.number, a.text_ar, a.translation, sec.id, sec.title, sec.ord
     ORDER BY sec.ord, a.ord`,
    [s.id],
  );

  const sections: SurahView["sections"] = [];
  for (const r of rows) {
    if (sections.length === 0 || sections[sections.length - 1].id !== r.section_id) {
      sections.push({ id: r.section_id, title: r.section_title, ayahs: [] });
    }
    sections[sections.length - 1].ayahs.push({
      number: r.number,
      text_ar: r.text_ar,
      translation: r.translation,
      commentary: r.commentary,
    });
  }

  // Surah-level notes (commentary with no ayah) are the author's own notes on
  // the surah as a whole — kept verbatim, shown before the sections.
  const notes = await query<{ id: number; content: string; source_file: string | null }>(
    `SELECT id, content, source_file FROM commentary
     WHERE surah_id = $1 AND ayah_id IS NULL ORDER BY ord`,
    [s.id],
  );

  return {
    number: s.number,
    name_en: s.name_en,
    juz: s.juz,
    intro: s.intro,
    notes,
    sections,
  };
}

type Hit = {
  content: string;
  source_file: string | null;
  cjuz: number | null;
  ayah_number: number | null;
  surah_number: number;
  name_en: string;
  section_title: string | null;
  text_ar: string | null;
  translation: string | null;
  score: number;
};

/** Hybrid retrieval: pgvector cosine + tsvector keyword, fused per ayah. */
export async function retrieve(
  text: string,
  filters: Filters = {},
  limit = 80,
): Promise<Hit[]> {
  const vec = `[${(await embed(text)).join(",")}]`;
  const rows = await query<Omit<Hit, "score"> & { vsim: number; krank: number }>(
    `SELECT c.content, c.source_file, c.juz AS cjuz,
            a.number AS ayah_number, s.number AS surah_number, s.name_en,
            sec.title AS section_title,
            a.text_ar, a.translation,
            1 - (c.embedding <=> $1::vector) AS vsim,
            ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) AS krank
     FROM commentary c
     LEFT JOIN ayah a ON a.id = c.ayah_id
     JOIN surah s ON s.id = c.surah_id
     LEFT JOIN section sec ON sec.id = a.section_id
     WHERE c.embedding IS NOT NULL
       AND ($3::int IS NULL OR s.number = $3)
       AND ($4::int IS NULL OR c.juz = $4)
     ORDER BY GREATEST(1 - (c.embedding <=> $1::vector),
                       ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) * 3) DESC
     LIMIT ${limit}`,
    [vec, text, filters.surah ?? null, filters.juz ?? null],
  );
  return rows.map((r) => {
    const vsim = Number(r.vsim ?? 0);
    const krank = Number(r.krank ?? 0);
    return { ...r, score: Math.round(Math.max(vsim, Math.min(krank * 3, 1)) * 100) / 100 };
  });
}

/**
 * Search -> response document: hits grouped juz -> surah -> ayah in canonical
 * order, full commentary per matched ayah (decision 4). All text verbatim.
 */
export async function search(
  text: string,
  filters: Filters = {},
  limitAyat = 14,
): Promise<ResponseDoc> {
  const rows = await retrieve(text, filters);

  // Relevance gate. Candidates are ordered by score, but embedding search
  // always returns a tail of loosely-related passages; rendering that tail as
  // "ayat the corpus connects to this query" would misrepresent the corpus.
  // The floor is relative to the best *ayah-level* hit (surah-level notes are
  // long and score higher for any query), with a minimum so a document never
  // renders nearly empty.
  const hits = rows.filter((r) => r.ayah_number !== null);
  const best = hits[0]?.score ?? 0;
  const floor = Math.max(0.2, best * 0.8);
  const kept = hits.filter((r) => r.score >= floor);

  const MIN_AYAT = 6;
  const keptKeys = new Set(kept.map((r) => `${r.surah_number}:${r.ayah_number}`));
  if (keptKeys.size < MIN_AYAT) {
    for (const r of hits) {
      if (keptKeys.size >= MIN_AYAT) break;
      const k = `${r.surah_number}:${r.ayah_number}`;
      if (!keptKeys.has(k)) {
        kept.push(r);
        keptKeys.add(k);
      }
    }
  }

  const byAyah = new Map<string, AyahBlock & { surah: number; cjuz: number; name_en: string }>();
  for (const r of [...kept].sort((a, b) => b.score - a.score)) {
    if (r.ayah_number === null) continue; // surah-level notes are not ayah matches
    const key = `${r.surah_number}:${r.ayah_number}`;
    let hit = byAyah.get(key);
    if (!hit) {
      hit = {
        number: r.ayah_number,
        text_ar: r.text_ar,
        translation: r.translation,
        score: r.score,
        section_title: r.section_title,
        commentary: [],
        surah: r.surah_number,
        cjuz: r.cjuz ?? 99,
        name_en: r.name_en,
      };
      byAyah.set(key, hit);
    }
    hit.commentary.push({ content: r.content, source_file: r.source_file, score: r.score });
  }

  const ordered = [...byAyah.values()]
    .sort((a, b) => a.cjuz - b.cjuz || a.surah - b.surah || a.number - b.number)
    .slice(0, limitAyat);

  const groups: ResponseGroup[] = [];
  for (const h of ordered) {
    let g = groups.find((x) => x.juz === h.cjuz && x.surah === h.surah);
    if (!g) {
      g = {
        juz: h.cjuz,
        juz_ar: JUZ_AR[h.cjuz] ?? "",
        surah: h.surah,
        name_en: h.name_en,
        continued: groups.some((x) => x.surah === h.surah),
        ayat: [],
      };
      groups.push(g);
    }
    const { surah: _s, cjuz: _c, name_en: _n, ...block } = h;
    g.ayat.push(block);
  }

  const top = [...kept].sort((a, b) => b.score - a.score).slice(0, 3);
  return {
    query: text,
    groups,
    stats: {
      ayat: ordered.length,
      surahs: new Set(groups.map((g) => g.surah)).size,
      juz: new Set(groups.map((g) => g.juz)).size,
    },
    cites: top.map((r) => ({
      ref: r.ayah_number ? `${r.surah_number}:${r.ayah_number}` : `Surah ${r.surah_number}`,
      surah: r.name_en,
      excerpt: r.content.slice(0, 160),
      source_file: r.source_file ?? "",
      score: r.score,
    })),
  };
}

export type { Hit };