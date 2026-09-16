'use client';

/**
 * One figure, at a size you can actually read.
 *
 * The values here are a machine's reading of a chart. Datalab used to do this and
 * got it wrong in a way that reached an export — an arm understated by 1.23 on a
 * 0-3 scale, two arms ranked backwards. A reviewer's job on this page is to check
 * the numbers against the picture, which means the picture has to be legible and
 * sit next to the numbers.
 *
 * Two layouts, because the two cases want different things:
 *
 *   data chart   image beside its table, so you can compare without scrolling
 *   no data      image across the full card, since there is nothing to compare
 *
 * Nothing is truncated. Captions and notes are one to three sentences; clipping
 * them to a single line is what made the first version unreadable.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Pencil, RefreshCw, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DocumentFigure, FigureCell } from '@/types/api';

import { FigureImage } from '@/components/figures/FigureImage';
import { FigureLightbox } from './FigureLightbox';

interface FigureCardProps {
  documentId: string;
  figure: DocumentFigure;
  /** True while a digitize job for this document is in flight. */
  digitizing?: boolean;
  onSave: (rows: Record<string, FigureCell>[]) => Promise<void>;
  onConfirm: () => Promise<void>;
  onRedigitize: () => Promise<void>;
}

const cellValue = (cell: FigureCell | undefined) => String(cell?.value ?? '');

/** One measure for every prose block on the card.
 *
 *  There were three (80ch, 70ch, 90ch) for text that all reads the same way,
 *  which is how a card ends up looking accidental.
 */
const PROSE = 'max-w-[78ch]';

/** The app's micro-label. Lifted from DecompositionReviewDialog via
 *  consensus/_components/UnifiedFieldCard, and one shade lighter than body text
 *  so a label never competes with the value under it. */
const MICRO = 'text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500';

/** Amber for a low-confidence read, nothing for the rest.
 *
 *  Colour on this card means "a human should look at this" (the rule in
 *  components/ui/badge.tsx). A low-confidence read earns that; a high-confidence
 *  one is the boring majority and gets no celebration.
 */
function confidenceTint(confidence: string): string {
  return /low/i.test(confidence)
    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40'
    : 'bg-gray-100 text-gray-600 dark:bg-[#1f1f1f] dark:text-zinc-300';
}

/** A parenthetical that every value column repeats, pulled out of the headers.
 *
 *  A digitized chart names its series "NS 440 (mean VAS PID ± SEM)",
 *  "APAP 1000 (mean VAS PID ± SEM)", "PLACEBO (mean VAS PID ± SEM)" — the same
 *  eighteen characters three times. That is noise, and it is width the table
 *  cannot spare. Said once above the table it reads better and the arm names
 *  fit on one line. Presentational only: stored columns are untouched and the
 *  full header stays on the cell's title attribute.
 */
function sharedSuffix(columns: string[]): string {
  const values = columns.slice(1);
  if (values.length < 2) return '';
  const match = values[0].trimEnd().match(/\(([^()]+)\)$/);
  if (!match) return '';
  const every = values.every((c) => c.trimEnd().endsWith(match[0]));
  return every ? match[1].trim() : '';
}

/** "Figure 2" out of a full caption, for the header line.
 *
 *  Stored titles are whole captions — "Figure 4: Two attention heads, also in
 *  layer 5 of 6, apparently involved in anaphora resolution. Top: …". Using one
 *  as a heading overran the row and pushed the badge onto its own line. The
 *  caption is still shown in full, on its own lines.
 */
function shortLabel(title: string | null | undefined, page: number | null | undefined): string {
  const match = (title || '').match(/^\s*(fig(?:ure)?\.?\s*\d+[a-z]?)/i);
  if (match) return match[1].replace(/\s+/g, ' ').replace(/\.$/, '');
  return page ? `Figure · p.${page}` : 'Figure';
}

/** The caption without its "Figure N:" prefix, so the header isn't echoed. */
function captionBody(title: string | null | undefined): string {
  return (title || '').replace(/^\s*fig(?:ure)?\.?\s*\d+[a-z]?\s*[:.—-]?\s*/i, '').trim();
}

/** Model notes minus its own self-commentary.
 *
 *  The digitizer sometimes explains its output in terms of the schema — "…
 *  Accordingly, is_data_chart is false and no table is provided" — an internal
 *  field name that means nothing to a reviewer. The prompt now discourages it;
 *  this cleans up records digitized before that change.
 */
function cleanNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes
    .split(/(?<=\.)\s+/)
    .filter((s) => !/is_data_chart|no table is provided|accordingly/i.test(s))
    .join(' ')
    .trim();
}

