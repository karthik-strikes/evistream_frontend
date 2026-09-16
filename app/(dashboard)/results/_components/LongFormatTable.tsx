'use client';

import { EMPTY_DISPLAY_TOKENS, FAILED_LABEL, compareKey } from '@/lib/absence';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { cn, modelTagTheme, modelFamilyLabel, modelFamily } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { DocumentTags } from '@/components/documents/DocumentTags';
import type { FormField } from '@/types/api';
import { transformToLongFormat } from '@/lib/longFormatTransform';
import { FieldInfoTooltip } from '@/components/forms/FieldInfoTooltip';
import { Quote, ScanText, Users } from 'lucide-react';
import { SourceEvidenceDrawer } from '@/components/source-evidence/SourceEvidenceDrawer';
import { buildLabelMap, documentLabel } from '@/lib/documentLabel';
import { boxesFromLocation, hasShowableEvidence } from '@/lib/sourceBoxes';
import { Avatar } from '@/components/ui/avatar';
import { ROLE_COLORS } from '@/lib/reviewerColors';
import { cellProvenance, latestTouch, touchedByHuman } from '@/lib/provenance';
import type { Person } from '@/hooks/useProjectPeople';
import { CellHistoryPanel, type CellHistoryTarget } from './CellHistoryPanel';
import { isReviewRole } from './ResultsPeople';
import type { SeatResolver } from '@/lib/reviewerSeats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Evidence a reviewer can be shown: a quote, a drawn box, or a figure. Gating
 *  on `source_text` alone hid a citation made by dragging a box — the reviewer's
 *  own evidence disappeared on the screen that is supposed to display it. */
function hasEvidence(data: any): boolean {
  return hasShowableEvidence(data);
}

function getSourceText(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.source_text === 'string' && data.source_text.trim() && data.source_text !== 'NR') {
    return data.source_text;
  }
  return null;
}

function getSyntheticCaption(data: any): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return data.source_location?.synthetic_caption === true;
}
function getCaptionImage(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data.source_location?.caption_image ?? null;
}
function getFromFigure(data: any): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return data.source_location?.from_figure === true;
}
function getFigureImage(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data.source_location?.figure_image ?? null;
}
/** Null, not false, when absent: "we don't know" and "checked, and it is not
 *  verified" drive different banner wording. */
function getFigureVerified(data: any): boolean | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const v = data.source_location?.figure_verified;
  return typeof v === 'boolean' ? v : null;
}

function getPageRef(data: any): number | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.page === 'number') return data.page;
  const loc = data.source_location;
  if (loc && typeof loc === 'object' && loc.page) return Number(loc.page);
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LongFormatTableProps {
  results: Array<{
    id: string;
    document_id: string;
    extracted_data: Record<string, any>;
    created_at?: string;
    model_name?: string | null;
    extraction_type?: string | null;
    reviewer_role?: string | null;
    extracted_by?: string | null;
  }>;
  documentsMap: Record<
    string,
    {
      id: string;
      filename: string;
      ref_id?: number | null;
      labels?: string[] | null;
      source_type?: string | null;
      s3_pdf_path?: string | null;
      nct_id?: string | null;
      pmid?: string | null;
      doi?: string | null;
    }
  >;
  formFields: FormField[];
  formId?: string;
  /** Papers the page considers flagged (>half their fields empty). Drives the row badge. */
  flaggedDocIds?: Set<string>;
  /** Tags currently filtering the page's results — for chip highlighting only. */
  activeTags?: string[];
  /** Toggle a tag on the page's filter. Omit to render tags as plain, unclickable chips. */
  onToggleTag?: (tag: string) => void;
  /** Needed by the cell-history panel: `GET /audit/entity/...` is project-scoped. */
  projectId?: string;
  /** Resolves the seat a person actually holds from `review_assignments`, not
   *  from the row's stale `reviewer_role`. Omit and the row's label is used. */
  seatOf?: SeatResolver;
  /** Resolves a user id to a name and a stable avatar colour. Omit to hide
   *  authorship entirely — the toggle does not appear. */
  personOf?: (
    userId: string | null | undefined,
    fallback?: { name?: string | null; email?: string | null },
  ) => Person | null;
  /** Another run's values, keyed `documentId|rowIndexWithinPaper|column`. When
   *  present, cells whose value differs are marked and show what they said
   *  before. Rows pair by position — see the note where this is built. */
  baselineCells?: Record<string, string> | null;
  /** What one cell has said across every run, for the history panel. */
  runHistoryFor?: (documentId: string, rowIndex: number, column: string) =>
    { runId: string; at: string; model: string | null; value: string }[];
}

