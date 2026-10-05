import { Pool } from "pg";
import type { TreeSurah } from "./types";

// DB is the contract between the Python ingestion and this app (PLAN.md).
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://tafseer:tafseer@localhost:5433/tafseer",
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export type { TreeSurah };

export async function tree(): Promise<TreeSurah[]> {
  // The tree mirrors the source layout: juz -> surah part -> sections, from
  // the per-juz structured tables (FORMAT.md v7). A surah recurs under each
  // juz whose folder holds a chunk of it.
  const rows = await query<{
    juz: number;
    number: number;
    name_en: string;
    ayat: number;
    id: number;
    title: string;
    from_ayah: number | null;
    to_ayah: number | null;
  }>(
    `SELECT j.number AS juz, p.surah_number AS number, p.name_en,
            (SELECT count(*)::int FROM ayah_unit u
              JOIN section s2 ON s2.id = u.section_id
              WHERE s2.part_id = p.id) AS ayat,
            sec.id, sec.title, sec.from_ayah, sec.to_ayah
     FROM section sec
     JOIN part p ON p.id = sec.part_id
     JOIN juz j ON j.id = p.juz_id
     WHERE sec.title IS NOT NULL AND sec.title NOT LIKE 'SURAH %'
     ORDER BY j.number, p.ord, sec.ord`,
  );

  const out: TreeSurah[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    let node = out.find((n) => n.juz === r.juz && n.number === r.number);
    if (!node) {
      node = {
        juz: r.juz,
        number: r.number,
        name_en: r.name_en,
        ayat: r.ayat,
        continued: seen.has(r.number),
        sections: [],
      };
      out.push(node);
    }
    seen.add(r.number);
    node.sections.push({
      id: r.id,
      title: r.title,
      from_ayah: r.from_ayah,
      to_ayah: r.to_ayah,
    });
  }
  return out;
}