/**
 * Read a spliced figure-table row back into labelled values.
 *
 * A value taken off a chart is quoted by the extractor as the markdown table
 * row it came from — `6 | 2.5 | 2.0 | 1.5 | 0.5` — because that is literally
 * the text backend/utils/figure_splice.py put in front of the model. The row is
 * verbatim and correct. It is just unreadable, and it says nothing about which
 * column `2.5` belongs to.
 *
 * These helpers zip that row back against the figure's stored `columns`.
 *
 * Everything here returns null rather than guessing. A mislabelled column is
 * worse than an unformatted row: the reviewer cannot tell it happened, and they
 * would be checking `2.5` against the wrong arm of the trial.
 */

/** Cells of one markdown table row, or null if the line isn't one.
 *
 *  Accepts the row with or without outer pipes — `render_figure_block` writes
 *  `| a | b |`, but the model quotes the inner text without them. The `>= 2`
 *  pipe floor mirrors backend/utils/source_linker.py:240, which is what decided
 *  this string was a table row worth indexing in the first place.
 */
export function parsePipeRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if ((trimmed.match(/\|/g) || []).length < 2) return null;
  // Separator rows (`|---|---|`) carry no data. Same test the backend uses.
  if (/^[|\-\s:]+$/.test(trimmed)) return null;
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|').map((c) => c.trim());
}

/** Every data row of a possibly multi-line quote, or null if none parse. */
export function parsePipeRows(quote: string): string[][] | null {
  if (!quote) return null;
  const rows = quote
    .split('\n')
    .map(parsePipeRow)
    .filter((r): r is string[] => r !== null);
  return rows.length > 0 ? rows : null;
}

export interface LabelledCell {
  label: string;
  value: string;
}

/** Zip one row against the figure's columns. Null when the arity disagrees. */
export function alignRowToColumns(
  cells: string[],
  columns: string[] | undefined,
): LabelledCell[] | null {
  if (!columns || columns.length === 0) return null;
  if (cells.length !== columns.length) return null;
  return columns.map((label, i) => ({ label: label.trim(), value: cells[i] }));
}

/** True when `cells` is just the header row — the model sometimes quotes it
 *  along with the data row it actually took the value from. */
export function isHeaderRow(cells: string[], columns: string[] | undefined): boolean {
  if (!columns || cells.length !== columns.length) return false;
  return cells.every((c, i) => c.toLowerCase() === columns[i].trim().toLowerCase());
}

/** The whole read: quote + columns -> labelled rows, or null to fall back to
 *  showing the raw quote. */
export function labelFigureQuote(
  quote: string,
  columns: string[] | undefined,
): LabelledCell[][] | null {
  if (!quote || !columns || columns.length === 0) return null;
  const rows = parsePipeRows(quote);
  if (!rows) return null;
  const data = rows.filter((r) => !isHeaderRow(r, columns));
  if (data.length === 0) return null;
  const aligned = data.map((r) => alignRowToColumns(r, columns));
  if (aligned.some((a) => a === null)) return null;
  return aligned as LabelledCell[][];
}