/** A failure a reviewer can act on, instead of the raw exception.
 *
 *  Digitization errors are model/transport strings — the parse failure arrives as
 *  `Failed to parse FigureTable from completion {"is_data_chart": true, ...}` and
 *  used to be rendered verbatim, so a card showed a wall of truncated JSON. None
 *  of that tells a reviewer anything; what they need is whether to press the
 *  button again or ask someone to look. The raw text stays on the `title`
 *  attribute for whoever is debugging.
 */
function readableError(error: string | null | undefined): string {
  const raw = error ?? '';
  if (/parse|validation|json|schema/i.test(raw)) {
    return "The model's answer for this figure came back malformed. Reading it again usually works.";
  }
  if (/throttl|rate.?limit|too many requests|429/i.test(raw)) {
    return 'The model was busy when this ran. Try reading the figure again.';
  }
  if (/timeout|timed out|deadline/i.test(raw)) {
    return 'This read timed out before the model answered. Try again.';
  }
  if (/credential|denied|unauthoriz|forbidden|401|403/i.test(raw)) {
    return 'The model could not be reached. That is a configuration problem, not a problem with this figure.';
  }
  return 'This figure could not be read. Try reading it again.';
}

export function FigureCard({
  documentId, figure, digitizing, onSave, onConfirm, onRedigitize,
}: FigureCardProps) {
  const columns = figure.columns ?? [];
  const rows = figure.rows ?? [];
  const hasTable = figure.status === 'completed' && columns.length > 0 && rows.length > 0;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // Draft copy so Cancel is real. Changed cells live in a Map keyed `row:col`,
  // and an entry is DELETED when a value returns to its original — so "is dirty"
  // and "how many cells changed" both fall out of its size.
  const [draft, setDraft] = useState<Record<string, FigureCell>[] | null>(null);
  const [changed, setChanged] = useState<Map<string, true>>(new Map());

  const source = editing && draft ? draft : rows;
  const label = shortLabel(figure.title, figure.page);
  const caption = captionBody(figure.title);
  const notes = cleanNotes(figure.notes);

  const startEdit = () => {
    setDraft(rows.map((r) => ({ ...r })));
    setChanged(new Map());
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setChanged(new Map());
    setEditing(false);
  };

  const editCell = (rowIdx: number, col: string, next: string) => {
    setDraft((prev) => {
      const base = prev ?? rows.map((r) => ({ ...r }));
      const copy = base.map((r, i) => (i === rowIdx ? { ...r } : r));
      copy[rowIdx] = { ...copy[rowIdx], [col]: { ...copy[rowIdx][col], value: next } };
      return copy;
    });
    setChanged((prev) => {
      const key = `${rowIdx}:${col}`;
      const map = new Map(prev);
      if (next === cellValue(rows[rowIdx]?.[col])) map.delete(key);
      else map.set(key, true);
      return map;
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      setDraft(null);
      setChanged(new Map());
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  // Colour marks "a human still needs to look at this" and nothing else — the
  // rule badge.tsx sets out. A verified figure is the boring majority, so it is
  // neutral, not celebratory.
  const badge = useMemo(() => {
    if (digitizing) {
      return (
        <Badge variant="active">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
          Digitizing…
        </Badge>
      );
    }
    if (figure.status === 'failed') return <Badge variant="critical">Could not read</Badge>;
    if (figure.status === 'not_a_chart') return <Badge variant="neutral">No data to read</Badge>;
    if (!hasTable) return <Badge variant="neutral">No values yet</Badge>;
    if (figure.verified) {
      return (
        <Badge variant="neutral">
          <Check className="h-3 w-3" />
          {figure.corrected_cells
            ? `Verified · ${figure.corrected_cells} corrected`
            : 'Verified'}
        </Badge>
      );
    }
    return <Badge variant="attention">Auto-read · unverified</Badge>;
  }, [digitizing, figure.status, figure.verified, figure.corrected_cells, hasTable]);

  const lightbox = zoomed ? (
    <FigureLightbox
      documentId={documentId}
      image={figure.image}
      title={figure.title || label}
      caption={notes || undefined}
      onClose={() => setZoomed(false)}
    />
  ) : null;

  // The caption is a SIBLING of the badge row, never a child of it.
  //
  // It used to be nested inside the `min-w-0` half of a flex row that also held
  // a `shrink-0` badge, which left it roughly 240px of a 460px column: every
  // caption wrapped into a narrow ragged block with dead space beside it. The
  // `max-w-[80ch]` it carried never bound — the flex row was the real limit.
  // Confidence moved to the notes disclosure, where it labels the caveats it
  // belongs to.
  const header = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-[14px] font-semibold">{label}</span>
          <span className="whitespace-nowrap text-[11px] text-gray-400 dark:text-zinc-500">
            p.{figure.page ?? '?'}
          </span>
        </div>
        <div className="shrink-0">{badge}</div>
      </div>
      {caption && (
        <p className={cn('mt-1.5 text-[12.5px] leading-relaxed text-gray-500 dark:text-zinc-400', PROSE)}>
          {caption}
        </p>
      )}
    </>
  );

  // ── Nothing to tabulate: the image gets the whole card ─────────────────────
  if (figure.status === 'not_a_chart') {
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-[#1f1f1f]">
            {header}
            {/* Not collapsed here: on a diagram the description IS the content,
                so there would be nothing left on the card. */}
            {notes && (
              <p className={cn('mt-2 text-[12.5px] leading-relaxed text-gray-500 dark:text-zinc-400', PROSE)}>
                {notes}
              </p>
            )}
          </div>
          <div className="p-5">
            <FigureImage
              documentId={documentId}
              image={figure.image}
              alt={figure.title || label}
              size="full"
              onClick={() => setZoomed(true)}
            />
          </div>
        </div>
        {lightbox}
      </>
    );
  }

  // Axis metadata as a metrics strip rather than one run of small mono text —
  // the DecompositionReviewDialog pattern, where separation comes from
  // `divide-x` on a rounded container instead of table borders. These four
  // facts are what let a reviewer check the calibration, so they deserve to be
  // readable rather than a footnote.
  const axisFacts = [
    figure.x_axis_label && { key: 'x axis', value: figure.x_axis_label },
    figure.y_axis_label && { key: 'y axis', value: figure.y_axis_label },
    figure.y_axis_range && { key: 'range', value: figure.y_axis_range },
    figure.dispersion_measure && { key: 'dispersion', value: figure.dispersion_measure, tint: true },
  ].filter(Boolean) as { key: string; value: string; tint?: boolean }[];

  const suffix = sharedSuffix(columns);
  const headerLabel = (col: string, j: number) =>
    j === 0 || !suffix ? col : col.trimEnd().replace(/\s*\([^()]+\)$/, '');

  // ── Data chart: image beside its numbers ──────────────────────────────────
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        {/* Side by side only from `lg`. At the `md` breakpoint the 520px image
            track left the table about 136px — narrower than one of its columns —
            so a tablet is better served by the stacked layout, where the table
            gets the full card width. The image track steps up again at `xl`. */}
        <div className={cn(
          'grid grid-cols-1',
          'lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]',
          'xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]',
        )}>
          <div className="border-b border-gray-100 p-5 lg:border-b-0 lg:border-r dark:border-[#1f1f1f]">
            {header}
            <div className="mt-4">
              <FigureImage
                documentId={documentId}
                image={figure.image}
                alt={figure.title || label}
                size="chart"
                onClick={() => setZoomed(true)}
              />
            </div>

            {/* Under the picture, not beside the table: these are facts about
                the axes, and they are what a reviewer checks the calibration
                against. Keeping them here also evens out two columns that
                otherwise left ~190px of dead space below the image. */}
            {axisFacts.length > 0 && (
              <div className={cn(
                'mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200',
                'divide-x divide-y divide-gray-100',
                'dark:divide-[#1f1f1f] dark:border-[#1f1f1f]',
              )}>
                {axisFacts.map((fact) => (
                  <div key={fact.key} className="min-w-0 px-3 py-2.5">
                    <p className={MICRO}>{fact.key}</p>
                    {/* Wraps. A y-axis label can be a whole sentence ("Mean Pain
                        Relief (None=0 … A Lot=3)") and clipping it hides the
                        scale the numbers were read against. */}
                    <p className={cn(
                      'mt-1 break-words text-[12.5px] font-medium leading-snug',
                      fact.tint
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-gray-700 dark:text-zinc-300',
                    )}>
                      {fact.value}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col p-5">
            {figure.status === 'failed' && (
              <p
                className={cn('text-[13px] leading-relaxed text-muted', PROSE)}
                title={figure.error || undefined}
              >
                {readableError(figure.error)}
              </p>
            )}

            {!hasTable && figure.status !== 'failed' && (
              <p className="text-[13px] text-muted">No values were read from this figure yet.</p>
            )}

            {hasTable && (
              <>
                {/* Scrolls in both directions inside its own frame. A figure
                    with six arms is wider than any card, and letting the table
                    set the page width is what pushes the whole layout sideways.
                    `w-max` is what makes the horizontal scroll real — under
                    `w-full` the columns squash instead. `border-separate` is
                    required, not cosmetic: collapsed borders do not render on
                    sticky cells, so the frozen header and first column would
                    lose their rules. */}
                <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-[#1f1f1f]">
                  {/* Said once, above the table, instead of three times across
                      its headers. See sharedSuffix. */}
                  {suffix && (
                    <div className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-[#1f1f1f]">
                      <span className={MICRO}>every column</span>
                      <span className="text-[11.5px] text-gray-600 dark:text-zinc-400">{suffix}</span>
                    </div>
                  )}
                  <div className="max-h-[440px] overflow-auto">
                  <table className="w-max min-w-full border-separate border-spacing-0 text-[13px] tabular-nums">
                    <thead>
                      <tr>
                        {columns.map((c, j) => (
                          <th
                            key={c}
                            title={c}
                            className={cn(
                              'sticky top-0 whitespace-nowrap border-b-2 border-gray-200 bg-gray-50 px-4 py-3',
                              'text-[10px] font-semibold uppercase tracking-wider',
                              'dark:border-[#232323] dark:bg-[#0d0d0d]',
                              // The first column is frozen too, so the axis
                              // value stays visible while you scroll out to a
                              // far arm. Its header sits at the intersection
                              // and needs to win both stacking contexts.
                              j === 0
                                ? 'left-0 z-[3] text-left text-gray-400 dark:text-zinc-500'
                                : 'z-[2] text-right text-gray-500 dark:text-zinc-400',
                            )}
                          >
                            {headerLabel(c, j)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="[&>tr:last-child>td]:border-b-0">
                      {source.map((row, i) => (
                        <tr key={i}>
                          {columns.map((col, j) => {
                            const val = cellValue(row[col]);
                            const isChanged = changed.has(`${i}:${col}`);
                            const edge = cn(
                              'border-b border-gray-100 dark:border-[#1c1c1c]',
                              j === 0
                                && 'sticky left-0 z-[1] whitespace-nowrap bg-white dark:bg-[#111111]',
                            );
                            if (editing && j > 0) {
                              return (
                                <td key={col} className={cn(edge, 'px-4 py-2 text-right')}>
                                  <input
                                    value={val}
                                    onChange={(e) => editCell(i, col, e.target.value)}
                                    className={cn(
                                      'w-28 rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums',
                                      'bg-white dark:bg-[#0a0a0a]',
                                      isChanged
                                        ? 'border-primary-500 bg-blue-50 dark:bg-blue-900/10'
                                        : 'border-border dark:border-[#2a2a2a]',
                                    )}
                                  />
                                </td>
                              );
                            }
                            return (
                              <td
                                key={col}
                                className={cn(
                                  edge,
                                  'px-4 py-2.5',
                                  j === 0
                                    ? 'text-muted'
                                    : 'whitespace-nowrap text-right font-semibold',
                                )}
                              >
                                {val}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Collapsed. These are eight lines of honest hedging about
                    marker spacing and error-bar cap widths — worth keeping, and
                    worth not letting outweigh the numbers they qualify. The
                    confidence chip rides on the summary so a low-confidence read
                    is visible while shut. */}
                {notes && !editing && (
                  <details className="group mt-3">
                    <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                      <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
                      Reader&rsquo;s notes
                      {figure.confidence && (
                        <span className={cn(
                          'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          confidenceTint(figure.confidence),
                        )}>
                          {figure.confidence} confidence
                        </span>
                      )}
                    </summary>
                    <p className={cn(
                      'mt-2 max-h-36 overflow-y-auto text-[12px] leading-relaxed text-gray-500 dark:text-zinc-400',
                      PROSE,
                    )}>
                      {notes}
                    </p>
                  </details>
                )}
              </>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              {hasTable && !editing && (
                <>
                  <Button size="sm" variant="outline" onClick={startEdit} disabled={busy}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit values
                  </Button>
                  {!figure.verified && (
                    <Button size="sm" onClick={() => run(onConfirm)} loading={busy}>
                      Confirm as-is
                    </Button>
                  )}
                </>
              )}

              {editing && (
                <>
                  <Button size="sm" onClick={save} loading={saving} disabled={changed.size === 0}>
                    {changed.size > 0
                      ? `Save ${changed.size} change${changed.size === 1 ? '' : 's'}`
                      : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </>
              )}

              {!hasTable && !editing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(onRedigitize)}
                  loading={busy || digitizing}
                >
                  {digitizing
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  Read values from figure
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {lightbox}
    </>
  );
}
