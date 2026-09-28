'use client';

/**
 * The consensus workspace: Compare results → Resolve differences → Review & save.
 *
 * Built from the "Consensus v2" design handoff (eviStreams Consensus handoff/)
 * and CONSENSUS_METHODOLOGY_HANDOFF_CLAUDE_CODE.md, in EviStream's own visual
 * language (white rounded-xl cards, gray-900 primary, source colours only as
 * accents — see lib/reviewerColors).
 *
 *  1. Compare results — a home screen of three categories, each a deck of
 *     cards: possible matches, results found by only some sources, possible
 *     duplicates. Every card shows the COMPLETE source rows. "Find a matching
 *     row" opens in place, keeps the current row pinned, ranks candidates
 *     (existing groups included) and remembers "not the same" with Reconsider.
 *  2. Resolve differences — one card per final result: Field | sources | Final.
 *     Agreeing values fill Final by themselves; each differing value is picked
 *     by clicking it or typed with the column's own editor. Single-value fields
 *     form one "Study details" card.
 *  3. Review & save — the final tables, what was set aside (with Restore), save.
 *
 * Two deliberate departures from the v2 canvas, both from the methodology doc
 * and the owner's review: Final is never pre-filled with the majority (the
 * agreement is shown as a hint), and there are no single-key shortcuts (this
 * page removed them on purpose; see the note in page.tsx).
 *
 * Compare decisions apply at once (and autosave to the draft); a toast offers
 * Undo, and every decision stays listed and reversible under "Decisions made".
 * Resolve picks are a draft until "Save result & next". The model is
 * `_lib/entities.ts`.
 */

import { cn } from '@/lib/utils';
import { compareKey, displayLabel } from '@/lib/absence';
import { sourceColors, STATE_COLORS } from '@/lib/reviewerColors';
import type { FormField } from '@/types/api';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Download, PanelLeftClose, PanelLeftOpen, Quote, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FieldRenderer } from '../../manual-extraction/_components/FieldRenderer';
import { differingColumns, SOURCE_ORDER, type AlignedRecord, type SourceKey } from '../_lib/alignRows';
import {
  acceptProposal,
  clearDuplicate,
  clearInclude,
  duplicateCandidates,
  EXCLUDE_REASON_LABEL,
  EXCLUDE_REASONS,
  isIncluded,
  markDuplicate,
  markNotDuplicate,
  matchCandidates,
  pairRecords,
  previewCells,
  reconsiderMatch,
  refsOf,
  rejectMatch,
  rejectProposal,
  setCellPick,
  setExclude,
  setInclude,
  setResultNote,
  unpairRecord,
  type CellPick,
  type DuplicateSuggestion,
  type Entity,
  type ExcludeReason,
  type MatchProposal,
  type TableConsensusState,
  type TableModel,
} from '../_lib/entities';
import { cellMeta, cellValue, hasJumpableEvidence, type EvidenceMeta } from './UnifiedFieldCard';

export type ConsensusStage = 'align' | 'resolve' | 'final';

export interface TableItem {
  field: FormField;
  model: TableModel;
  state: TableConsensusState;
}

/** One single-value field, as the Study details card needs it. */
export interface ScalarRow {
  idx: number;
  label: string;
  field?: FormField;
  /** The stored cell per source that has an extraction for this paper. */
  cells: Partial<Record<SourceKey, any>>;
  /** Every source gave the same value (blank counts as a value). */
  agreed: boolean;
  decision: string | null;
  customValue: any;
  /** A table field nobody gave rows for — picked, never typed. */
  isTable: boolean;
}

export interface ScalarChange {
  idx: number;
  decision: string;
  customValue?: any;
}

export interface ConsensusWorkspaceProps {
  stage: ConsensusStage;
  onStage: (s: ConsensusStage) => void;
  tables: TableItem[];
  onTableState: (fieldName: string, next: TableConsensusState) => void;
  /** Sources that have an extraction of this paper at all. */
  scalarSources: SourceKey[];
  scalars: ScalarRow[];
  commitScalars: (changes: ScalarChange[]) => void;
  onJump: (source: SourceKey, meta: EvidenceMeta, label: string, value: any) => void;
  onFinalize: () => void;
  submitting: boolean;
  isUpdate: boolean;
  onExportCsv: () => void;
  paperHidden: boolean;
  onTogglePaper: () => void;
}

// ─── Tokens (EviStream: monochrome first, colour carries meaning) ─────────────

