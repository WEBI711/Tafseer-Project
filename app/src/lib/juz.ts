// Juz reading view: juz -> parts -> sections -> ayah units -> commentary.
// Mirrors FORMAT.md v7; one query per level keeps the SQL plain.
import { query } from "@/lib/db";

export type CommentaryItem = { kind: string; text: string; ref?: string | null };

export type AyahUnit = {
  ord: number;
  arabicLines: string[];
  translation: { ref: string; text: string; refSurah?: number | null } | null;
  commentary: CommentaryItem[];
  extras: { kind: string; text: string }[];
};

export type Section = {
  ord: number;
  title: string | null;
  intro: CommentaryItem[];
  ayahUnits: AyahUnit[];
};

export type Part = {
  ord: number;
  surahNumber: number;
  nameEn: string | null;
  fromAyah: number;
  toAyah: number;
  continuesFromPrevJuz: boolean;
  continuesInNextJuz: boolean;
  bismillah: string | null;
  chunkMarker: string | null;
  sections: Section[];
};

export type JuzView = {
  number: number;
  arabicHeader: string | null;
  credits: string | null;
  coverage: { surahNumber: number; nameEn: string; fromAyah: number; toAyah: number }[];
  parts: Part[];
};

export async function juzView(number: number): Promise<JuzView | null> {
  const jz = await query<Record<string, any>>(
    `SELECT id, number, arabic_header, credits FROM juz WHERE number = $1`, [number]);
  if (!jz.length) return null;
  const j = jz[0];

  const coverage = await query<Record<string, any>>(
    `SELECT surah_number, name_en, from_ayah, to_ayah
     FROM juz_coverage WHERE juz_id = $1 ORDER BY surah_number`, [j.id]);

  const parts = await query<Record<string, any>>(
    `SELECT id, ord, surah_number, name_en, from_ayah, to_ayah,
            continues_from_prev_juz, continues_in_next_juz, bismillah, chunk_marker
     FROM part WHERE juz_id = $1 ORDER BY ord`, [j.id]);

  const sections = await query<Record<string, any>>(
    `SELECT s.part_id, s.id, s.ord, s.title, s.intro
     FROM section s JOIN part p ON p.id = s.part_id
     WHERE p.juz_id = $1 ORDER BY p.ord, s.ord`, [j.id]);

  const commentary = await query<Record<string, any>>(
    `SELECT ci.ayah_unit_id, ci.ord, ci.kind, ci.text, ci.ref
     FROM commentary_item ci
     JOIN ayah_unit u ON u.id = ci.ayah_unit_id
     JOIN section s ON s.id = u.section_id
     JOIN part p ON p.id = s.part_id
     WHERE p.juz_id = $1 ORDER BY p.ord, s.ord, u.ord, ci.ord`, [j.id]);

  const unitRows = await query<Record<string, any>>(
    `SELECT u.id, u.section_id, u.ord, u.arabic_lines, u.translation, u.extras
     FROM ayah_unit u
     JOIN section s ON s.id = u.section_id
     JOIN part p ON p.id = s.part_id
     WHERE p.juz_id = $1 ORDER BY p.ord, s.ord, u.ord`, [j.id]);

  const commentaryByUnit = new Map<number, CommentaryItem[]>();
  for (const c of commentary) {
    const list = commentaryByUnit.get(c.ayah_unit_id) ?? [];
    list.push({ kind: c.kind, text: c.text, ref: c.ref });
    commentaryByUnit.set(c.ayah_unit_id, list);
  }

  const unitsBySection = new Map<number, AyahUnit[]>();
  for (const r of unitRows) {
    const unit: AyahUnit = {
      ord: r.ord,
      arabicLines: r.arabic_lines ?? [],
      translation: r.translation,
      commentary: commentaryByUnit.get(r.id) ?? [],
      extras: r.extras ?? [],
    };
    const list = unitsBySection.get(r.section_id) ?? [];
    list.push(unit);
    unitsBySection.set(r.section_id, list);
  }

  const sectionsByPart = new Map<number, Section[]>();
  for (const s of sections) {
    const list = sectionsByPart.get(s.part_id) ?? [];
    list.push({
      ord: s.ord,
      title: s.title,
      intro: s.intro ?? [],
      ayahUnits: unitsBySection.get(s.id) ?? [],
    });
    sectionsByPart.set(s.part_id, list);
  }

  return {
    number: j.number,
    arabicHeader: j.arabic_header,
    credits: j.credits,
    coverage: coverage.map((c) => ({
      surahNumber: c.surah_number,
      nameEn: c.name_en,
      fromAyah: c.from_ayah,
      toAyah: c.to_ayah,
    })),
    parts: parts.map((p) => ({
      ord: p.ord,
      surahNumber: p.surah_number,
      nameEn: p.name_en,
      fromAyah: p.from_ayah,
      toAyah: p.to_ayah,
      continuesFromPrevJuz: p.continues_from_prev_juz,
      continuesInNextJuz: p.continues_in_next_juz,
      bismillah: p.bismillah,
      chunkMarker: p.chunk_marker,
      sections: sectionsByPart.get(p.id) ?? [],
    })),
  };
}