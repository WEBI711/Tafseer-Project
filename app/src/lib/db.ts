import { Pool } from "pg";
import type { DocBlock, DocView, TreeDoc, TreeSurah, Tree } from "./types";

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

export type { TreeSurah, Tree };

export async function tree(): Promise<Tree> {
  // The tree mirrors the source layout: juz -> surah part -> sections, from
  // the per-juz structured tables (FORMAT.md v7). A surah recurs under each
  // juz whose folder holds a chunk of it. Parts sort by surah reading order
  // (number, then from_ayah), not the file-derived ord — juz 30's source
  // files arrived out of sequence (#31).
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
     ORDER BY j.number, p.surah_number, p.from_ayah, sec.ord`,
  );

  // Takeaways are the author's "MY KEY TAKEAWAYS" recaps, stored verbatim in
  // recap (one per surah part). Content stays fixed — as written, not editable.
  const takeaways = await query<{
    juz: number;
    number: number;
    id: number;
    title: string | null;
  }>(
    `SELECT j.number AS juz, p.surah_number AS number, r.id, r.title
     FROM recap r
     JOIN part p ON p.id = r.part_id
     JOIN juz j ON j.id = p.juz_id
     WHERE r.title IS NOT NULL AND r.title ILIKE 'my key tak%'
     ORDER BY j.number, p.surah_number, p.from_ayah, r.ord`,
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
        takeaways: [],
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
  for (const t of takeaways) {
    out
      .find((n) => n.juz === t.juz && n.number === t.number)
      ?.takeaways.push({ id: t.id, title: t.title });
  }
  // Standalone documents (no surah): title from the first heading, else the
  // file name. Their home is doc_block with a NULL surah_number, but migration
  // 007 dropped doc_block when the structured model landed — until a migration
  // restores it (with the Introduction), keep the tree working with no docs.
  const docs: TreeDoc[] = [];
  if (await docBlockExists()) {
    const docRows = await query<{ source_file: string; title: string | null }>(
      `SELECT d.source_file,
              (SELECT d2.text FROM doc_block d2
               WHERE d2.source_file = d.source_file AND d2.surah_number IS NULL
                 AND d2.kind IN ('heading', 'section_heading')
               ORDER BY d2.ord LIMIT 1) AS title
       FROM doc_block d
       WHERE d.surah_number IS NULL
       GROUP BY d.source_file
       ORDER BY d.source_file`,
    );
    for (const r of docRows) {
      docs.push({
        source_file: r.source_file,
        title: r.title ?? r.source_file.replace(/\.docx$/i, ""),
      });
    }
  }
  return { surahs: out, docs };
}

export async function documentView(sourceFile: string): Promise<DocView | null> {
  if (!(await docBlockExists())) return null;
  const rows = await query<{
    source_file: string; juz: number | null; kind: string; text: string;
    ref_surah: number | null; ref_ayah: number | null;
  }>(
    `SELECT source_file, juz, kind, text, ref_surah, ref_ayah
     FROM doc_block
     WHERE source_file = $1 AND surah_number IS NULL
     ORDER BY ord`,
    [sourceFile],
  );
  if (!rows.length) return null;
  const heading = rows.find((r) => r.kind === "heading" || r.kind === "section_heading");
  return {
    source_file: rows[0].source_file,
    title: heading?.text ?? rows[0].source_file.replace(/\.docx$/i, ""),
    juz: rows[0].juz,
    blocks: rows.map((r, i) => ({
      ord: i,
      kind: r.kind as DocBlock["kind"],
      text: r.text,
      ref_surah: r.ref_surah,
      ref_ayah: r.ref_ayah,
      section_id: null,
    })),
  };
}

/**
 * One saved edit by the designated editor: rewrites the block text and writes
 * the before/after audit row in the same statement, so a change can never land
 * unrecorded. doc_block_edit itself must exist (migration 009); a missing
 * doc_block table is reported, not thrown, matching the read paths above.
 */
export async function updateDocBlock(
  sourceFile: string,
  ord: number,
  text: string,
  editor: string,
): Promise<"ok" | "no-block" | "unavailable"> {
  if (!(await docBlockExists())) return "unavailable";
  const rows = await query<{ id: number }>(
    `WITH target AS (
       SELECT id, text FROM doc_block
       WHERE source_file = $1 AND ord = $2 AND surah_number IS NULL
       FOR UPDATE
     ), upd AS (
       UPDATE doc_block SET text = $3 WHERE id = (SELECT id FROM target) RETURNING id
     )
     INSERT INTO doc_block_edit (block_id, source_file, ord, editor, before_text, after_text)
     SELECT id, $1, $2, $4, (SELECT text FROM target), $3 FROM upd
     RETURNING id`,
    [sourceFile, ord, text, editor],
  );
  return rows.length ? "ok" : "no-block";
}

// Helpers

// Probe instead of assuming: doc_block was dropped by migration 007 and has
// no replacement yet, so a missing table must degrade gracefully, not 500.
async function docBlockExists(): Promise<boolean> {
  const rows = await query<{ ok: boolean }>(
    `SELECT to_regclass('doc_block') IS NOT NULL AS ok`,
  );
  return rows[0]?.ok === true;
}