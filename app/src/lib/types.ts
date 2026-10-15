/** Shared shapes. Client-safe: no DB or SDK imports. */

export type TreeSection = {
  id: number;
  title: string;
  from_ayah: number | null;
  to_ayah: number | null;
};

/** A takeaway block ("MY KEY TAKEAWAYS" recap) at the end of one surah part. */
export type TreeTakeaway = {
  id: number;
  title: string | null;
};

/** One surah as it appears under one juz (a surah recurs when it spans juz). */
export type TreeSurah = {
  juz: number;
  number: number;
  name_en: string;
  ayat: number;
  continued: boolean;
  sections: TreeSection[];
  takeaways: TreeTakeaway[];
};

/** A standalone (non-surah) source document, e.g. the Introduction. */
export type TreeDoc = {
  source_file: string;
  title: string;
};

/** Reader payload for a standalone document: its blocks, as written. */
export type DocView = {
  source_file: string;
  title: string;
  juz: number | null;
  blocks: DocBlock[];
};

export type CommentaryRow = {
  id: number;
  content: string;
  source_file: string | null;
};

/** One paragraph of a source document, in order, with its role. */
export type DocBlock = {
  ord: number;
  kind:
    | "juz_header"
    | "surah_header"
    | "section_heading"
    | "heading"
    | "list_item"
    | "arabic"
    | "translation"
    | "table"
    | "prose"
    | "lesson"
    | "hadith"
    | "cross_ref"
    | "quote";
  text: string;
  ref_surah: number | null;
  ref_ayah: number | null;
  section_id: number | null;
  recap_id?: number | null;
};

/** One source docx, as it was written. */
export type DocDocument = {
  source_file: string;
  juz: number | null;
  blocks: DocBlock[];
};

/**
 * Reader payload: the surah's source documents (one per docx, in reading
 * order), each a faithful block sequence. The derived ayah/section view is not
 * used here — the reader shows the document, not our model of it.
 */
export type SurahView = {
  number: number;
  name_en: string;
  juz: number;
  documents: DocDocument[];
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

/** File-explorer payload: surah nodes under their juz, plus standalone docs. */
export type Tree = {
  surahs: TreeSurah[];
  docs: TreeDoc[];
};

export type Filters = { surah?: number; juz?: number };