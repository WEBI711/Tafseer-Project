/** Shared shapes. Client-safe: no DB or SDK imports. */

export type TreeSection = {
  id: number;
  title: string;
  from_ayah: number | null;
  to_ayah: number | null;
};

/** One surah as it appears under one juz (a surah recurs when it spans juz). */
export type TreeSurah = {
  juz: number;
  number: number;
  name_en: string;
  ayat: number;
  continued: boolean;
  sections: TreeSection[];
};

export type CommentaryRow = {
  id: number;
  content: string;
  source_file: string | null;
};

export type SurahView = {
  number: number;
  name_en: string;
  juz: number;
  intro: string | null;
  notes: CommentaryRow[];
  sections: {
    id: number;
    title: string;
    ayahs: {
      number: number;
      text_ar: string | null;
      translation: string | null;
      commentary: CommentaryRow[];
    }[];
  }[];
};

export type AyahBlock = {
  number: number;
  text_ar: string | null;
  translation: string | null;
  score: number;
  section_title: string | null;
  commentary: { content: string; source_file: string | null; score: number }[];
};

export type ResponseGroup = {
  juz: number;
  juz_ar: string;
  surah: number;
  name_en: string;
  continued: boolean;
  ayat: AyahBlock[];
};

export type Citation = {
  ref: string;
  surah: string;
  excerpt: string;
  source_file: string;
  score: number;
};

export type ResponseDoc = {
  query: string;
  groups: ResponseGroup[];
  stats: { ayat: number; surahs: number; juz: number };
  cites: Citation[];
};

export type Filters = { surah?: number; juz?: number };