const CARD = 'rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]';
const ML = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500';
const BTN = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const BTN_PRIMARY = cn(BTN, 'border-gray-900 bg-gray-900 text-white hover:bg-gray-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white');
const BTN_SOFT = cn(BTN, 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]');
const BTN_WARN = cn(BTN, 'border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-[#111111] dark:text-red-300 dark:hover:bg-red-950/30');
const LINK = 'inline-flex min-h-[36px] items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300';
const PILL = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold';
const PILL_MUTED = cn(PILL, 'border-gray-200 bg-white text-gray-600 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-400');
const PILL_GREEN = cn(PILL, 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300');
const PILL_AMBER = cn(PILL, 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300');
const SOURCE_RANK: Record<SourceKey, number> = { r1: 0, r2: 1, ai: 2 };
const bySource = (a: SourceKey, b: SourceKey) => SOURCE_RANK[a] - SOURCE_RANK[b];

// ─── Small helpers ────────────────────────────────────────────────────────────

function colLabel(field: FormField, name: string): string {
  const c = (field.subform_fields ?? []).find(x => x.field_name === name);
  return (c?.display_name || name).replace(/_/g, ' ');
}
function fieldLabel(field: FormField): string {
  return (field.display_name || field.field_name).replace(/_/g, ' ');
}
/**
 * What a cell says, the way the comparison reads it. A status wins over the
 * raw text — the same rule every results surface uses (`displayLabel`) — so an
 * AI cell stored as "NA" with status not_reported shows as NR. Otherwise the
 * screen would mark "NA" vs "NA" as a difference with no visible reason.
 */
function show(cell: any): string {
  const label = displayLabel(cell);
  if (label) return label;
  const v = cellValue(cell).trim();
  return v || '—';
}
const isNumeric = (s: string) => /^-?\d+(\.\d+)?%?$/.test(s.trim());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const srcLabel = (s: SourceKey) => (s === 'ai' ? 'AI extraction' : sourceColors(s).label);
const joinNames = (ss: SourceKey[]) => [...ss].sort(bySource).map(srcLabel).join(' and ');
const blank = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * Identifying columns worth putting in a title: the key, in the table's own
 * column order, minus any column every row of the table shares (a population
 * type that is the same on all 36 rows tells the reviewer nothing).
 */
const titleColsCache = new WeakMap<TableModel, string[]>();
function titleCols(model: TableModel): string[] {
  const hit = titleColsCache.get(model);
  if (hit) return hit;
  const order = new Map(model.cols.map((c, i) => [c.field_name, i]));
  const rows = model.entities.flatMap(e => refsOf(e.rec).map(r => r.row));
  const cols = [...model.idCols]
    .sort((a, b) => (order.get(a.field_name) ?? 0) - (order.get(b.field_name) ?? 0))
    .filter(c => rows.length < 2 || new Set(rows.map(r => compareKey(r?.[c.field_name], c.options))).size > 1)
    .map(c => c.field_name);
  const out = cols.length ? cols : model.idCols.map(c => c.field_name);
  titleColsCache.set(model, out);
  return out;
}

/** "Naproxen 440 mg · SPID · 6 h · Mean" — the identity of a result, as a title. */
function fingerprint(rec: AlignedRecord, t: TableItem): string {
  const first = refsOf(rec).sort((a, b) => bySource(a.source, b.source))[0]?.row;
  const parts = titleCols(t.model)
    .map(c => show(first?.[c]))
    .filter(v => !['NR', 'NA', '—'].includes(v))
    .map(v => (v.length > 36 ? `${v.slice(0, 34)}…` : v));
  return parts.slice(0, 4).join(' · ') || 'Row without a label';
}

function SourceBadge({ s, label, row }: { s: SourceKey; label?: string; row?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold', sourceColors(s).pill)}>
      {label ?? sourceColors(s).short}
      {row != null && <span className="font-normal opacity-70">row {row}</span>}
    </span>
  );
}

// ─── Full-row comparison table (reused by every Compare card) ─────────────────

interface TableCol {
  key: string;
  src: SourceKey;
  label: string;
  row: any;
  rowIndex?: number;
}

/**
 * Every field of every row, side by side. With `collapse`, a field on which
 * all columns agree is shown once across them; differing fields are tinted and
 * marked ≠ (colour is never the only signal). NR stays "NR"; blank is "—".
 */
function FullRowTable({ t, cols, collapse = true, onJump }: {
  t: TableItem; cols: TableCol[]; collapse?: boolean;
  onJump: ConsensusWorkspaceProps['onJump'];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-[#1f1f1f]">
      <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-[22%] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold text-gray-500 dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-400">Field</th>
            {cols.map(c => (
              <th key={c.key} className={cn('border-b border-l border-gray-200 px-3 py-2 text-left text-[11px] font-semibold dark:border-[#1f1f1f]', sourceColors(c.src).bg, sourceColors(c.src).text)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  {c.rowIndex != null && <span className="flex-shrink-0 font-normal opacity-70">row {c.rowIndex + 1}</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.model.cols.map(col => {
            const cells = cols.map(c => c.row?.[col.field_name]);
            const keys = cells.map(x => compareKey(x, col.options) ?? '\u0000fail');
            const diff = new Set(keys).size > 1;
            const label = colLabel(t.field, col.field_name);
            if (!diff && collapse && cols.length > 1) {
              const v = show(cells[0]);
              return (
                <tr key={col.field_name} className="border-b border-gray-100 last:border-b-0 dark:border-[#1a1a1a]">
                  <th scope="row" className="bg-gray-50/60 px-3 py-2 text-left align-top text-[12px] font-medium text-gray-500 dark:bg-[#0d0d0d] dark:text-zinc-400">{label}</th>
                  <td colSpan={cols.length} className={cn('border-l border-gray-100 px-3 py-2 align-top dark:border-[#1a1a1a]', v === '—' ? 'text-gray-300 dark:text-zinc-600' : 'text-gray-600 dark:text-zinc-300', isNumeric(v) && 'tabular-nums')}>
                    <span className="break-words">{v}</span>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={col.field_name} className={cn('border-b border-gray-100 last:border-b-0 dark:border-[#1a1a1a]', diff && 'bg-amber-50/60 dark:bg-amber-950/15')}>
                <th scope="row" className={cn('px-3 py-2 text-left align-top text-[12px]', diff ? 'bg-amber-50 font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-gray-50/60 font-medium text-gray-500 dark:bg-[#0d0d0d] dark:text-zinc-400')}>
                  {label}{diff && <span className="ml-1" aria-label="differs">≠</span>}
                </th>
                {cols.map((c, i) => (
                  <ValueCell key={c.key} cell={cells[i]} emphasize={diff} onJump={() => {
                    const meta = cellMeta(cells[i]);
                    if (meta) onJump(c.src, meta, `${label}${c.rowIndex != null ? ` · row ${c.rowIndex + 1}` : ''}`, cellValue(cells[i]));
                  }} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ValueCell({ cell, emphasize, onJump }: { cell: any; emphasize: boolean; onJump: () => void }) {
  const v = show(cell);
  const meta = cellMeta(cell);
  return (
    <td className={cn('border-l border-gray-100 px-3 py-2 align-top dark:border-[#1a1a1a]', v === '—' ? 'text-gray-300 dark:text-zinc-600' : emphasize ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-zinc-300', isNumeric(v) && 'tabular-nums')}>
      <span className="break-words">{v}</span>
      {hasJumpableEvidence(meta) && <EvidenceIcon onClick={onJump} page={meta!.page} />}
    </td>
  );
}

/** A cell's own evidence: jumps the paper to that value's quote / page. */
function EvidenceIcon({ onClick, page, showPage }: { onClick: () => void; page?: number; showPage?: boolean }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={page ? `Show the evidence on page ${page}` : 'Show the evidence in the paper'}
      aria-label={page ? `Show evidence, page ${page}` : 'Show evidence in the paper'}
      className="ml-1.5 inline-flex h-6 min-w-[24px] items-center justify-center gap-0.5 rounded px-1 align-middle text-[10.5px] font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-500 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-200"
    >
      <Quote className="h-3 w-3" />
      {showPage && page ? <span>p.{page}</span> : null}
    </button>
  );
}

// ─── Card chrome ──────────────────────────────────────────────────────────────

function DeckCard({ eyebrow, question, sub, meta, title, tableName, children, legend, actions, back }: {
  eyebrow: string; question: string; sub: string; meta?: string; title?: string; tableName?: string;
  children: ReactNode; legend?: ReactNode; actions: ReactNode; back?: ReactNode;
}) {
  return (
    <article className={CARD}>
      <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          {back}
          <div className={ML}>{eyebrow}</div>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{question}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{sub}</p>
        </div>
        {meta && <span className="flex-shrink-0 pt-1 text-xs text-gray-400 dark:text-zinc-500" title="How alike the identifying columns are — supporting context only.">{meta}</span>}
      </header>
      {title && (
        <div className="flex flex-wrap items-center gap-2 border-y border-gray-100 bg-gray-50/70 px-5 py-2.5 dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
          <span className="text-sm font-semibold text-gray-800 dark:text-zinc-100">{title}</span>
          {tableName && <span className={PILL_MUTED}>{tableName}</span>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
      {legend && <div className="px-5 pb-3 text-xs text-gray-400 dark:text-zinc-500">{legend}</div>}
      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-gray-100 bg-white/95 px-5 py-3.5 dark:border-[#1f1f1f] dark:bg-[#111111]/95">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </footer>
    </article>
  );
}

function DeckBar({ backLabel, onBack, label, done, total, onSkip }: {
  backLabel: string; onBack: () => void; label: string; done: number; total: number; onSkip?: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className={LINK}><ArrowLeft className="h-3.5 w-3.5" /> {backLabel}</button>
        <span className="text-sm font-semibold text-gray-800 dark:text-zinc-200">{label}</span>
      </div>
      <div className="flex min-w-[220px] flex-1 items-center justify-end gap-3 sm:flex-none">
        <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-gray-100 dark:bg-[#1f1f1f]">
          <div className="h-full rounded-full bg-gray-900 transition-[width] duration-300 dark:bg-zinc-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-zinc-400">{Math.min(done + 1, total)} of {total}</span>
        {onSkip && <button type="button" onClick={onSkip} className="min-h-[32px] whitespace-nowrap text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200">Skip →</button>}
      </div>
    </div>
  );
}

function PageTitle({ title, sub, pill }: { title: string; sub: string; pill?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{sub}</p>
      </div>
      {pill}
    </div>
  );
}

function CategoryCard({ title, count, desc, cta, status, complete, suggested, onOpen }: {
  title: string; count: number; desc: string; cta: string; status: string;
  complete: boolean; suggested: boolean; onOpen: () => void;
}) {
  return (
    <article className={cn(
      'flex min-h-[200px] flex-col rounded-xl border p-5 transition-colors',
      complete ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/15'
        : suggested ? 'border-gray-900 bg-white dark:border-zinc-300 dark:bg-[#111111]'
          : 'border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]',
    )}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">{title}</h3>
        <span className={cn('whitespace-nowrap pt-0.5 text-[11px] font-semibold', complete ? STATE_COLORS.resolved.text : suggested ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-500')}>{status}</span>
      </div>
      <div className={cn('mb-1 mt-3 text-3xl font-bold tabular-nums tracking-tight', complete ? STATE_COLORS.resolved.text : 'text-gray-900 dark:text-white')}>
        {complete ? <Check className="h-8 w-8" strokeWidth={2.5} aria-label="complete" /> : count}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">{desc}</p>
      <button type="button" onClick={onOpen} disabled={complete} className={cn(suggested && !complete ? BTN_PRIMARY : BTN_SOFT, 'mt-auto w-full')}>
        {complete ? 'Complete' : cta} {!complete && <ArrowRight className="h-4 w-4" />}
      </button>
    </article>
  );
}

// ─── Toast with Undo ──────────────────────────────────────────────────────────

interface ToastState { msg: string; undo?: () => void; id: number }

function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, toast.undo ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-24 right-5 z-50">
      {toast && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-gray-900">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button type="button" onClick={() => { toast.undo!(); onClose(); }} className="font-semibold text-blue-300 hover:text-blue-200 dark:text-blue-700">Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ stage, onStage, meta, done }: {
  stage: ConsensusStage; onStage: (s: ConsensusStage) => void;
  meta: Record<ConsensusStage, string>; done: Record<ConsensusStage, boolean>;
}) {
  const steps: Array<{ key: ConsensusStage; label: string }> = [
    { key: 'align', label: 'Compare results' },
    { key: 'resolve', label: 'Resolve differences' },
    { key: 'final', label: 'Review & save' },
  ];
  return (
    <nav aria-label="Consensus steps" className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-1 sm:flex-row dark:border-[#1f1f1f] dark:bg-[#111111]">
      {steps.map((s, i) => {
        const active = s.key === stage;
        const complete = done[s.key] && !active;
        return (
          <button
            key={s.key}
            type="button"
            aria-current={active ? 'step' : undefined}
            onClick={() => onStage(s.key)}
            className={cn(
              'flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[13.5px] font-semibold transition-colors',
              active ? 'bg-gray-900 text-white dark:bg-zinc-100 dark:text-gray-900'
                : complete ? 'text-emerald-700 hover:bg-emerald-50/60 dark:text-emerald-300 dark:hover:bg-emerald-950/20'
                  : 'text-gray-500 hover:bg-gray-50 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
            )}
          >
            <span className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
              active ? 'bg-white/20 text-white dark:bg-gray-900/15 dark:text-gray-900' : complete ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-[#1f1f1f] dark:text-zinc-400',
            )}>
              {complete ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            {s.label}
            {meta[s.key] && <span className="text-[11px] font-semibold opacity-75">{meta[s.key]}</span>}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Compare results: items ───────────────────────────────────────────────────

type Category = 'matches' | 'single' | 'duplicate';

type CompareItem =
  | { cat: 'matches'; key: string; t: TableItem; p: MatchProposal }
  | { cat: 'single'; key: string; t: TableItem; e: Entity }
  | { cat: 'duplicate'; key: string; t: TableItem; d: DuplicateSuggestion };

/** Is this result still waiting for keep / leave out? */
function awaitingInclude(e: Entity, t: TableItem): boolean {
  return e.askInclude && !(e.rec.id in t.state.include) && !t.state.legacyPick;
}

function pendingItems(tables: TableItem[]): Record<Category, CompareItem[]> {
  const out: Record<Category, CompareItem[]> = { matches: [], single: [], duplicate: [] };
  for (const t of tables) {
    for (const p of t.model.proposals) out.matches.push({ cat: 'matches', key: `${t.field.field_name}:${p.id}`, t, p });
    const inProposal = new Set(t.model.proposals.flatMap(p => [p.a.id, p.b?.id]));
    for (const e of t.model.entities) {
      if (inProposal.has(e.rec.id) || !awaitingInclude(e, t)) continue;
      out.single.push({ cat: 'single', key: `${t.field.field_name}:${e.rec.id}`, t, e });
    }
    for (const d of t.model.duplicateSuggestions) out.duplicate.push({ cat: 'duplicate', key: `${t.field.field_name}:${d.id}`, t, d });
  }
  return out;
}

const CATEGORY: Record<Category, { title: string; desc: string; cta: string }> = {
  matches: { title: 'Possible matches', desc: 'Rows from different sources may describe the same result.', cta: 'Review matches' },
  single: { title: 'Found by one source', desc: 'No matching row has been confirmed yet. Find a match, keep it, or leave it out.', cta: 'Review source-only results' },
  duplicate: { title: 'Possible duplicates', desc: 'Two rows from the same source may represent the same extraction.', cta: 'Review duplicates' },
};

// ─── Screen 1: Compare results ────────────────────────────────────────────────

interface FindState { field: string; recId: string; candId: string | null; showOthers: boolean; reviewedOpen: boolean }

type Notify = (msg: string, undo?: () => void) => void;

function CompareScreen(props: ConsensusWorkspaceProps & { pending: Record<Category, CompareItem[]>; progress: Record<Category, { done: number; total: number }>; notify: Notify }) {
  const { tables, onTableState, onJump, onStage, pending, progress, notify } = props;
  const [view, setView] = useState<'home' | Category>('home');
  const [idx, setIdx] = useState<Record<Category, number>>({ matches: 0, single: 0, duplicate: 0 });
  const [lastCategory, setLastCategory] = useState<Category | null>(null);
  const [find, setFind] = useState<FindState | null>(null);
  const [excluding, setExcluding] = useState(false);
  const [dupPicking, setDupPicking] = useState(false);

  const remaining = pending.matches.length + pending.single.length + pending.duplicate.length;
  const suggested = (['matches', 'single', 'duplicate'] as Category[]).find(c => pending[c].length > 0) ?? null;

  const apply = (t: TableItem, next: TableConsensusState, msg: string) => {
    const prev = t.state;
    onTableState(t.field.field_name, next);
    notify(msg, () => onTableState(t.field.field_name, prev));
    setExcluding(false);
    setDupPicking(false);
  };
  const open = (c: Category) => { setView(c); setLastCategory(c); setFind(null); setExcluding(false); setDupPicking(false); };

  // A category emptied by the last decision: back to the home screen, which
  // points at the next unfinished category — never an automatic jump into it.
  useEffect(() => {
    if (view !== 'home' && !find && pending[view].length === 0) {
      setView('home');
      notify(`${CATEGORY[view].title} · complete`);
    }
  }, [view, find, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tables.length) {
    return (
      <div className={cn(CARD, 'p-6')}>
        <PageTitle title="Compare results" sub="This paper has no table rows to compare — every answer is a single value." />
        <button type="button" onClick={() => onStage('resolve')} className={BTN_PRIMARY}>Resolve differences <ArrowRight className="h-4 w-4" /></button>
      </div>
    );
  }

  // ── Find a matching row (in place of the deck) ──
  if (find) {
    const t = tables.find(x => x.field.field_name === find.field);
    const e = t?.model.entities.find(x => x.rec.id === find.recId);
    if (t && e) return <FindMatch t={t} e={e} find={find} setFind={setFind} onTableState={onTableState} onJump={onJump} apply={apply} notify={notify} />;
  }

  // ── Home ──
  if (view === 'home') {
    const counts = tables.length === 1
      ? SOURCE_ORDER.filter(s => tables[0].model.rowCounts[s] != null || tables[0].model.absentSources[s]).sort(bySource).map(s => (
        <span key={s} className={cn(PILL, 'border-transparent', sourceColors(s).pill)}>
          {sourceColors(s).label} · {tables[0].model.absentSources[s] ? 'table not reported' : plural(tables[0].model.rowCounts[s]!, 'row')}
        </span>
      ))
      : tables.map(t => (
        <span key={t.field.field_name} className={PILL_MUTED}>
          {fieldLabel(t.field)}: {SOURCE_ORDER.filter(s => t.model.rowCounts[s] != null).sort(bySource).map(s => `${sourceColors(s).short} ${t.model.rowCounts[s]}`).join(' · ')}
        </span>
      ));
    const singleTitle = pending.single.some(i => i.cat === 'single' && refsOf(i.e.rec).length > 1) ? 'Found by some sources' : CATEGORY.single.title;
    return (
      <div>
        <PageTitle
          title="Compare results"
          sub="Pick a category and clear one kind of decision at a time. Any order works."
          pill={<span className={remaining ? PILL_MUTED : PILL_GREEN}>{remaining ? `${plural(remaining, 'decision')} remaining` : 'All decisions made'}</span>}
        />
        <div className="mb-4 flex flex-wrap gap-2">{counts}</div>
        <div className="grid gap-3 md:grid-cols-3">
          {(['matches', 'single', 'duplicate'] as Category[]).map(c => {
            const n = pending[c].length;
            const { done, total } = progress[c];
            return (
              <CategoryCard
                key={c}
                title={c === 'single' ? singleTitle : CATEGORY[c].title}
                count={n}
                desc={CATEGORY[c].desc}
                cta={CATEGORY[c].cta}
                status={n === 0 ? (total ? 'Complete' : 'None found') : c === suggested ? 'Up next' : `${done} of ${total} done`}
                complete={n === 0}
                suggested={c === suggested}
                onOpen={() => open(c)}
              />
            );
          })}
        </div>
        {lastCategory && lastCategory !== suggested && pending[lastCategory].length > 0 && (
          <div className={cn(CARD, 'mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">Continue where you left off</div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">Last opened: {CATEGORY[lastCategory].title}</div>
            </div>
            <button type="button" onClick={() => open(lastCategory)} className={BTN_SOFT}>Continue review <ArrowRight className="h-4 w-4" /></button>
          </div>
        )}
        {remaining === 0 && (
          <div className={cn(CARD, 'mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
            <span className="text-sm text-gray-600 dark:text-zinc-300">Every comparison has a decision. The results are ready to resolve.</span>
            <button type="button" onClick={() => onStage('resolve')} className={BTN_PRIMARY}>Resolve differences <ArrowRight className="h-4 w-4" /></button>
          </div>
        )}
        <DecisionsMade tables={tables} onTableState={onTableState} notify={notify} />
      </div>
    );
  }

  // ── Deck ──
  const list = pending[view];
  const i = Math.min(idx[view], Math.max(0, list.length - 1));
  const item = list[i];
  const skip = list.length > 1 ? () => { setIdx(p => ({ ...p, [view]: (i + 1) % list.length })); setExcluding(false); setDupPicking(false); } : undefined;
  const bar = <DeckBar backLabel="Compare home" onBack={() => setView('home')} label={CATEGORY[view].title} done={progress[view].done} total={progress[view].total} onSkip={skip} />;
  if (!item) return <div>{bar}</div>;
  const tableName = tables.length > 1 ? fieldLabel(item.t.field) : undefined;

  if (item.cat === 'matches') {
    const { t, p } = item;
    const refs = [...refsOf(p.a), ...(p.b ? refsOf(p.b) : [])].sort((a, b) => bySource(a.source, b.source));
    const cols: TableCol[] = refs.map(r => ({ key: r.source, src: r.source, label: srcLabel(r.source), row: r.row, rowIndex: r.rowIndex }));
    return (
      <div>
        {bar}
        <DeckCard
          key={item.key}
          eyebrow={p.kind === 'positional' ? 'Lined up by order' : 'Possible match'}
          question="Are these the same result?"
          sub={p.kind === 'positional'
            ? `This table has no identifying columns, so these ${refs.length} rows were lined up by their order and need your confirmation. Every extracted field is shown; rows marked ≠ differ.`
            : `${plural(refs.length, 'source')} · every extracted field is shown; rows marked ≠ differ.`}
          meta={p.confidence != null ? `${Math.round(p.confidence * 100)}% similar` : undefined}
          title={fingerprint(p.a, t)}
          tableName={tableName}
          legend="Agreeing fields are shown once across all sources. ≠ marks a field where at least one source differs."
          actions={<>
            <button type="button" onClick={() => apply(t, rejectProposal(t.state, p), 'Recorded as separate results')} className={BTN_SOFT}>No — separate results</button>
            <button type="button" onClick={() => apply(t, acceptProposal(t.state, p), 'Matched into one result')} className={BTN_PRIMARY}>Yes — same result <ArrowRight className="h-4 w-4" /></button>
          </>}
        >
          <FullRowTable t={t} cols={cols} onJump={onJump} />
        </DeckCard>
      </div>
    );
  }

  if (item.cat === 'single') {
    const { t, e } = item;
    const refs = refsOf(e.rec).sort((a, b) => bySource(a.source, b.source));
    const who = refs.map(r => r.source);
    const cols: TableCol[] = refs.map(r => ({ key: r.source, src: r.source, label: srcLabel(r.source), row: r.row, rowIndex: r.rowIndex }));
    const dupCands = duplicateCandidates(t.model, e.rec);
    const alone = t.model.present.length + Object.keys(t.model.absentSources).length <= 1;
    const sig = [...who].sort().join();
    const others = pending.single.filter((x): x is Extract<CompareItem, { cat: 'single' }> =>
      x.cat === 'single' && x.t === t && x.key !== item.key && refsOf(x.e.rec).map(r => r.source).sort().join() === sig);
    return (
      <div>
        {bar}
        <DeckCard
          key={item.key}
          eyebrow={`Found by ${joinNames(who)} only`}
          question={who.length === 1 ? `Only ${srcLabel(who[0])} extracted this result.` : `${joinNames(who)} extracted this result; ${joinNames(e.missing)} did not.`}
          sub={alone
            ? 'Only one source extracted this table, so nothing corroborates it. Check it against the paper, then keep it or leave it out.'
            : 'That does not make it wrong. Find the row the other sources may have entered differently, keep it on its own, or leave it out.'}
          title={fingerprint(e.rec, t)}
          tableName={tableName}
          legend={who.length > 1
            ? <span className={cn('inline-flex items-center gap-1', STATE_COLORS.resolved.text)}><Check className="h-3.5 w-3.5" /> Supporting evidence: {joinNames(who)} both reported this result. You still decide.</span>
            : 'Complete source row. Missing sources are not treated as blank disagreements.'}
          actions={excluding ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-zinc-400">Why leave it out?</span>
              {EXCLUDE_REASONS.map(r => (
                <button key={r} type="button" onClick={() => apply(t, setExclude(t.state, e.rec.id, r), `Left out · ${EXCLUDE_REASON_LABEL[r].toLowerCase()}`)} className={BTN_SOFT}>{EXCLUDE_REASON_LABEL[r]}</button>
              ))}
              {dupCands.length > 0 && <button type="button" onClick={() => { setExcluding(false); setDupPicking(true); }} className={BTN_SOFT}>Duplicate…</button>}
              <button type="button" onClick={() => setExcluding(false)} className="min-h-[40px] px-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400">Cancel</button>
            </div>
          ) : (<>
            <button type="button" onClick={() => setExcluding(true)} className={BTN_WARN}>Do not include</button>
            {!alone && <button type="button" onClick={() => setFind({ field: t.field.field_name, recId: e.rec.id, candId: null, showOthers: false, reviewedOpen: false })} className={BTN_SOFT}>Find a matching row</button>}
            <button type="button" onClick={() => apply(t, setInclude(t.state, e.rec.id, true), 'Kept as its own result')} className={BTN_PRIMARY}>Keep as its own result <ArrowRight className="h-4 w-4" /></button>
          </>)}
        >
          <FullRowTable t={t} cols={cols} collapse={false} onJump={onJump} />
          {dupPicking && (
            <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-gray-200 p-3 dark:border-[#2a2a2a]">
              <p className="text-xs text-gray-500 dark:text-zinc-400">Which result does this row repeat? That one is kept; this row stays in the provenance as an excluded duplicate. Nothing is deleted.</p>
              {dupCands.map(o => (
                <button key={o.id} type="button" onClick={() => apply(t, markDuplicate(t.state, e.rec, o), 'Marked as duplicate')} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg border border-gray-100 px-3 text-left text-sm hover:border-gray-300 dark:border-[#1f1f1f] dark:hover:border-[#3f3f3f]">
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-zinc-300">{fingerprint(o, t)}</span>
                  <span className="flex gap-1">{refsOf(o).map(r => <SourceBadge key={r.source} s={r.source} row={r.rowIndex + 1} />)}</span>
                </button>
              ))}
              <button type="button" onClick={() => setDupPicking(false)} className="min-h-[32px] text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400">Cancel</button>
            </div>
          )}
          {others.length >= 2 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-zinc-400">
              {plural(others.length, 'more result')} found by {joinNames(who)} only.{' '}
              <button type="button" onClick={() => {
                let s = setInclude(t.state, e.rec.id, true);
                for (const o of others) s = setInclude(s, o.e.rec.id, true);
                apply(t, s, `Kept ${others.length + 1} results`);
              }} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">Keep all {others.length + 1}</button>
            </p>
          )}
        </DeckCard>
      </div>
    );
  }

  const { t, d } = item;
  const keepRef = d.keep.members[d.source]!;
  const repRef = d.repeat.members[d.source]!;
  const cols: TableCol[] = [
    { key: 'a', src: d.source, label: `${srcLabel(d.source)} · row ${keepRef.rowIndex + 1}`, row: keepRef.row },
    { key: 'b', src: d.source, label: `${srcLabel(d.source)} · row ${repRef.rowIndex + 1}`, row: repRef.row },
  ];
  return (
    <div>
      {bar}
      <DeckCard
        key={item.key}
        eyebrow="Possible duplicate"
        question={`Did ${srcLabel(d.source)} enter the same result twice?`}
        sub="Same-source rows compared in full. Marking a duplicate never deletes it."
        meta={`${Math.round(d.confidence * 100)}% similar`}
        title={fingerprint(d.keep, t)}
        tableName={tableName}
        legend={`If duplicate: row ${repRef.rowIndex + 1} stays in provenance with reason “duplicate”, pointing at row ${keepRef.rowIndex + 1}.`}
        actions={<>
          <button type="button" onClick={() => apply(t, markNotDuplicate(t.state, d.id), 'Recorded as different results')} className={BTN_SOFT}>They are different</button>
          <button type="button" onClick={() => apply(t, markDuplicate(t.state, d.repeat, d.keep), `Row ${repRef.rowIndex + 1} marked as duplicate`)} className={BTN_PRIMARY}>Mark row {repRef.rowIndex + 1} as duplicate <ArrowRight className="h-4 w-4" /></button>
        </>}
      >
        <FullRowTable t={t} cols={cols} onJump={onJump} />
      </DeckCard>
    </div>
  );
}

function FindMatch({ t, e, find, setFind, onTableState, onJump, apply, notify }: {
  t: TableItem; e: Entity; find: FindState; setFind: (f: FindState | null) => void;
  onTableState: ConsensusWorkspaceProps['onTableState'];
  onJump: ConsensusWorkspaceProps['onJump'];
  apply: (t: TableItem, next: TableConsensusState, msg: string) => void;
  notify: Notify;
}) {
  const cur = refsOf(e.rec).sort((a, b) => bySource(a.source, b.source));
  const curSrc = cur.map(r => r.source);
  const all = matchCandidates(t.model, e.rec, t.state);
  const live = all.filter(c => !c.rejected);
  const likely = live.filter(c => c.score > 0).slice(0, 6);
  const others = live.filter(c => !likely.includes(c));
  const rejected = all.filter(c => c.rejected);
  const cand = find.candId ? all.find(c => c.rec.id === find.candId) : undefined;
  const close = () => setFind(null);

  if (cand) {
    const candRefs = refsOf(cand.rec);
    const group = candRefs.length > 1;
    const refs = [...cur, ...candRefs].sort((a, b) => bySource(a.source, b.source));
    const cols: TableCol[] = refs.map(r => ({
      key: r.source, src: r.source, row: r.row, rowIndex: r.rowIndex,
      label: `${srcLabel(r.source)} · ${curSrc.includes(r.source) ? 'current' : group ? 'existing result' : 'candidate'}`,
    }));
    const present = refs.map(r => r.source);
    const missing = SOURCE_ORDER.filter(s => !present.includes(s) && t.model.rowCounts[s] != null);
    return (
      <DeckCard
        key={cand.rec.id}
        back={<button type="button" onClick={() => setFind({ ...find, candId: null })} className={cn(LINK, 'mb-1')}><ArrowLeft className="h-3.5 w-3.5" /> Back to matches</button>}
        eyebrow="Find a matching row"
        question={group ? `Does ${joinNames(curSrc)} belong with this ${candRefs.map(r => sourceColors(r.source).short).sort().join(' + ')} result?` : 'Do these describe the same result?'}
        sub="Every source the result would contain if you accept is shown."
        meta={cand.score > 0 ? `${Math.round(cand.score * 100)}% similar` : 'Low similarity'}
        title={fingerprint(e.rec, t)}
        actions={<>
          <button type="button" onClick={close} className={BTN_SOFT}>Close</button>
          <button type="button" onClick={() => {
            const prev = t.state;
            onTableState(t.field.field_name, rejectMatch(t.state, e.rec, cand.rec));
            setFind({ ...find, candId: null });
            notify('Recorded: not the same result', () => onTableState(t.field.field_name, prev));
          }} className={BTN_SOFT}>No, try another</button>
          <button type="button" onClick={() => { apply(t, pairRecords(t.state, e.rec, cand.rec), `Matched with ${joinNames(candRefs.map(r => r.source))}`); close(); }} className={BTN_PRIMARY}>
            Yes, match these rows <ArrowRight className="h-4 w-4" />
          </button>
        </>}
      >
        <FullRowTable t={t} cols={cols} onJump={onJump} />
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 px-3.5 py-2.5 text-sm text-gray-600 dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-300">
          <b className="font-semibold text-gray-900 dark:text-white">If accepted:</b> the result becomes {present.map(s => sourceColors(s).short).join(' + ')}.
          {missing.length > 0 && ` ${joinNames(missing)} stays unassigned — not a conflict.`}
          {group && ' The existing group is kept intact either way.'}
        </div>
      </DeckCard>
    );
  }

  const candidateRow = (c: typeof all[number], primary?: boolean) => (
    <li key={c.rec.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3.5 py-3 dark:border-[#1f1f1f]">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{fingerprint(c.rec, t)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {refsOf(c.rec).sort((a, b) => bySource(a.source, b.source)).map(r => <SourceBadge key={r.source} s={r.source} label={srcLabel(r.source)} row={r.rowIndex + 1} />)}
          <span className="text-xs text-gray-400 dark:text-zinc-500">{c.score > 0 ? `${Math.round(c.score * 100)}% similar` : 'identity differs'}</span>
        </div>
      </div>
      <button type="button" onClick={() => setFind({ ...find, candId: c.rec.id })} className={primary ? BTN_PRIMARY : BTN_SOFT}>Compare side-by-side</button>
    </li>
  );

  return (
    <article className={CARD}>
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-[#1f1f1f]">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Find a matching row</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{joinNames(curSrc)}’s row stays pinned while you check candidates from the other sources.</p>
        </div>
        <button type="button" onClick={close} className={BTN_SOFT}>Close</button>
      </header>
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-gray-100 bg-gray-50/50 p-4 lg:border-b-0 lg:border-r dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
          <div className={cn(ML, 'mb-2')}>Current row · pinned</div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
            <div className={cn('px-3 py-2 text-xs font-semibold', sourceColors(curSrc[0]).bg, sourceColors(curSrc[0]).text)}>{joinNames(curSrc)} · current</div>
            <dl>
              {t.model.cols.map(col => {
                const v = show(cur[0].row?.[col.field_name]);
                return (
                  <div key={col.field_name} className="border-t border-gray-100 px-3 py-1.5 dark:border-[#1a1a1a]">
                    <dt className="text-[11px] text-gray-400 dark:text-zinc-500">{colLabel(t.field, col.field_name)}</dt>
                    <dd className={cn('break-words text-[12.5px]', v === '—' ? 'text-gray-300 dark:text-zinc-600' : 'text-gray-800 dark:text-zinc-200', isNumeric(v) && 'tabular-nums')}>{v}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </aside>
        <div className="min-w-0 p-4">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm text-gray-900 dark:text-white">Likely matches</strong>
            <span className="text-xs text-gray-400 dark:text-zinc-500">Other sources only · best first · same-source rows go to Possible duplicates</span>
          </div>
          {likely.length ? (
            <ul className="space-y-2">{likely.map((c, i) => candidateRow(c, i === 0))}</ul>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 px-3.5 py-4 text-sm text-gray-500 dark:border-[#2a2a2a] dark:text-zinc-400">
              No row from another source has a similar identity. Keep this result on its own, or look through the other rows below.
            </p>
          )}
          {others.length > 0 && (
            <div className="mt-3">
              <button type="button" aria-expanded={find.showOthers} onClick={() => setFind({ ...find, showOthers: !find.showOthers })} className="inline-flex min-h-[32px] items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200">
                {find.showOthers ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Other rows, not similar ({others.length})
              </button>
              {find.showOthers && <ul className="mt-2 space-y-2">{others.map(c => candidateRow(c))}</ul>}
            </div>
          )}
          <div className="mt-3">
            <button type="button" aria-expanded={find.reviewedOpen} onClick={() => setFind({ ...find, reviewedOpen: !find.reviewedOpen })} disabled={!rejected.length} className="inline-flex min-h-[32px] items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-200">
              {find.reviewedOpen && rejected.length ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Previously reviewed ({rejected.length})
            </button>
            {find.reviewedOpen && rejected.length > 0 && (
              <ul className="mt-2 space-y-2">
                {rejected.map(c => (
                  <li key={c.rec.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3.5 py-3 dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-600 dark:text-zinc-300">{fingerprint(c.rec, t)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {refsOf(c.rec).map(r => <SourceBadge key={r.source} s={r.source} label={srcLabel(r.source)} />)}
                        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-600 dark:text-red-400"><X className="h-3 w-3" /> Not the same result</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => { onTableState(t.field.field_name, reconsiderMatch(t.state, c.pairId)); notify('Candidate restored to likely matches'); }} className={BTN_SOFT}>Reconsider</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Every Compare decision, listed and reversible. */
function DecisionsMade({ tables, onTableState, notify }: Pick<ConsensusWorkspaceProps, 'tables' | 'onTableState'> & { notify: Notify }) {
  const [open, setOpen] = useState(false);
  const rows: Array<{ key: string; t: TableItem; e: Entity; what: string; undo: () => TableConsensusState }> = [];
  for (const t of tables) for (const e of t.model.entities) {
    const k = `${t.field.field_name}:${e.rec.id}`;
    if (e.status === 'confirmed') rows.push({ key: k, t, e, what: e.rec.alignment === 'manual' ? 'Matched by you' : 'Lined-up rows confirmed', undo: () => unpairRecord(t.state, e.rec) });
    else if (e.status === 'duplicate') rows.push({ key: k, t, e, what: 'Marked as duplicate', undo: () => clearDuplicate(t.state, e.rec.id) });
    if (e.status !== 'duplicate' && e.askInclude && e.rec.id in t.state.include) {
      const r = t.state.excludeReasons[e.rec.id];
      rows.push({ key: `${k}:inc`, t, e, what: t.state.include[e.rec.id] ? 'Kept as its own result' : `Left out${r ? ` · ${EXCLUDE_REASON_LABEL[r].toLowerCase()}` : ''}`, undo: () => clearInclude(t.state, e.rec.id) });
    }
  }
  if (!rows.length) return null;
  return (
    <section className={cn(CARD, 'mt-4')}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-sm font-semibold text-gray-700 dark:text-zinc-200">
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        Decisions made ({rows.length})
        <span className="font-normal text-gray-400 dark:text-zinc-500">— every one can be undone</span>
      </button>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-[#1a1a1a] dark:border-[#1f1f1f]">
          {rows.map(r => (
            <li key={r.key} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-zinc-300">{fingerprint(r.e.rec, r.t)}</span>
              <span className="flex gap-1">{refsOf(r.e.rec).sort((a, b) => bySource(a.source, b.source)).map(x => <SourceBadge key={x.source} s={x.source} row={x.rowIndex + 1} />)}</span>
              <span className="text-xs text-gray-500 dark:text-zinc-400">{r.what}</span>
              <button type="button" onClick={() => { onTableState(r.t.field.field_name, r.undo()); notify('Decision undone'); }} className="min-h-[32px] px-2 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">Undo</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Screen 2: Resolve differences ────────────────────────────────────────────

/** One Resolve card: a table result, or the paper's single-value fields. */
type ResultCard =
  | { kind: 'table'; id: string; t: TableItem; e: Entity; diff: string[]; resolved: boolean }
  | { kind: 'study'; id: 'study'; diff: number[]; resolved: boolean };

function scalarResolved(s: ScalarRow): boolean {
  if (s.agreed) return true;
  if (!s.decision) return false;
  if (s.decision === 'custom') return !blank(s.customValue);
  if (s.decision.startsWith('accept_')) return (s.decision.slice(7) as SourceKey) in s.cells;
  return false;
}

function buildResultCards(tables: TableItem[], scalars: ScalarRow[]): ResultCard[] {
  const out: ResultCard[] = [];
  if (scalars.length) {
    out.push({ kind: 'study', id: 'study', diff: scalars.filter(s => !s.agreed).map(s => s.idx), resolved: scalars.every(scalarResolved) });
  }
  for (const t of tables) {
    const inProposal = new Set(t.model.proposals.flatMap(p => [p.a.id, p.b?.id]));
    for (const e of t.model.entities) {
      if (e.status === 'duplicate' || e.status === 'needs_review' || inProposal.has(e.rec.id)) continue;
      if (awaitingInclude(e, t) || !isIncluded(e, t.state)) continue; // still a Compare decision, or left out
      const diff = refsOf(e.rec).length > 1 ? [...differingColumns(e.rec, t.model.cols)] : [];
      const picks = t.state.cells[e.rec.id] ?? {};
      const resolved = diff.every(c => {
        const p = picks[c];
        if (!p) return !!(t.state.legacyPick && e.rec.members[t.state.legacyPick]);
        return p.from === 'custom' ? !blank(p.value) : !!e.rec.members[p.from];
      });
      out.push({ kind: 'table', id: `${t.field.field_name}:${e.rec.id}`, t, e, diff, resolved });
    }
  }
  return out;
}

function ResolveScreen(props: ConsensusWorkspaceProps & { pendingCompare: number; notify: Notify }) {
  const { tables, scalars, onStage, pendingCompare, notify } = props;
  const cards = useMemo(() => buildResultCards(tables, scalars), [tables, scalars]);
  const withDiff = cards.filter(c => c.diff.length > 0);
  const agree = cards.filter(c => c.diff.length === 0);
  const unresolved = withDiff.filter(c => !c.resolved).length;
  const [view, setView] = useState<'home' | 'diff' | 'agree'>('home');
  const [pos, setPos] = useState<{ diff: number; agree: number }>({ diff: 0, agree: 0 });
  const topRef = useRef<HTMLDivElement>(null);

  const list = view === 'agree' ? agree : withDiff;
  const i = Math.min(view === 'agree' ? pos.agree : pos.diff, Math.max(0, list.length - 1));
  const card = list[i];
  const go = (n: number) => {
    setPos(p => (view === 'agree' ? { ...p, agree: n } : { ...p, diff: n }));
    topRef.current?.scrollIntoView({ block: 'start' });
  };

  if (view === 'home' || !card) {
    return (
      <div>
        <PageTitle
          title="Resolve differences"
          sub="Each card is one final result built in Compare results. Settle every differing value on the same card."
          pill={<span className={unresolved ? PILL_AMBER : cards.length ? PILL_GREEN : PILL_MUTED}>
            {unresolved ? `${plural(unresolved, 'result')} need${unresolved === 1 ? 's' : ''} attention` : cards.length ? 'All results resolved' : 'No results yet'}
          </span>}
        />
        {pendingCompare > 0 && (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <span>{plural(pendingCompare, 'decision')} still open in Compare results. Result cards appear here as you make them.</span>
            <button type="button" onClick={() => onStage('align')} className="min-h-[32px] font-semibold hover:underline">Go to Compare results</button>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <CategoryCard
            title="Results with differences"
            count={unresolved}
            desc={withDiff.length ? `${unresolved} still need a choice. Agreeing fields are filled in automatically; you only pick where sources differ.` : 'No result cards with differing values.'}
            cta={`Review ${plural(unresolved, 'result')}`}
            status={unresolved ? 'Up next' : withDiff.length ? 'Complete' : 'None'}
            complete={unresolved === 0}
            suggested={unresolved > 0}
            onOpen={() => { setView('diff'); setPos(p => ({ ...p, diff: Math.max(0, withDiff.findIndex(c => !c.resolved)) })); }}
          />
          <article className="flex min-h-[200px] flex-col rounded-xl border border-gray-200 bg-white p-5 dark:border-[#1f1f1f] dark:bg-[#111111]">
            <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Already agree</h3>
            <div className="mb-1 mt-3 text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">{agree.length}</div>
            <p className="mb-4 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">All sources gave the same values. No decisions needed, but you can inspect them.</p>
            <button type="button" disabled={!agree.length} onClick={() => { setView('agree'); setPos(p => ({ ...p, agree: 0 })); }} className={cn(BTN_SOFT, 'mt-auto w-full')}>Inspect agreed results</button>
          </article>
        </div>
        {withDiff.length > 0 && unresolved === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { setView('diff'); setPos(p => ({ ...p, diff: 0 })); }} className={BTN_SOFT}>Review resolved results</button>
            <button type="button" onClick={() => onStage('final')} className={BTN_PRIMARY}>Review &amp; save <ArrowRight className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={topRef}>
      <DeckBar backLabel="Resolve home" onBack={() => setView('home')} label={view === 'agree' ? 'Already agree' : 'Results with differences'} done={i} total={list.length} />
      <ResultCardView
        key={card.id}
        card={card}
        readonly={view === 'agree'}
        props={props}
        position={{ i, n: list.length }}
        onPrev={i > 0 ? () => go(i - 1) : undefined}
        onNext={() => {
          if (view === 'agree') { if (i < list.length - 1) go(i + 1); else setView('home'); return; }
          const next = withDiff.findIndex((c, k) => k > i && !c.resolved);
          const wrap = withDiff.findIndex((c, k) => k !== i && !c.resolved);
          if (next >= 0) go(next);
          else if (wrap >= 0) go(wrap);
          else { notify('All result cards resolved'); setView('home'); onStage('final'); }
        }}
      />
    </div>
  );
}

/** A draft pick for one row of a Resolve card, before "Save result & next". */
type RowPick = { from: SourceKey | 'custom'; value?: any } | null;

interface CardRow {
  key: string;
  label: string;
  cells: Partial<Record<SourceKey, any>>;
  diff: boolean;
  committed: RowPick;
  field?: FormField;
  isTable?: boolean;
  options?: string[] | null;
}

function ResultCardView({ card, readonly, props, position, onPrev, onNext }: {
  card: ResultCard; readonly: boolean; props: ConsensusWorkspaceProps;
  position: { i: number; n: number };
  onPrev?: () => void; onNext: () => void;
}) {
  const { onTableState, onJump, commitScalars, scalars, scalarSources } = props;

  let sources: SourceKey[];
  let rows: CardRow[];
  let title: string;
  let eyebrow: string;
  let sub: string;
  let note = '';

  if (card.kind === 'table') {
    const { t, e } = card;
    sources = refsOf(e.rec).map(r => r.source).sort(bySource);
    const diff = new Set(card.diff);
    const picks = t.state.cells[e.rec.id] ?? {};
    rows = t.model.cols.map(col => {
      const p = picks[col.field_name];
      const legacy: RowPick = !p && t.state.legacyPick && e.rec.members[t.state.legacyPick] ? { from: t.state.legacyPick } : null;
      return {
        key: col.field_name,
        label: colLabel(t.field, col.field_name),
        cells: Object.fromEntries(sources.map(s => [s, e.rec.members[s]!.row?.[col.field_name]])),
        diff: diff.has(col.field_name),
        committed: p ? { from: p.from, value: p.value } : legacy,
        field: (t.field.subform_fields ?? []).find(f => f.field_name === col.field_name),
        options: col.options,
      };
    });
    title = fingerprint(e.rec, t);
    const single = sources.length === 1;
    eyebrow = readonly ? 'Already agree · read only' : single ? 'Source-only result' : 'Final result card';
    sub = readonly ? 'All sources gave identical values. Final is filled automatically.'
      : single ? `Kept from ${srcLabel(sources[0])} only. Values copy straight into Final; other sources are not treated as blanks.`
        : 'Settle every differing value for this result here, then save.';
    note = t.state.resultNotes[e.rec.id] ?? '';
  } else {
    sources = [...scalarSources].sort(bySource);
    rows = scalars.map(s => ({
      key: String(s.idx),
      label: s.label,
      cells: s.cells,
      diff: !s.agreed,
      committed: s.decision?.startsWith('accept_') ? { from: s.decision.slice(7) as SourceKey }
        : s.decision === 'custom' ? { from: 'custom', value: s.customValue } : null,
      field: s.field,
      isTable: s.isTable,
      options: s.field?.options,
    }));
    title = 'Study details';
    eyebrow = readonly ? 'Already agree · read only' : 'Single-value fields';
    sub = readonly ? 'Every source gave the same value for every field.' : 'Every single-value field of this form. Settle the ones that differ, then save.';
  }

  const [draft, setDraft] = useState<Record<string, RowPick>>(() => Object.fromEntries(rows.filter(r => r.diff).map(r => [r.key, r.committed])));
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.filter(r => r.committed?.from === 'custom').map(r => [r.key, true])));
  const [noteDraft, setNoteDraft] = useState(note);
  const [noteOpen, setNoteOpen] = useState(!!note);

  const diffRows = rows.filter(r => r.diff);
  const pickValid = (r: CardRow, p: RowPick) => !!p && (p.from === 'custom' ? !blank(p.value) : p.from in r.cells);
  const openRows = diffRows.filter(r => !pickValid(r, draft[r.key] ?? null));
  const dirty = diffRows.some(r => JSON.stringify(draft[r.key] ?? null) !== JSON.stringify(r.committed)) || noteDraft !== note;

  const save = () => {
    if (openRows.length) return;
    if (card.kind === 'table') {
      let s = card.t.state;
      for (const r of diffRows) s = setCellPick(s, card.e.rec.id, r.key, draft[r.key] as CellPick);
      s = setResultNote(s, card.e.rec.id, noteDraft);
      onTableState(card.t.field.field_name, s);
    } else {
      commitScalars(diffRows.map(r => {
        const p = draft[r.key]!;
        return p.from === 'custom' ? { idx: Number(r.key), decision: 'custom', customValue: p.value } : { idx: Number(r.key), decision: `accept_${p.from}` };
      }));
    }
    onNext();
  };

  return (
    <article className={CARD}>
      <header className="px-5 pb-4 pt-5">
        <div className={ML}>{eyebrow}</div>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{sub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sources.map(s => <SourceBadge key={s} s={s} label={srcLabel(s)} />)}
          {card.kind === 'table' && props.tables.length > 1 && <span className={PILL_MUTED}>{fieldLabel(card.t.field)}</span>}
          <span className="text-xs text-gray-500 dark:text-zinc-400">{rows.length - diffRows.length} of {rows.length} fields agree</span>
          {diffRows.length > 0 && !readonly && (
            <span className={cn('text-xs font-semibold', openRows.length ? 'text-amber-700 dark:text-amber-300' : STATE_COLORS.resolved.text)}>
              · {openRows.length ? `${openRows.length} still need${openRows.length === 1 ? 's' : ''} a choice` : 'All differences settled'}
            </span>
          )}
        </div>
        {diffRows.length > 0 && !readonly && <p className="mt-2 text-xs text-gray-400 dark:text-zinc-500">Click a source value to make it Final, or enter a custom value.</p>}
      </header>

      <div className="overflow-x-auto border-t border-gray-100 dark:border-[#1f1f1f]">
        <table className="w-full min-w-[620px] table-fixed border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-[20%] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold text-gray-500 dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-400">Field</th>
              {sources.map(s => (
                <th key={s} className={cn('border-b border-l border-gray-200 px-3 py-2 text-left text-[11px] font-semibold dark:border-[#1f1f1f]', sourceColors(s).bg, sourceColors(s).text)}>{srcLabel(s)}</th>
              ))}
              <th className="w-[22%] border-b border-l border-gray-200 bg-emerald-50 px-3 py-2 text-left text-[11px] font-semibold text-emerald-700 dark:border-[#1f1f1f] dark:bg-emerald-950/30 dark:text-emerald-300">Final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const p = draft[r.key] ?? null;
              const opts = r.diff ? groupValues(r.cells, sources, r.options) : [];
              const majority = opts.find(o => o.sources.length > 1);
              const selectable = r.diff && !readonly;
              return (
                <tr key={r.key} className={cn('border-b border-gray-100 last:border-b-0 dark:border-[#1a1a1a]', r.diff && 'bg-amber-50/50 dark:bg-amber-950/10')}>
                  <th scope="row" className={cn('px-3 py-2 text-left align-top text-[12px]', r.diff ? 'bg-amber-50 font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-gray-50/60 font-medium text-gray-500 dark:bg-[#0d0d0d] dark:text-zinc-400')}>
                    {r.label}{r.diff && <span className="ml-1" aria-label="differs">≠</span>}
                  </th>
                  {sources.map(s => {
                    const cell = r.cells[s];
                    const v = show(cell);
                    const meta = cellMeta(cell);
                    const picked = !!p && p.from !== 'custom' && sameValue(r.cells, p.from, s, r.options);
                    const jump = hasJumpableEvidence(meta) ? <EvidenceIcon onClick={() => onJump(s, meta!, r.label, cellValue(cell))} page={meta!.page} showPage /> : null;
                    return (
                      <td key={s} className="border-l border-gray-100 p-0 align-top dark:border-[#1a1a1a]">
                        {selectable ? (
                          <div className="flex items-start">
                            <button
                              type="button"
                              aria-pressed={picked}
                              aria-label={`Use ${srcLabel(s)}'s value for ${r.label}: ${v}`}
                              onClick={() => { setDraft(d => ({ ...d, [r.key]: { from: s } })); setCustomOpen(c => ({ ...c, [r.key]: false })); }}
                              className={cn(
                                'min-h-[40px] flex-1 px-3 py-2 text-left transition-colors',
                                picked ? 'bg-emerald-50 font-semibold text-emerald-900 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100' : 'hover:bg-white dark:hover:bg-[#161616]',
                                !picked && (v === '—' ? 'text-gray-400 dark:text-zinc-500' : 'font-medium text-gray-900 dark:text-white'),
                                isNumeric(v) && 'tabular-nums',
                              )}
                            >
                              {picked && <Check className="-mt-0.5 mr-1 inline h-3.5 w-3.5" strokeWidth={3} />}
                              <span className="break-words">{v}</span>
                            </button>
                            {jump && <span className="pr-1.5 pt-2">{jump}</span>}
                          </div>
                        ) : (
                          <span className={cn('block px-3 py-2', v === '—' ? 'text-gray-300 dark:text-zinc-600' : 'text-gray-600 dark:text-zinc-300', isNumeric(v) && 'tabular-nums')}>
                            <span className="break-words">{v}</span>{jump}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className={cn('border-l border-gray-100 px-3 py-2 align-top dark:border-[#1a1a1a]', r.diff ? (pickValid(r, p) ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-amber-50 dark:bg-amber-950/20') : 'bg-emerald-50/30 dark:bg-emerald-950/10')}>
                    {!r.diff ? (
                      <span className={cn('break-words font-medium text-emerald-800 dark:text-emerald-300', isNumeric(show(r.cells[sources[0]])) && 'tabular-nums')}>
                        {show(r.cells[sources[0]])} <span aria-label="agreed">✓</span>
                      </span>
                    ) : readonly ? null : (
                      <div className="space-y-1.5">
                        <div className={cn('break-words font-semibold', pickValid(r, p) ? 'text-gray-900 dark:text-white' : 'text-amber-800 dark:text-amber-300')}>
                          {p && p.from !== 'custom' ? show(r.cells[p.from]) : p?.from === 'custom' && !blank(p.value) ? String(p.value) : 'Choose a value'}
                          {p?.from === 'custom' && !blank(p.value) && <span className="ml-1.5 text-[10px] font-semibold uppercase text-gray-400">custom</span>}
                        </div>
                        {!p && majority && <div className="text-[11px] text-gray-500 dark:text-zinc-400">{majority.sources.sort(bySource).map(x => sourceColors(x).short).join(' + ')} agree</div>}
                        {!r.isTable && (customOpen[r.key] ? (
                          <FieldRenderer
                            field={r.field ?? ({ field_name: r.key, field_type: 'text' } as FormField)}
                            value={p?.from === 'custom' ? p.value ?? '' : ''}
                            onChange={v => setDraft(d => ({ ...d, [r.key]: { from: 'custom', value: v } }))}
                            index={0}
                            compact
                          />
                        ) : (
                          <button type="button" onClick={() => { setCustomOpen(c => ({ ...c, [r.key]: true })); setDraft(d => ({ ...d, [r.key]: { from: 'custom', value: '' } })); }} className="min-h-[28px] text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400">
                            Custom value
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {card.kind === 'table' && !readonly && (
        <div className="border-t border-gray-100 px-5 py-3 dark:border-[#1f1f1f]">
          {noteOpen ? (
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Note on this result (optional)</span>
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={2} className="mt-1 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-200 dark:focus:ring-blue-900" placeholder="Why these values — e.g. “Table 2, ITT population”" />
            </label>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="min-h-[32px] text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200">+ Add a note</button>
          )}
        </div>
      )}

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-gray-100 bg-white/95 px-5 py-3.5 dark:border-[#1f1f1f] dark:bg-[#111111]/95">
        <div className="flex items-center gap-3">
          {dirty && !readonly && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Not saved yet</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onPrev} disabled={!onPrev} className={BTN_SOFT}><ArrowLeft className="h-4 w-4" /> Previous result</button>
          {readonly ? (
            <button type="button" onClick={onNext} className={BTN_PRIMARY}>{position.i < position.n - 1 ? 'Next result' : 'Done'} <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button type="button" onClick={save} disabled={openRows.length > 0} className={BTN_PRIMARY} title={openRows.length ? `Choose a value for ${plural(openRows.length, 'field')} first` : undefined}>
              {card.resolved && !dirty ? 'Next result' : card.resolved ? 'Update & next' : 'Save result & next'} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

/** Distinct values of one row across sources, agreeing sources grouped. */
function groupValues(cells: Partial<Record<SourceKey, any>>, sources: SourceKey[], options?: string[] | null) {
  const out: Array<{ key: string; sources: SourceKey[] }> = [];
  for (const s of sources) {
    const k = compareKey(cells[s], options) ?? `\u0000${s}`;
    const hit = out.find(o => o.key === k);
    if (hit) hit.sources.push(s);
    else out.push({ key: k, sources: [s] });
  }
  return out;
}

/** Picking R1 when R1 and AI agree lights both — they are the same value. */
function sameValue(cells: Partial<Record<SourceKey, any>>, picked: SourceKey, s: SourceKey, options?: string[] | null): boolean {
  if (picked === s) return true;
  const a = compareKey(cells[picked], options);
  return a !== null && a === compareKey(cells[s], options);
}

// ─── Screen 3: Review & save ──────────────────────────────────────────────────

function isKept(e: Entity, t: TableItem): boolean {
  return e.status !== 'duplicate' && e.status !== 'needs_review' && !awaitingInclude(e, t) && isIncluded(e, t.state);
}

function FinalScreen(props: ConsensusWorkspaceProps & { pendingCompare: number; unresolved: number; notify: Notify }) {
  const { tables, scalars, onFinalize, submitting, isUpdate, onExportCsv, onStage, pendingCompare, unresolved, onTableState, notify } = props;
  const openDecisions = pendingCompare + unresolved;
  const ready = openDecisions === 0;
  const kept = tables.reduce((n, t) => n + t.model.entities.filter(e => isKept(e, t)).length, 0);
  const setAside: Array<{ key: string; t: TableItem; e: Entity; reason: string; restore: () => TableConsensusState }> = [];
  for (const t of tables) for (const e of t.model.entities) {
    const k = `${t.field.field_name}:${e.rec.id}`;
    if (e.status === 'duplicate') {
      const rep = t.model.entities.find(x => x.rec.id === e.duplicateOf)?.rec;
      setAside.push({ key: k, t, e, reason: `Duplicate of ${rep ? fingerprint(rep, t) : 'another row'}`, restore: () => clearDuplicate(t.state, e.rec.id) });
    } else if (e.askInclude && t.state.include[e.rec.id] === false) {
      const r = t.state.excludeReasons[e.rec.id];
      setAside.push({ key: k, t, e, reason: `Left out${r ? ` · ${EXCLUDE_REASON_LABEL[r as ExcludeReason].toLowerCase()}` : ''}`, restore: () => clearInclude(t.state, e.rec.id) });
    }
  }
  const dups = setAside.filter(x => x.e.status === 'duplicate').length;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Review & save"
        sub="Final consensus results with source provenance retained. Nothing here is irreversible."
        pill={<span className={ready ? PILL_GREEN : PILL_AMBER}>{ready ? 'Ready to save' : plural(openDecisions, 'open decision')}</span>}
      />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 sm:grid-cols-4 dark:border-[#1f1f1f] dark:bg-[#1f1f1f]">
        {[
          { n: kept, l: kept === 1 ? 'Result kept' : 'Results kept', warn: false },
          { n: setAside.length - dups, l: 'Left out', warn: false },
          { n: dups, l: dups === 1 ? 'Duplicate recorded' : 'Duplicates recorded', warn: false },
          { n: openDecisions, l: 'Open decisions', warn: openDecisions > 0 },
        ].map(m => (
          <div key={m.l} className="bg-white px-4 py-3.5 dark:bg-[#111111]">
            <div className={cn('text-2xl font-bold tabular-nums', m.warn ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white')}>{m.n}</div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">{m.l}</div>
          </div>
        ))}
      </div>

      {!ready && (
        <div className="flex flex-wrap gap-4 text-sm">
          {pendingCompare > 0 && <button type="button" onClick={() => onStage('align')} className={LINK}>{plural(pendingCompare, 'decision')} open in Compare results →</button>}
          {unresolved > 0 && <button type="button" onClick={() => onStage('resolve')} className={LINK}>{plural(unresolved, 'result')} to resolve →</button>}
        </div>
      )}

      {tables.map(t => <FinalTable key={t.field.field_name} t={t} onOpen={() => onStage('resolve')} />)}

      {scalars.length > 0 && (
        <section className={CARD}>
          <div className="px-5 pb-3 pt-5">
            <div className={ML}>Final consensus</div>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Study details</h2>
          </div>
          <dl className="grid gap-x-8 border-t border-gray-100 px-5 py-2 sm:grid-cols-2 dark:border-[#1f1f1f]">
            {scalars.map(s => {
              const first = (Object.keys(s.cells) as SourceKey[])[0];
              const v = s.agreed ? show(s.cells[first]) : s.decision === 'custom' ? String(s.customValue ?? '') : s.decision?.startsWith('accept_') ? show(s.cells[s.decision.slice(7) as SourceKey]) : null;
              const by = s.agreed ? 'Agreed' : s.decision === 'custom' ? 'Custom' : s.decision?.startsWith('accept_') ? sourceColors(s.decision.slice(7) as SourceKey).short : '';
              return (
                <div key={s.idx} className="flex items-baseline gap-2 border-b border-gray-50 py-1.5 last:border-b-0 dark:border-[#161616]">
                  <dt className="w-2/5 flex-shrink-0 truncate text-xs text-gray-500 dark:text-zinc-400" title={s.label}>{s.label}</dt>
                  <dd className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-zinc-200" title={v ?? ''}>{v ?? <span className="text-amber-700 dark:text-amber-300">open</span>}</dd>
                  <span className="flex-shrink-0 text-[11px] text-gray-400 dark:text-zinc-500">{by}</span>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {setAside.length > 0 && (
        <section className={CARD}>
          <div className="px-5 pb-3 pt-5">
            <div className={ML}>Kept in provenance</div>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Set aside</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Rows left out of the consensus. They stay in the record with their reason; restore any of them.</p>
          </div>
          <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-[#1a1a1a] dark:border-[#1f1f1f]">
            {setAside.map(x => (
              <li key={x.key} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <span className="flex gap-1">{refsOf(x.e.rec).map(r => <SourceBadge key={r.source} s={r.source} row={r.rowIndex + 1} />)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-zinc-300">{fingerprint(x.e.rec, x.t)}</span>
                <span className="text-xs text-gray-500 dark:text-zinc-400">{x.reason}</span>
                <button type="button" onClick={() => { onTableState(x.t.field.field_name, x.restore()); notify('Restored'); }} className="min-h-[32px] px-2 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={cn(CARD, 'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3.5')}>
        <button type="button" onClick={() => onStage('resolve')} className={LINK}><ArrowLeft className="h-3.5 w-3.5" /> Back to Resolve differences</button>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExportCsv} className={BTN_SOFT}><Download className="h-4 w-4" /> Export CSV</button>
          <button type="button" onClick={onFinalize} disabled={!ready || submitting} className={BTN_PRIMARY} title={ready ? undefined : 'Finish the open decisions first'}>
            {submitting ? 'Saving…' : isUpdate ? 'Update consensus' : 'Save consensus'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FinalTable({ t, onOpen }: { t: TableItem; onOpen: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const cols = t.model.cols;
  const rows = t.model.entities.filter(e => isKept(e, t));
  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section className={CARD}>
      <div className="px-5 pb-3 pt-5">
        <div className={ML}>Final consensus</div>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{fieldLabel(t.field)}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">One row per final result. Expand a row to see where it came from.</p>
      </div>
      <div className="overflow-x-auto border-t border-gray-100 dark:border-[#1f1f1f]">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="bg-gray-50/70 text-left dark:bg-[#0d0d0d]">
              <th className="w-10" aria-label="Expand" />
              {cols.map(c => <th key={c.field_name} className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">{colLabel(t.field, c.field_name)}</th>)}
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Sources</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 3} className="px-5 py-5 text-sm text-gray-500 dark:text-zinc-400">No results yet. Make decisions in Compare results first.</td></tr>
            )}
            {rows.map(e => {
              const cells = previewCells(e, cols, t.state);
              const refs = refsOf(e.rec).sort((a, b) => bySource(a.source, b.source));
              const open = cols.some(c => cells[c.field_name]?.open);
              const hasDiff = refs.length > 1 && differingColumns(e.rec, cols).size > 0;
              const status = open ? 'Needs review' : hasDiff ? 'Resolved' : refs.length === 1 ? 'Kept' : 'Agree';
              const isOpen = expanded.has(e.rec.id);
              return (
                <Fragment key={e.rec.id}>
                  <tr className="border-t border-gray-100 dark:border-[#1a1a1a]">
                    <td className="px-1 py-1">
                      <button type="button" aria-expanded={isOpen} aria-label="Show provenance" onClick={() => toggle(e.rec.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-200">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    {cols.map(c => {
                      const x = cells[c.field_name];
                      const v = show(x?.cell);
                      return <td key={c.field_name} className={cn('max-w-[220px] truncate px-3 py-2', x?.open ? 'italic text-amber-700 dark:text-amber-300' : v === '—' ? 'text-gray-300 dark:text-zinc-600' : 'text-gray-800 dark:text-zinc-200', isNumeric(v) && 'tabular-nums')} title={cellValue(x?.cell)}>{x?.open ? 'open' : v}</td>;
                    })}
                    <td className="px-3 py-2"><span className="flex gap-1">{refs.map(r => <SourceBadge key={r.source} s={r.source} />)}</span></td>
                    <td className="px-3 py-2">
                      {status === 'Needs review'
                        ? <button type="button" onClick={onOpen} className={cn(PILL_AMBER, 'hover:underline')}>Needs review</button>
                        : <span className={PILL_GREEN}>{status}</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/60 dark:bg-[#0d0d0d]">
                      <td />
                      <td colSpan={cols.length + 2} className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300">
                        <b className="font-semibold">Source rows:</b> {refs.map(r => `${srcLabel(r.source)} row ${r.rowIndex + 1}`).join(', ')}.{' '}
                        {e.status === 'auto_aligned' && refs.length > 1 && 'Lined up automatically on identical identifying columns. '}
                        {e.status === 'confirmed' && 'Matched by you. '}
                        {e.askInclude && 'Kept by you although not every source reported it. '}
                        {cols.filter(c => cells[c.field_name]?.from && cells[c.field_name]?.from !== 'agreed' && refs.length > 1).map(c => {
                          const f = cells[c.field_name]!.from!;
                          return <span key={c.field_name} className="mr-2 inline-block">{colLabel(t.field, c.field_name)} from {f === 'custom' ? 'a custom value' : srcLabel(f as SourceKey)}.</span>;
                        })}
                        {t.state.resultNotes[e.rec.id] && <span className="block pt-1 italic">“{t.state.resultNotes[e.rec.id]}”</span>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── The workspace ────────────────────────────────────────────────────────────

export function ConsensusWorkspace(props: ConsensusWorkspaceProps) {
  const { stage, onStage, tables, scalars, paperHidden, onTogglePaper } = props;
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify: Notify = useCallback((msg, undo) => setToast({ msg, undo, id: Date.now() }), []);
  const closeToast = useCallback(() => setToast(null), []);

  const pending = useMemo(() => pendingItems(tables), [tables]);
  // Progress per category: every item seen since the paper opened is one of
  // the category's decisions; the ones no longer pending are done.
  const seen = useRef<Record<Category, Set<string>>>({ matches: new Set(), single: new Set(), duplicate: new Set() });
  const progress = useMemo(() => {
    const out = {} as Record<Category, { done: number; total: number }>;
    for (const c of ['matches', 'single', 'duplicate'] as Category[]) {
      for (const i of pending[c]) seen.current[c].add(i.key);
      const live = new Set(pending[c].map(i => i.key));
      out[c] = { total: seen.current[c].size, done: [...seen.current[c]].filter(k => !live.has(k)).length };
    }
    return out;
  }, [pending]);
  const pendingCompare = pending.matches.length + pending.single.length + pending.duplicate.length;
  const cards = useMemo(() => buildResultCards(tables, scalars), [tables, scalars]);
  const unresolved = cards.filter(c => c.diff.length > 0 && !c.resolved).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={onTogglePaper}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-gray-500 hover:bg-white hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-200"
        >
          {paperHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {paperHidden ? 'Show paper' : 'Hide paper'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <div className="mx-auto max-w-[1180px] space-y-4">
          <Stepper
            stage={stage}
            onStage={onStage}
            meta={{
              align: pendingCompare ? `${pendingCompare} left` : '',
              resolve: unresolved ? `${unresolved} left` : '',
              final: pendingCompare === 0 && unresolved === 0 ? 'Ready' : '',
            }}
            done={{ align: pendingCompare === 0, resolve: pendingCompare === 0 && unresolved === 0, final: false }}
          />
          {stage === 'align' && <CompareScreen {...props} pending={pending} progress={progress} notify={notify} />}
          {stage === 'resolve' && <ResolveScreen {...props} pendingCompare={pendingCompare} notify={notify} />}
          {stage === 'final' && <FinalScreen {...props} pendingCompare={pendingCompare} unresolved={unresolved} notify={notify} />}
        </div>
      </div>
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
