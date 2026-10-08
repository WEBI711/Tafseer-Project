"use client";

/**
 * Source paragraphs sometimes quote a verse fragment and comment on it inside
 * one paragraph ("صِرَاطَ الَّذِيْنَ اَنۡعَمۡتَ عَلَيۡهِمۡ refers to the 'straight path'…").
 * The text is the author's, so it is stored and shown unmodified — only the
 * leading Arabic is styled as Arabic (RTL, verse green) instead of body prose.
 *
 * Paragraphs the author uses as labels (short lines, all-caps headings such as
 * "LAWS OF INHERITANCE (7-10)") also carry `no-drop`, because the theme's drop
 * cap is meant for prose openings and mangles a heading.
 */
import { tidy } from "@/lib/text";

const LATIN_RE = /[A-Za-z]/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LABEL_RE = /^[A-Z0-9][A-Z0-9\s'’.,&()/\-–—:]{9,}/;

export default function CommentaryText({
  content,
  className,
  id,
  dataKind,
  dataOrd,
}: {
  content: string;
  className?: string;
  id?: string;
  dataKind?: string;
  dataOrd?: number;
}) {
  const text = tidy(content);
  const i = text.search(LATIN_RE);
  const head = i === -1 ? text : text.slice(0, i);
  const rest = i === -1 ? "" : text.slice(i);

  const isLabel = text.length < 110 || LABEL_RE.test(text);
  const classes = [className, isLabel ? "no-drop" : ""].filter(Boolean).join(" ");

  if (!ARABIC_RE.test(head)) {
    return (
      <p className={classes || undefined} id={id} data-kind={dataKind} data-ord={dataOrd}>
        {text}
      </p>
    );
  }

  return (
    <p
      className={`ar-lead${classes ? ` ${classes}` : ""}`}
      id={id}
      data-kind={dataKind}
      data-ord={dataOrd}
    >
      <span className="ar-inline">{head}</span>
      {rest}
    </p>
  );
}