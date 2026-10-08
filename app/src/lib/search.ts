import { query } from "./db";
import { embed } from "./llm";
import type {
  DocDocument,
  AyahBlock,
  Citation,
  DocBlock,
  Filters,
  ResponseDoc,
  ResponseGroup,
  SurahView,
} from "./types";

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
  // Derived from the per-juz structured tables (FORMAT.md v7): one document
  // per surah part, blocks emitted from sections and ayah units — the same
  // block kinds the Reader renders, now backed by the structured model.
  type PartRow = {
    id: number; source_file: string; juz: number; surah_number: number;
    name_en: string; bismillah: string | null; chunk_marker: string | null;
    from_ayah: number; to_ayah: number;
  };
  const parts = await query<PartRow>(
    `SELECT p.id, p.source_file, j.number AS juz, p.surah_number, p.name_en,
            p.bismillah, p.chunk_marker, p.from_ayah, p.to_ayah
     FROM part p JOIN juz j ON j.id = p.juz_id
     WHERE p.surah_number = $1 ORDER BY j.number, p.ord`,
    [number],
  );
  if (!parts.length) return null;

  const sections = await query<{
    part_id: number; id: number; ord: number; title: string | null; intro: { kind: string; text: string }[];
  }>(
    `SELECT s.part_id, s.id, s.ord, s.title, s.intro
     FROM section s JOIN part p ON p.id = s.part_id
     WHERE p.surah_number = $1 ORDER BY j.number, p.ord, s.ord`.replace(
      "WHERE p.surah_number", "JOIN juz j ON j.id = p.juz_id WHERE p.surah_number"),
    [number],
  );

  const units = await query<{
    part_id: number; section_id: number; ord: number;
    arabic_lines: string[]; translation: { ref: string; text: string; ref_surah: number | null } | null;
  }>(
    `SELECT s.part_id, s.id AS section_id, u.ord, u.arabic_lines, u.translation
     FROM ayah_unit u
     JOIN section s ON s.id = u.section_id
     JOIN part p ON p.id = s.part_id
     JOIN juz j ON j.id = p.juz_id
     WHERE p.surah_number = $1 ORDER BY j.number, p.ord, s.ord, u.ord`,
    [number],
  );

  const commentary = await query<{
    section_id: number; unit_ord: number; ord: number; kind: string; text: string; ref: string | null;
  }>(
    `SELECT s.id AS section_id, u.ord AS unit_ord, ci.ord, ci.kind, ci.text, ci.ref
     FROM commentary_item ci
     JOIN ayah_unit u ON u.id = ci.ayah_unit_id
     JOIN section s ON s.id = u.section_id
     JOIN part p ON p.id = s.part_id
     JOIN juz j ON j.id = p.juz_id
     WHERE p.surah_number = $1 ORDER BY j.number, p.ord, s.ord, u.ord, ci.ord`,
    [number],
  );

  const recaps = await query<{
    part_id: number; id: number; ord: number; title: string | null; items: { kind: string; text: string }[];
  }>(
    `SELECT r.part_id, r.ord, r.title, r.items
     FROM recap r JOIN part p ON p.id = r.part_id
     JOIN juz j ON j.id = p.juz_id
     WHERE p.surah_number = $1 ORDER BY j.number, p.ord, r.ord`,
    [number],
  );

  const commByUnit = new Map<string, { kind: string; text: string; ref: string | null }[]>();
  for (const c of commentary) {
    const key = `${c.section_id}:${c.unit_ord}`;
    const list = commByUnit.get(key) ?? [];
    list.push({ kind: c.kind, text: c.text, ref: c.ref });
    commByUnit.set(key, list);
  }
  const unitsBySection = new Map<number, typeof units>();
  for (const u of units) {
    const list = unitsBySection.get(u.section_id) ?? [];
    list.push(u);
    unitsBySection.set(u.section_id, list);
  }

  const documents: DocDocument[] = parts.map((part) => {
    const blocks: DocBlock[] = [];
    const push = (b: Omit<DocBlock, "ord">) => blocks.push({ ...b, ord: blocks.length });
    if (part.bismillah) push({ kind: "arabic", text: part.bismillah, ref_surah: null, ref_ayah: null, section_id: null });
    push({ kind: "juz_header", text: `Juz ${part.juz}`, ref_surah: null, ref_ayah: null, section_id: null });
    push({ kind: "surah_header", text: `Surah ${part.surah_number} – ${part.name_en}`, ref_surah: null, ref_ayah: null, section_id: null });
    if (part.chunk_marker) push({ kind: "prose", text: part.chunk_marker, ref_surah: null, ref_ayah: null, section_id: null });
    push({ kind: "prose", text: `Ayat ${part.from_ayah}–${part.to_ayah}`, ref_surah: null, ref_ayah: null, section_id: null });

    for (const sec of sections.filter((s) => s.part_id === part.id)) {
      if (sec.title) push({ kind: "section_heading", text: sec.title, ref_surah: null, ref_ayah: null, section_id: sec.id });
      for (const it of sec.intro ?? []) push({ kind: it.kind === "heading" ? "heading" : "prose", text: it.text, ref_surah: null, ref_ayah: null, section_id: null });
      for (const u of unitsBySection.get(0) ?? []) { /* unreachable, keeps types honest */ }
      for (const u of units.filter((x) => x.section_id === sec.id)) {
        for (const a of u.arabic_lines ?? []) push({ kind: "arabic", text: a, ref_surah: null, ref_ayah: null, section_id: null });
        const t = u.translation;
        if (t) {
          const ayah = Number((t.ref.split(/[:\s]/)[1] ?? "").replace(/\D/g, "")) || null;
          push({ kind: "translation", text: t.text, ref_surah: t.ref_surah, ref_ayah: ayah, section_id: null });
        }
        for (const c of commByUnit.get(`${sec.id}:${u.ord}`) ?? []) {
          const kind: DocBlock["kind"] =
            c.kind === "list_item" ? "list_item"
            : c.kind === "heading" ? "heading"
            : "prose";
          push({ kind, text: c.ref ? `(${c.ref}) ${c.text}` : c.text, ref_surah: null, ref_ayah: null, section_id: null });
        }
      }
    }
    for (const r of recaps.filter((r) => r.part_id === part.id)) {
      if (r.title) push({ kind: "heading", text: r.title, ref_surah: null, ref_ayah: null, section_id: null });
      for (const it of r.items ?? []) push({ kind: it.kind === "list_item" ? "list_item" : "prose", text: it.text, ref_surah: null, ref_ayah: null, section_id: null });
    }
    return { source_file: part.source_file, juz: part.juz, blocks };
  });

  const first = parts[0];
  return { number, name_en: first.name_en ?? "", juz: first.juz, documents };
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

