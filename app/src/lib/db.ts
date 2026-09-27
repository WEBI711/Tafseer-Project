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
  // A surah is placed under every juz its sections came from, so Surah 2
  // appears under Juz 1, 2 and 3 exactly as the source docs are divided.
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
    `SELECT sec.juz, s.number, s.name_en,
            (SELECT count(*)::int FROM ayah a WHERE a.surah_id = s.id) AS ayat,
            sec.id, sec.title,
            (SELECT min(a.number) FROM ayah a WHERE a.section_id = sec.id) AS from_ayah,
            (SELECT max(a.number) FROM ayah a WHERE a.section_id = sec.id) AS to_ayah
     FROM section sec
     JOIN surah s ON s.id = sec.surah_id
     WHERE sec.juz IS NOT NULL
     ORDER BY sec.juz, s.number, sec.ord, sec.id`,
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