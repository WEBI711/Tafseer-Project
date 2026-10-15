/**
 * Render-time whitespace tidy-up. The source docs carry stray spacing: runs of
 * spaces, trailing spaces on a line, stacks of blank lines inside one
 * paragraph. The author's own line breaks are kept (the reader shows them via
 * white-space:pre-wrap) — only the noise around them is collapsed.
 */
export function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