export async function retrieve(
  text: string,
  filters: Filters = {},
  limit = 80,
): Promise<Hit[]> {
  const vec = `[${(await embed(text)).join(",")}]`;
  const rows = await query<Omit<Hit, "score"> & { vsim: number; krank: number }>(
    `SELECT c.content, c.source_file, c.juz AS cjuz,
            a.number AS ayah_number, s.number AS surah_number, s.name_en,
            a.section_title,
            a.text_ar, a.translation,
            1 - (c.embedding <=> $1::vector) AS vsim,
            ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) AS krank
     FROM commentary c
     LEFT JOIN ayah a ON a.id = c.ayah_id
     JOIN surah s ON s.id = c.surah_id
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

  return groupIntoDoc(
    kept.filter((r): r is Hit & { ayah_number: number } => r.ayah_number !== null),
    text,
    limitAyat,
  );
}

/** Groups ranked hits into the response document: juz -> surah -> ayah, full commentary. */
export function groupIntoDoc(
  hits: (Hit & { ayah_number: number })[],
  query: string,
  limitAyat = 14,
): ResponseDoc {
  const byAyah = new Map<string, AyahBlock & { surah: number; cjuz: number; name_en: string }>();
  for (const r of [...hits].sort((a, b) => b.score - a.score)) {
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

  // Citation cards should point at distinct passages: the best excerpt of
  // each of the top three ayat, in relevance order (order preserved for equal
  // scores, so the agent's own ref order carries through in buildDoc).
  const top: Hit[] = [];
  const citedAyah = new Set<string>();
  for (const r of [...hits].sort((a, b) => b.score - a.score)) {
    const k = `${r.surah_number}:${r.ayah_number}`;
    if (citedAyah.has(k)) continue;
    citedAyah.add(k);
    top.push(r);
    if (top.length === 3) break;
  }
  return {
    query,
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

/**
 * Response document for the agent's render tool: full verbatim commentary for
 * the chosen ayat, in canonical order. Score is 1 (the agent picked them).
 */
export async function buildDoc(
  refs: { surah: number; ayah: number }[],
  title: string,
): Promise<ResponseDoc | null> {
  if (!refs.length) return null;
  const params: number[] = [];
  const ors = refs.map((r) => {
    params.push(r.surah, r.ayah);
    const i = params.length;
    return `(s.number = $${i - 1} AND a.number = $${i})`;
  });
  const rows = await query<Omit<Hit, "score" | "ayah_number"> & { ayah_number: number }>(
    `SELECT c.content, c.source_file, c.juz AS cjuz,
            a.number AS ayah_number, s.number AS surah_number, s.name_en,
            a.section_title, a.text_ar, a.translation
     FROM commentary c
     JOIN ayah a ON a.id = c.ayah_id
     JOIN surah s ON s.id = c.surah_id
     WHERE ${ors.join(" OR ")}
     ORDER BY s.number, a.number, c.ord`,
    params,
  );
  if (!rows.length) return null;
  // Reorder the rows into the agent's ref order before grouping: display stays
  // canonical (groupIntoDoc re-sorts), but the citation cards then follow the
  // agent's own priority instead of the DB's canonical first three.
  const rank = new Map(refs.map((r, i) => [`${r.surah}:${r.ayah}`, i]));
  const ordered = [...rows].sort(
    (a, b) =>
      (rank.get(`${a.surah_number}:${a.ayah_number}`) ?? Infinity) -
      (rank.get(`${b.surah_number}:${b.ayah_number}`) ?? Infinity),
  );
  return groupIntoDoc(ordered.map((r) => ({ ...r, score: 1 })), title);
}