/**
 * Locate a verbatim source-text passage inside a markdown document.
 *
 * The LLM was prompted to emit `source_text` as an exact substring of the
 * markdown, so `indexOf` succeeds in the common case. We try a whitespace-
 * normalised retry to handle quotes the LLM may have re-flowed; if even that
 * fails we return null and the caller renders the document without highlight.
 */

export interface PassageMatch {
  /** Byte offset of the passage start in the original markdown. */
  startIdx: number;
  /** Byte offset one past the passage end. */
  endIdx: number;
  /** 1-based line number of the line containing the start of the passage. */
  lineNumber: number;
}

/**
 * Strip rendering noise from PDF-extracted markdown so the drawer shows clean
 * prose and so `findPassageInMarkdown` can match the LLM's quotes (which were
 * emitted against the *visible* text, not the raw extractor output).
 *
 * What it removes:
 *  - Page-break sentinels (`{0}---------------------------------------------`)
 *  - MDPI-style journal footers repeated on every page (`Dent. J. 2025, 13, 500`)
 *  - Stand-alone page counters (`5 of 14`)
 *  - Presentational HTML tags left behind by the extractor (`<sup>`, `<sub>`,
 *    `<i>`, `<b>`, `<em>`, `<strong>`, `<u>`, `<br>`, `<small>`)
 *  - Inline LaTeX math delimiters (`$p$` -> `p`, `$\chi^2$` -> `\chi^2`)
 *  - Excess blank lines (collapsed to a single empty line)
 */
export function cleanMarkdown(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(/^[ \t]*\{\d+\}-+[ \t]*$/gm, '')
    .replace(/^[ \t]*Dent\.\s*J\.\s*\*{0,2}\d{4}\*{0,2},\s*\*{0,1}\d+\*{0,1},\s*\d+[ \t]*$/gm, '')
    .replace(/^[ \t]*\d+\s+of\s+\d+[ \t]*$/gm, '')
    .replace(/<\/?(?:sup|sub|i|b|em|strong|u|br|small)(?:\s[^>]*)?\/?>/gi, '')
    .replace(/\$\$([^$]+?)\$\$/g, '$1')
    .replace(/\$([^$\n]+?)\$/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

/** Apply the same noise-stripping rules to an LLM-emitted source quote so it
 *  matches the cleaned markdown when located via `indexOf`. */
export function cleanQuote(quote: string): string {
  if (!quote) return quote;
  return quote
    .replace(/<\/?(?:sup|sub|i|b|em|strong|u|br|small)(?:\s[^>]*)?\/?>/gi, '')
    .replace(/\$\$([^$]+?)\$\$/g, '$1')
    .replace(/\$([^$\n]+?)\$/g, '$1')
    .trim();
}

export function findPassageInMarkdown(
  markdown: string,
  quote: string,
): PassageMatch | null {
  if (!markdown || !quote) return null;
  const q = quote.trim();
  if (q === '' || q === 'NR') return null;

  let idx = markdown.indexOf(q);

  if (idx === -1) {
    // Whitespace-normalised fallback: find an approximate line.
    // We can't recover precise byte offsets after normalisation, but knowing
    // the line lets the raw view highlight the line and the rendered view
    // scroll near the right place.
    const normMd = markdown.replace(/\s+/g, ' ');
    const normQ = q.replace(/\s+/g, ' ');
    const normIdx = normMd.indexOf(normQ);
    if (normIdx === -1) return null;
    // Estimate line by counting newlines up to the proportional original
    // position. This is approximate but stable for the line gutter.
    const ratio = normIdx / Math.max(1, normMd.length);
    const approxIdx = Math.floor(ratio * markdown.length);
    let lineNumber = 1;
    for (let i = 0; i < approxIdx; i++) {
      if (markdown.charCodeAt(i) === 10) lineNumber++;
    }
    return { startIdx: -1, endIdx: -1, lineNumber };
  }

  let lineNumber = 1;
  for (let i = 0; i < idx; i++) {
    if (markdown.charCodeAt(i) === 10) lineNumber++;
  }
  return { startIdx: idx, endIdx: idx + q.length, lineNumber };
}
