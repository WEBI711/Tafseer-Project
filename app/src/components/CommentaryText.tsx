"use client";

/**
 * The source docs sometimes quote a verse fragment and comment on it inside one
 * paragraph ("صِرَاطَ الَّذِيْنَ اَنۡعَمۡتَ عَلَيۡهِمۡ refers to the 'straight path'…").
 * The text is the author's, so it is stored and shown unmodified — only the
 * leading Arabic is styled as Arabic (RTL, verse green) instead of body prose.
 */
const LATIN_RE = /[A-Za-z]/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

export default function CommentaryText({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const i = content.search(LATIN_RE);
  const head = i === -1 ? content : content.slice(0, i);
  const rest = i === -1 ? "" : content.slice(i);

  if (!ARABIC_RE.test(head)) {
    return <p className={className}>{content}</p>;
  }

  return (
    <p className={`ar-lead${className ? ` ${className}` : ""}`}>
      <span className="ar-inline">{head}</span>
      {rest}
    </p>
  );
}