interface ChipRef {
  ri: number;
  col: string;
}

export default function LongFormatTable({
  results, documentsMap, formFields, formId, flaggedDocIds, activeTags = [], onToggleTag,
  projectId, personOf, seatOf, baselineCells, runHistoryFor,
}: LongFormatTableProps) {
  const { columns, rows } = useMemo(
    () => transformToLongFormat(results, formFields, documentsMap),
    [results, formFields, documentsMap]
  );

  // Same project-wide map transformToLongFormat builds for the "Paper" column,
  // so the evidence drawer's header cannot disagree with the row it opened from.
  const docLabels = useMemo(() => buildLabelMap(Object.values(documentsMap)), [documentsMap]);

  const [showEvidence, setShowEvidence] = useState(false);
  const [active, setActive] = useState<ChipRef | null>(null);
  /** Authorship is opt-in, like sources: on a 58-row table an avatar in every
   *  human-touched cell is a lot of ink for a question you are not always
   *  asking. Off by default so the table looks exactly as it did. */
  const [showAuthors, setShowAuthors] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<CellHistoryTarget | null>(null);
  const canAttribute = !!personOf;


  // Column reorder (first/"Paper" column is locked in place)
  const colOrderKey = formId ? `results-col-order:${formId}` : null;
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  useEffect(() => {
    if (!colOrderKey) { setColumnOrder([]); return; }
    try {
      const raw = localStorage.getItem(colOrderKey);
      setColumnOrder(raw ? JSON.parse(raw) : []);
    } catch { setColumnOrder([]); }
  }, [colOrderKey]);
  useEffect(() => {
    if (!colOrderKey) return;
    try { localStorage.setItem(colOrderKey, JSON.stringify(columnOrder)); } catch {}
  }, [columnOrder, colOrderKey]);
  const draggedColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const moveColumn = useCallback((dataCols: string[], dragged: string, target: string, lockedCol: string) => {
    if (dragged === target || dragged === lockedCol || target === lockedCol) return;
    const next = [...dataCols];
    const from = next.indexOf(dragged);
    const to = next.indexOf(target);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    setColumnOrder(next);
  }, []);
  const PAPER_COL = columns[0];
  const dataCols = useMemo(() => {
    if (columns.length === 0) return [];
    const colSet = new Set(columns);
    const userOrdered = columnOrder.filter(c => colSet.has(c) && c !== PAPER_COL);
    const remaining = columns.filter(c => c !== PAPER_COL && !userOrdered.includes(c));
    return [...userOrdered, ...remaining];
  }, [columns, columnOrder, PAPER_COL]);
  const orderedColumns = useMemo(
    () => (columns.length === 0 ? columns : [PAPER_COL, ...dataCols]),
    [columns, dataCols, PAPER_COL]
  );
  /**
   * `Ref ID` keeps its place in `columns` because `buildColumns` feeds the CSV and
   * JSON exports as well as this table — dropping it there would change the export.
   * It just stops being its own column: the number now rides in the paper cell.
   */
  const REF_COL = 'Ref ID';
  const displayColumns = useMemo(() => orderedColumns.filter(c => c !== REF_COL), [orderedColumns]);

  /**
   * Which model families are on screen. A badge per row only earns its place when
   * the rows actually differ — one model across the whole table says it once, next
   * to the form name, not 58 times down the paper column.
   */
  const modelFamiliesShown = useMemo(() => {
    const present = new Set<string>();
    for (const r of rows) if (r._modelName) present.add(modelFamily(r._modelName));
    return present;
  }, [rows]);
  const showRowModelBadge = modelFamiliesShown.size > 1;

  // Flat lookup map: field_name → FormField (includes subform fields)
  const fieldMap = useMemo(() => {
    const map: Record<string, FormField> = {};
    for (const f of formFields) {
      map[f.field_name] = f;
      for (const sf of (f.subform_fields ?? [])) {
        map[sf.field_name] = sf;
      }
    }
    return map;
  }, [formFields]);

  // Map resultId → extracted_data for top-level source_text lookup (fallback only).
  const resultDataMap = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    for (const r of results) {
      map[r.id] = r.extracted_data ?? {};
    }
    return map;
  }, [results]);

  // Ordered list of every cell carrying a source_text. Reading order: row by
  // row, left to right, following the user's column order. Drives prev/next
  // navigation inside the drawer.
  const chipOrder = useMemo<ChipRef[]>(() => {
    const list: ChipRef[] = [];
    rows.forEach((row, ri) => {
      displayColumns.forEach((col, ci) => {
        if (ci === 0) return; // Paper column
        const raw = row._rawCells?.[col] ?? resultDataMap[row._resultId]?.[col];
        if (hasEvidence(raw)) list.push({ ri, col });
      });
    });
    return list;
  }, [rows, displayColumns, resultDataMap]);

  // Resolve the currently active chip into drawer-shaped props.
  const activeData = useMemo(() => {
    if (!active) return null;
    const row = rows[active.ri];
    if (!row) return null;
    const raw = row._rawCells?.[active.col] ?? resultDataMap[row._resultId]?.[active.col];
    const sourceText = getSourceText(raw);
    if (!hasEvidence(raw)) return null;
    const doc = documentsMap[row._documentId];
    // Display value the cell shows — used in the "Derived value" callout
    // when the source quote can't be located verbatim in the PDF.
    const displayVal = row[active.col];
    const storedValue =
      displayVal === null || displayVal === undefined ? null : String(displayVal);
    return {
      sourceText,
      storedValue,
      boxes: boxesFromLocation(raw?.source_location),
      page: getPageRef(raw),
      syntheticCaption: getSyntheticCaption(raw),
      captionImage: getCaptionImage(raw),
      fromFigure: getFromFigure(raw),
      figureImage: getFigureImage(raw),
      figureVerified: getFigureVerified(raw),
      documentId: row._documentId,
      documentFilename: docLabels[row._documentId] ?? (doc ? documentLabel(doc) : row._paperFilename),
      fieldLabel: formatColumnName(active.col),
      hasPdf: !!doc?.s3_pdf_path,
      sourceType: doc?.source_type ?? null,
      recordId: doc?.nct_id ?? doc?.pmid ?? null,
      doi: doc?.doi ?? null,
    };
  }, [active, rows, resultDataMap, documentsMap, docLabels]);

  // Prev/next indices into chipOrder for the active chip.
  const activeIndex = useMemo(() => {
    if (!active) return -1;
    return chipOrder.findIndex(c => c.ri === active.ri && c.col === active.col);
  }, [active, chipOrder]);

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < chipOrder.length - 1;
  const goPrev = () => hasPrev && setActive(chipOrder[activeIndex - 1]);
  const goNext = () => hasNext && setActive(chipOrder[activeIndex + 1]);

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl">
        No data to display.
      </div>
    );
  }

  // Detect paper boundaries for visual grouping.
  //
  // Assumes one paper's rows are contiguous, which `transformToLongFormat`
  // guarantees by emitting each result's rows together. Sort `results` upstream,
  // never `rows` — a row-level sort scatters a paper's rows and both this and the
  // once-per-paper identity block below start marking the wrong rows.
  const paperBoundaries = new Set<number>();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]._documentId !== rows[i - 1]._documentId) {
      paperBoundaries.add(i);
    }
  }

  // Each row's position within its own paper. This is what a run-to-run diff
  // pairs on, so it must be counted the same way the baseline index was built:
  // per document, in emission order.
  const rowIndexInPaper: number[] = [];
  {
    const nth: Record<string, number> = {};
    for (const row of rows) {
      const doc = row._documentId;
      rowIndexInPaper.push((nth[doc] = (nth[doc] ?? -1) + 1));
    }
  }

  // Three states, not two: a reported value, an absence the paper is
  // responsible for (NR/NA), and our own failure to read it.
  const isFailed = (val: string) => val === FAILED_LABEL;
  const isMissing = (val: string) =>
    !val || val === '—' || val === '' || EMPTY_DISPLAY_TOKENS.has(String(val).trim().toUpperCase());

  return (
    <>
      {/* One card: controls, table, and the counts that describe it. */}
      <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f]">
        <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider ml-auto">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-200 dark:bg-green-700 inline-block" />Reported</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-200 dark:bg-rose-700 inline-block" />Not reported (NR) / not applicable (NA)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200 dark:bg-amber-700 inline-block" />{FAILED_LABEL} Extraction failed — needs a re-run</span>
          {showEvidence && (
            <span className="flex items-center gap-1.5"><Quote className="w-2.5 h-2.5 text-green-500" />Has source — click to view</span>
          )}
          {showAuthors && (
            <span className="flex items-center gap-1.5"><Users className="w-2.5 h-2.5 text-gray-400" />Touched by a person — click for its history</span>
          )}
        </div>
        {/* Show Sources toggle */}
        <button
          onClick={() => { setShowEvidence(v => !v); setActive(null); }}
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
            showEvidence
              ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
              : 'bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] text-gray-500 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-[#2a2a2a]'
          )}
        >
          <ScanText className="w-3.5 h-3.5" />
          {showEvidence ? 'Hide Sources' : 'Show Sources'}
        </button>
        {/* Show authors toggle. Neutral, not coloured: badge.tsx's rule is that
            colour encodes required human action, and authorship is provenance. */}
        {canAttribute && (
          <button
            onClick={() => { setShowAuthors(v => !v); setHistoryTarget(null); }}
            title="Mark every cell a person entered, edited or confirmed"
            className={cn(
              'flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
              showAuthors
                ? 'bg-gray-900 dark:bg-zinc-100 border-gray-900 dark:border-zinc-100 text-white dark:text-gray-900'
                : 'bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] text-gray-500 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-[#2a2a2a]'
            )}
          >
            <Users className="w-3.5 h-3.5" />
            {showAuthors ? 'Hide Authors' : 'Show Authors'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              {displayColumns.map((col, ci) => {
                const field = fieldMap[col];
                const isPaperCol = ci === 0;
                const isDragOver = dragOverCol === col && !isPaperCol;
                return (
                  <th
                    key={col}
                    draggable={!isPaperCol}
                    onDragStart={() => { if (!isPaperCol) draggedColRef.current = col; }}
                    onDragOver={(e) => {
                      if (isPaperCol) return;
                      e.preventDefault();
                      if (dragOverCol !== col) setDragOverCol(col);
                    }}
                    onDragLeave={() => { if (dragOverCol === col) setDragOverCol(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dragged = draggedColRef.current;
                      draggedColRef.current = null;
                      setDragOverCol(null);
                      if (dragged) moveColumn(dataCols, dragged, col, PAPER_COL);
                    }}
                    onDragEnd={() => { draggedColRef.current = null; setDragOverCol(null); }}
                    title={isPaperCol ? undefined : 'Drag to reorder'}
                    className={cn(
                      'sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 whitespace-nowrap select-none',
                      // Bounded, not just floored: the paper cell truncates, and
                      // without a ceiling the widest study name (a fallback that is
                      // the paper's full title) sets the column width and pushes
                      // every value column off-screen.
                      ci === 0 && 'sticky left-0 z-40 w-[220px] min-w-[220px] max-w-[220px]',
                      ci > 0 && 'min-w-[120px]',
                      !isPaperCol && 'cursor-grab active:cursor-grabbing hover:text-gray-600 dark:hover:text-zinc-300',
                      isDragOver && 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {formatColumnName(col)}
                      {/* `always`: a column header has nothing but its name, so
                          the type pill alone is worth the icon. */}
                      <FieldInfoTooltip field={field} side="bottom" always />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isNewPaper = paperBoundaries.has(ri);
              // First row of this paper's group — where identity is drawn.
              const isPaperStart = ri === 0 || isNewPaper;
              const isFlagged = !!flaggedDocIds?.has(row._documentId);
              return (
                <tr key={`${row._resultId}-${ri}`}>
                  {displayColumns.map((col, ci) => {
                    const val = row[col] ?? '';
                    const failed = isFailed(val);
                    const missing = !failed && isMissing(val);
                    const isFirstCol = ci === 0;

                    // A flat field's value covers the whole paper, so the transform
                    // repeats it on every exploded row and every row renders it.
                    const rawData = !isFirstCol
                      ? (row._rawCells?.[col] ?? resultDataMap[row._resultId]?.[col])
                      : null;
                    const sourceText = showEvidence ? getSourceText(rawData) : null;
                    // A drawn box or a figure is evidence with no quote in it.
                    const cellHasEvidence = showEvidence && hasEvidence(rawData);
                    const isActive = !!active && active.ri === ri && active.col === col;

                    // Who last put their hands on this cell. Read from the
                    // envelope the backend stamps on every human save — the
                    // richest provenance in the system, and until now the
                    // Results page displayed none of it.
                    const cellProv = !isFirstCol && showAuthors ? cellProvenance(rawData) : null;
                    const touch = cellProv && touchedByHuman(cellProv) ? latestTouch(cellProv) : null;
                    const author = touch?.userId ? personOf?.(touch.userId) ?? null : null;
                    const isHistoryOpen =
                      historyTarget?.resultId === row._resultId && historyTarget?.fieldName === col;

                    // What the compared run said in this cell. `undefined` means
                    // that run had no such cell (a paper it skipped, or fewer
                    // table rows) — which is not the same as a changed value, so
                    // it is not marked as one.
                    const before = isFirstCol || !baselineCells
                      ? undefined
                      : baselineCells[`${row._documentId}|${rowIndexInPaper[ri]}|${col}`];
                    // Compared through the app's canonical "same answer" key, not
                    // byte-for-byte: `compareKey` trims, lowercases and normalises
                    // numbers and booleans, so a re-run that returns "Need for…"
                    // where it used to say "need for…" is not reported as a change.
                    // Raw equality marked 16 cells on the live demo form, several
                    // of them capitalisation only. Same function the consensus
                    // screen uses to decide whether two reviewers agree.
                    const changedSinceRun =
                      before !== undefined && compareKey(before) !== compareKey(val);

                    return (
                      <td
                        key={col}
                        className={cn(
                          'px-3 py-2.5 border-b border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 align-top',
                          isFirstCol && 'sticky left-0 z-10 w-[220px] max-w-[220px] font-semibold text-gray-900 dark:text-white',
                          isFirstCol && (isFlagged ? 'bg-amber-50/40 dark:bg-[#151005]' : 'bg-white dark:bg-[#111111]'),
                          !isFirstCol && (failed
                            ? 'bg-amber-50 dark:bg-[#1a150d]'
                            : missing ? 'bg-rose-50 dark:bg-[#1a0d0d]' : 'bg-green-50 dark:bg-[#0d1a10]'),
                          // Monochrome on purpose: the three status colours are
                          // spoken for (reported / NR / failed), and "this moved
                          // between runs" is a different axis, not a fourth status.
                          changedSinceRun && 'border-l-2 border-l-gray-900 dark:border-l-zinc-300',
                          isNewPaper && 'border-t-2 border-t-gray-300 dark:border-t-zinc-600'
                        )}
                      >
                        {isFirstCol && row._extractionType === 'manual' && (() => {
                          // Which human produced this row. Without it, a paper
                          // extracted by more than two people shows several
                          // identical-looking rows — and an additional
                          // extraction is indistinguishable from an appointed
                          // reviewer's.
                          //
                          // Colours come from `lib/reviewerColors` now. They used
                          // to be hand-written here, which meant this chip and the
                          // seven other screens that colour a role read from two
                          // sources — and R2's move off green (green means
                          // "settled" everywhere else) had to be made twice.
                          // The assignment wins over the row's label: on the
                          // live calibration project 2 of one reviewer's 7 rows
                          // carry a stale NULL, which rendered an assigned R2 as
                          // "+" here while Allocations said R2.
                          const role = seatOf
                            ? seatOf(row._extractedBy, row._documentId, row._reviewerRole)
                            : (row._reviewerRole as string | null);
                          const def = isReviewRole(role) ? ROLE_COLORS[role] : null;
                          const rowAuthor = personOf?.(row._extractedBy) ?? null;
                          return (
                            <span className="mr-1.5 inline-flex items-center gap-1 align-middle">
                              {showAuthors && rowAuthor && (
                                <Avatar
                                  email={rowAuthor.avatarKey}
                                  name={rowAuthor.name}
                                  size="xs"
                                  className="h-[18px] w-[18px] text-[8px]"
                                />
                              )}
                              <span
                                className={cn(
                                  'inline-block rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                                  def
                                    ? def.pill
                                    : 'bg-gray-100 text-gray-500 dark:bg-zinc-700/40 dark:text-zinc-400',
                                )}
                                title={[
                                  def ? def.label : 'Additional extraction — not part of the R1/R2 comparison',
                                  rowAuthor?.name,
                                ].filter(Boolean).join(' · ')}
                              >
                                {def ? def.short : '+'}
                              </span>
                            </span>
                          );
                        })()}
                        {isFirstCol ? (
                          /* Identity, not data: the ref number and the badges live
                             here instead of in columns of their own. The badge row is
                             drawn once per paper — the transform repeats the name on
                             every exploded row, so repeating the badges would stutter
                             them down the whole group. Width stays bounded at 196px
                             (220px cell minus padding), or a fallback full-title study
                             name blows the column out again. */
                          <div className="flex max-w-[196px] flex-col gap-1.5">
                            <div className="flex min-w-0 items-baseline gap-1.5">
                              <span className="min-w-0 truncate" title={val}>{val}</span>
                              {!!row[REF_COL] && (
                                <span className="shrink-0 font-mono text-[10px] font-normal text-gray-300 dark:text-zinc-600">
                                  #{row[REF_COL]}
                                </span>
                              )}
                            </div>
                            {isPaperStart && (
                              <div className="flex flex-wrap items-center gap-1">
                                {showRowModelBadge && row._modelName && (
                                  <span
                                    title={row._modelName}
                                    className={cn(
                                      'shrink-0 rounded-full border-0 px-1.5 text-[9px] font-bold uppercase leading-[15px] tracking-wider',
                                      modelTagTheme(row._modelName),
                                    )}
                                  >
                                    {modelFamilyLabel(row._modelName)}
                                  </span>
                                )}
                                {row._extractionType === 'manual' && (
                                  <Badge variant="neutral" className="px-1.5 text-[9px] font-bold uppercase leading-[15px] tracking-wider">
                                    Manual
                                  </Badge>
                                )}
                                {isFlagged && (
                                  <Badge variant="attention" className="px-1.5 text-[9px] font-bold uppercase leading-[15px] tracking-wider">
                                    Flagged
                                  </Badge>
                                )}
                                <DocumentTags
                                  labels={documentsMap[row._documentId]?.labels}
                                  activeTags={activeTags}
                                  onToggleTag={onToggleTag}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          /* One wrapper for every value state, so the source chip
                             and the author avatar can sit beside any of them. A
                             reviewer edits NR cells too, and the old shape could
                             only decorate a reported value. */
                          <div className="flex flex-col gap-1">
                          <div className="flex items-start gap-1.5">
                            {failed ? (
                              <span
                                className="font-medium text-amber-600 dark:text-amber-500"
                                title="Extraction failed for this cell — not a statement about the paper"
                              >{val}</span>
                            ) : missing ? (
                              // `val` is already the label (NR or NA) — never hardcode
                              // one, or an inapplicable cell reads as a reporting gap.
                              <span className="font-medium text-gray-400 dark:text-zinc-600">{val || 'NR'}</span>
                            ) : (
                              <span className="text-gray-700 dark:text-zinc-300">{val}</span>
                            )}
                            {!failed && !missing && cellHasEvidence && (
                              <button
                                type="button"
                                onClick={() => setActive({ ri, col })}
                                title="View source passage"
                                aria-pressed={isActive}
                                className={cn(
                                  'flex-none inline-flex items-center justify-center p-0.5 rounded transition-all',
                                  isActive
                                    ? 'bg-green-500 text-white shadow-[0_0_0_3px_rgba(16,128,106,0.18)] dark:bg-green-400 dark:text-[#0a0a0a]'
                                    : 'text-green-500 hover:bg-green-50 hover:-translate-y-px dark:text-green-400 dark:hover:bg-green-900/30',
                                )}
                              >
                                <Quote className="w-3 h-3" />
                              </button>
                            )}
                            {author && (
                              <button
                                type="button"
                                onClick={() => setHistoryTarget({
                                  resultId: row._resultId,
                                  documentId: row._documentId,
                                  paperLabel: docLabels[row._documentId]
                                    ?? documentLabel(documentsMap[row._documentId]),
                                  fieldName: col,
                                  fieldLabel: formatColumnName(col),
                                  raw: rawData,
                                  displayValue: val,
                                })}
                                aria-pressed={isHistoryOpen}
                                title={`${author.name} — ${cellProv?.origin === 'human_confirmed'
                                  ? 'confirmed this value'
                                  : cellProv?.origin === 'human_edited'
                                    ? 'changed this value'
                                    : 'entered this value'}. Click for its history.`}
                                className={cn(
                                  'flex-none rounded-full transition-all hover:-translate-y-px',
                                  isHistoryOpen && 'ring-2 ring-gray-900 dark:ring-zinc-100',
                                )}
                              >
                                <Avatar
                                  email={author.avatarKey}
                                  name={author.name}
                                  size="xs"
                                  className="h-[18px] w-[18px] text-[8px]"
                                />
                              </button>
                            )}
                          </div>
                          {/* The previous value goes UNDERNEATH, wrapped and
                              clamped. Inline it was a single-line flex item with
                              nothing to shrink it, so a long prior answer smeared
                              across four neighbouring columns — the same class of
                              overflow as an unbounded `truncate` in a table cell. */}
                          {changedSinceRun && (
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({
                                resultId: row._resultId,
                                documentId: row._documentId,
                                paperLabel: docLabels[row._documentId]
                                  ?? documentLabel(documentsMap[row._documentId]),
                                fieldName: col,
                                fieldLabel: formatColumnName(col),
                                raw: rawData,
                                displayValue: val,
                                runHistory: runHistoryFor?.(
                                  row._documentId, rowIndexInPaper[ri], col,
                                ),
                              })}
                              aria-pressed={isHistoryOpen}
                              title="Changed since the compared run. Click for this cell across every run."
                              className={cn(
                                'block w-full max-w-full break-words rounded px-1 py-0.5 text-left text-[10px] leading-snug line-clamp-2 transition-colors',
                                'bg-gray-900/5 text-gray-500 line-through hover:bg-gray-900/10',
                                'dark:bg-white/10 dark:text-zinc-400 dark:hover:bg-white/20',
                                isHistoryOpen && 'ring-1 ring-gray-900 dark:ring-zinc-100',
                              )}
                            >
                              {before === '' ? '—' : before}
                            </button>
                          )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      </div>

      <SourceEvidenceDrawer
        open={!!active && !!activeData}
        onClose={() => setActive(null)}
        documentId={activeData?.documentId ?? null}
        documentFilename={activeData?.documentFilename ?? null}
        sourceText={activeData?.sourceText ?? null}
        boxes={activeData?.boxes ?? null}
        storedValue={activeData?.storedValue ?? null}
        fieldLabel={activeData?.fieldLabel}
        page={activeData?.page ?? null}
        hasPdf={activeData?.hasPdf ?? true}
        sourceType={activeData?.sourceType ?? null}
        recordId={activeData?.recordId ?? null}
        doi={activeData?.doi ?? null}
        syntheticCaption={activeData?.syntheticCaption ?? false}
        captionImage={activeData?.captionImage ?? null}
        fromFigure={activeData?.fromFigure ?? false}
        figureImage={activeData?.figureImage ?? null}
        figureVerified={activeData?.figureVerified ?? null}
        onPrev={goPrev}
        onNext={goNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      {/* Not gated on `canAttribute`: on the AI tab there is no author to name,
          but a cell still has a run history, and that is reached from here. */}
      <CellHistoryPanel
        target={historyTarget}
        projectId={projectId}
        personOf={personOf}
        seatOf={seatOf}
        onClose={() => setHistoryTarget(null)}
      />
    </>
  );
}
