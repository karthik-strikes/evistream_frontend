'use client';

/**
 * What is left to assess, as a table of results grouped by study.
 *
 * Three things this shape does that a flat list cannot.
 *
 * **The comparison sits on the study header, not on every row.** Every result
 * under it shares it, so repeating "Naproxen 400–440 mg vs Acetaminophen
 * 500–1,000 mg" six times buries the thing that actually differs between the
 * rows — the outcome and how it was measured.
 *
 * **The dots are this reviewer's own judgements.** Not the study's, not a
 * consensus: there is no such thing as one risk-of-bias judgement for a paper,
 * and a row that averaged five domains into one verdict would invent one.
 *
 * **Every row says what to do next.** "Blocked" and "Trial answers needed" each
 * name a different next step, and the line under the row says what it is. A
 * queue that shows only progress leaves a reviewer to work out why the thing
 * they clicked does nothing. What a row does NOT say is whose seat the study
 * is — that is one fact about the whole study, said once on its heading.
 *
 * Narrow screens get stacked cards: a seven-column grid at 390px is unreadable,
 * and a horizontal scrollbar hides the status column, which is the one a
 * reviewer came for.
 */

import { useState } from 'react';

import { ChevronDown, Search } from 'lucide-react';

import {
  PROGRESS_LABEL, SEVERITY_GLYPH, SEVERITY_SHORT,
  type QueueResult, type ResultProgress, type StudyGroup,
} from '../_lib/robQueue';
import { absenceLabel, contrastLabel } from '../_lib/robIdentity';
import { ROB2_SIGNALLING, type Severity } from '../_lib/rob2';
// One definition for the whole feature. These lived here first and had already
// drifted from the shared module, which is exactly what it exists to prevent.
import { Badge, BTN, BTN_PRIMARY, MUTED, SURFACE } from '../_lib/robSkin';

/** `D3` on its own says nothing; the column header carries the domain's name. */
const DOMAIN_NAME = ROB2_SIGNALLING.map(d => d.name);


/** The filters, in the order a reviewer reaches for them. */
export type QueueFilter = 'all' | 'mine' | 'trial' | 'blocked' | 'complete';

export const FILTER_LABEL: Record<QueueFilter, string> = {
  all: 'All results',
  mine: 'Needs me',
  trial: 'Trial answers',
  blocked: 'Blocked',
  complete: 'Complete',
};

export function matchesFilter(row: QueueResult, filter: QueueFilter): boolean {
  switch (filter) {
    // Everything of mine that is neither blocked nor finished. Matched on the
    // conditions rather than on one status name, so splitting `not_started`
    // and `stale` out of `in_progress` cannot quietly empty this filter.
    case 'mine': return row.progress === 'in_progress'
      || row.progress === 'not_started' || row.progress === 'stale';
    case 'trial': return row.progress === 'trial_needed';
    case 'blocked': return row.progress === 'blocked';
    case 'complete': return row.progress === 'complete';
    default: return true;
  }
}

interface Props {
  groups: StudyGroup[];
  activeResultId: string | null;
  query: string;
  onQuery: (value: string) => void;
  filter: QueueFilter;
  onFilter: (next: QueueFilter) => void;
  counts: Record<QueueFilter, number>;
  onOpenTrial: (documentId: string, contrastId: string) => void;
  onOpenResult: (resultId: string) => void;
  onManageComparisons: (documentId: string) => void;
  lede: string;
  /** Escape from a search or filter that matched nothing. */
  onClearFilters: () => void;
  /**
   * Studies whose rows cannot become results yet, because nobody has said which
   * arms were compared. They stay visible: a candidate that quietly disappears
   * is worse than one that says what it is waiting for.
   */
  comparisonNeeded: Array<{
    documentId: string; label: string; arms: number;
    /** The rows waiting on it, when they are known. Empty is "not loaded", not "none". */
    rows: Array<{ outcome: string; timepoint: string; source: string }>;
  }>;
}

const TONE: Record<Severity, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-900/50',
  some: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-900/50',
  high: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-900/50',
  none: 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-transparent dark:text-zinc-700 dark:border-[#242424]',
};

/** The instrument's own mapping: held is a concern, finished is low, the rest neutral. */
const STATUS_BADGE: Record<ResultProgress, 'low' | 'some' | 'high' | 'info'> = {
  blocked: 'some',
  stale: 'some',
  agreed: 'low',
  complete: 'low',
  trial_needed: 'info',
  not_started: 'info',
  in_progress: 'info',
};

const STATUS_TONE: Record<ResultProgress, string> = {
  blocked: 'text-gray-600 dark:text-zinc-400',
  agreed: 'text-emerald-700 dark:text-emerald-400',
  stale: 'text-gray-600 dark:text-zinc-400',
  trial_needed: 'text-gray-600 dark:text-zinc-400',
  not_started: 'text-gray-500 dark:text-zinc-500',
  in_progress: 'text-gray-600 dark:text-zinc-400',
  complete: 'text-emerald-700 dark:text-emerald-400',
};

/** `minmax(0,1fr)` on the name column is what stops long outcomes widening the page. */
/** Column widths from the instrument's own table: 43px domains, 145/185 tails. */
const GRID = '[grid-template-columns:minmax(0,1fr)_repeat(5,43px)_minmax(120px,145px)_minmax(150px,185px)]';

function Dot({ severity, domain }: { severity: Severity; domain?: number }) {
  // A glyph alone reads as "✓" to a screen reader and as nothing at all out of
  // context. Both the tooltip and the label name the domain it belongs to.
  const described = domain === undefined
    ? SEVERITY_SHORT[severity]
    : `${DOMAIN_NAME[domain]}: ${SEVERITY_SHORT[severity]}`;
  return (
    <span
      role="img"
      title={described}
      aria-label={described}
      className={`inline-flex items-center justify-center w-[26px] h-[26px] rounded-full border text-[13px] font-bold ${TONE[severity]}`}
    >
      {SEVERITY_GLYPH[severity]}
    </span>
  );
}

/**
 * How far this result has got, and what is stopping it — both, not one or the
 * other. A blocked row that hides its progress loses the fact that eleven
 * answers are already in, which is exactly what a reviewer wants to know before
 * deciding whether the blocker is worth chasing.
 */
/**
 * The identity changed after this assessment was made.
 *
 * Carried on `QueueResult.stale` since the rebuild and rendered nowhere, which
 * only started to matter once correcting an identity became possible at all.
 * It is a marker beside the status rather than a status of its own: a stale
 * review is still complete, or still in progress, and collapsing the two would
 * drop the row out of whichever filter its reviewer looks in.
 */
function StaleMark() {
  return (
    <span
      title="This result's identity changed after the assessment was made"
      className="ml-1.5 inline-block align-middle text-[10px] font-semibold rounded px-1 py-px border border-gray-200 text-gray-700 bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:bg-gray-500/10"
    >
      Review changes
    </span>
  );
}

/**
 * What is stopping this row, and nothing else.
 *
 * The "N/M applicable answered · more may apply" count was REMOVED here (22 Sep
 * 2026). In the queue it carried almost no per-row information: the count is
 * dominated by the six trial-level answers, which are stored per study and
 * comparison and READ by every result under them — so every row of a study
 * printed the same "5/12", once per line, and the one thing that did differ per
 * row was the blocker it was buried next to.
 *
 * It stays where it is about one thing at a time: the per-domain counter in
 * `DomainRail`, and the review line on the assess screen.
 */
/**
 * Timing carried inside an outcome NAME rather than in a timepoint column.
 *
 * "Pain relief at 6 hours" with an empty timepoint is the ordinary shape in
 * this corpus: the outcome label says when, and no column does. Grouping on the
 * raw name then prints the timing in every heading and leaves the Time chip
 * saying "not specified", which is both noisier and less true.
 *
 * Three rules keep this honest:
 *   · It only ever runs when the stored timepoint is EMPTY. A real timepoint
 *     always wins and the name is left alone.
 *   · The phrase is quoted exactly as written — "at 6 hours" stays "at 6
 *     hours", never "At 6 h". "at 6 hours" is an instant and "over 6 hours" is
 *     an interval, and this file is not the place that decides they are the
 *     same thing.
 *   · It is anchored to the END of the name, so an outcome that merely mentions
 *     a duration in the middle is untouched.
 *
 * Display only. The stored `outcome_domain` is what the identity, the export
 * and the assessment header use, and it is on the heading's `title`.
 */
const TRAILING_TIME =
  /\s*[—–-]?\s*\b((?:at|over|after|within|by|through|to)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:h|hr|hrs|hour|hours|min|mins|minute|minutes|day|days|week|weeks|month|months))\s*$/i;

function splitTiming(outcome: string, timepoint: string): { name: string; time: string } {
  const stored = (timepoint ?? '').trim();
  if (stored) return { name: outcome, time: absenceLabel(stored) };
  const hit = TRAILING_TIME.exec(outcome ?? '');
  if (!hit) return { name: outcome, time: '' };
  return { name: outcome.slice(0, hit.index).trim() || outcome, time: hit[1] };
}

interface SubGroup {
  key: string;
  /** The outcome, with any trailing timing lifted into `time`. */
  name: string;
  /** The stored outcome_domain, for the heading's tooltip. */
  storedName: string;
  measurement: string;
  time: string;
  rows: QueueResult[];
  /** Slots that differ BETWEEN this group's rows, so must stay on the rows. */
  varying: Array<'population' | 'analysis_population' | 'analysis'>;
}

/**
 * One block per outcome · measurement · timepoint; the rows under it are the
 * comparisons.
 *
 * Grouping this way is what stops a three-comparison study printing its outcome
 * nine times. The key deliberately keeps measurement and timepoint in it: two
 * results of one outcome measured differently are two different things, and
 * collapsing them under one heading would say they are not.
 */
function subGroupsOf(rows: QueueResult[]): SubGroup[] {
  const out: SubGroup[] = [];
  const index = new Map<string, SubGroup>();
  for (const row of rows) {
    const { name, time } = splitTiming(
      row.result.outcome_domain ?? '', row.result.timepoint ?? '');
    const measurement = row.result.measurement ?? '';
    const key = `${name}\u0000${measurement}\u0000${time}`;
    let group = index.get(key);
    if (!group) {
      group = { key, name, storedName: row.result.outcome_domain ?? '',
                measurement, time, rows: [], varying: [] };
      index.set(key, group);
      out.push(group);
    }
    group.rows.push(row);
  }
  // A slot that is the same on every row of a block is said once, in the study
  // header or not at all; one that differs is the only thing telling two rows
  // apart and has to stay on them. "Overall" vs a named population is exactly
  // that case, and hoisting it would hide the difference entirely.
  for (const group of out) {
    for (const slot of ['population', 'analysis_population', 'analysis'] as const) {
      const values = new Set(group.rows.map(r => (r.result[slot] ?? '').trim()));
      if (values.size > 1) group.varying.push(slot);
    }
  }
  return out;
}

/** The row-level slots, named the way the chip labels them. */
const VARYING_LABEL: Record<'population' | 'analysis_population' | 'analysis', string> = {
  population: 'Population',
  analysis_population: 'Analysis set',
  analysis: 'Analysis',
};

const CHIP_LABEL =
  'text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-600';

/** `Measure …` / `Time …` — a quiet label and the value it belongs to. */
function SlotChip({ label, value, muted }: {
  label: string; value: string; muted?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] px-2 py-[3px] max-w-full">
      <span className={CHIP_LABEL}>{label}</span>
      {/* `truncate` is `overflow: hidden`, which clips at the padding edge —
          and an italic glyph leans past the advance width it was measured at,
          so the final letter of "not specified" lost its tail. One pixel of
          padding gives the overhang somewhere to go, without letting a long
          measurement name blow the chip out. */}
      <span className={`text-[11.5px] truncate pr-px ${muted
        ? 'italic text-gray-400 dark:text-zinc-600'
        : 'text-gray-700 dark:text-zinc-300'}`}>
        {value}
      </span>
    </span>
  );
}

/**
 * The comparison, as two named arms.
 *
 * Both sides read the same: the study name above already carries this
 * product's one accent, and a second coloured or bolded thing on every row
 * competed with the thing a reviewer actually scans for. The `vs` between them
 * is what says which side is which, and it is the only thing that needs to.
 */
function ContrastChips({ row }: { row: QueueResult }) {
  const contrast = row.result.contrast;
  if (!contrast?.intervention) {
    return (
      <span className="text-[12px] text-gray-500 dark:text-zinc-500">
        {contrastLabel(contrast)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap min-w-0">
      <span className="text-[12px] rounded-md px-2 py-0.5 text-gray-700 bg-gray-100 dark:text-zinc-300 dark:bg-[#1a1a1a]">
        {contrast.intervention}
      </span>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-600">
        vs
      </span>
      <span className="text-[12px] rounded-md px-2 py-0.5 text-gray-600 bg-gray-100 dark:text-zinc-400 dark:bg-[#1a1a1a]">
        {contrast.comparator}
      </span>
    </span>
  );
}

function ProgressLine({ row }: { row: QueueResult }) {
  // Only where the Review status badge does not already say it. `trial_needed`
  // printed "Answer the trial questions first" next to a badge reading "Trial
  // answers needed" — the same sentence twice on one row. `blocked` is the
  // case worth keeping: its badge says only "Blocked", and which of the two
  // reasons it is decides what a reviewer does next.
  if (!row.blocker || row.progress !== 'blocked') return null;
  // `block`, because the chips beside it are inline: left as a plain span the
  // blocker ran on from the end of "… vs Lumiracoxib 100 mg" and read as part
  // of the comparison.
  return (
    <span className={`block mt-0.5 text-[11px] ${STATUS_TONE[row.progress]}`}>
      {row.blocker}
    </span>
  );
}

export function ResultQueue({
  groups, activeResultId, query, onQuery, filter, onFilter, counts,
  onOpenTrial, onOpenResult, onManageComparisons, lede,
  comparisonNeeded, onClearFilters,
}: Props) {
  /**
   * Which outcome blocks are folded shut, keyed by study AND block — "Adverse
   * effects" exists under most studies, so the block key alone would fold every
   * study's at once.
   *
   * Open by default: a queue that hides rows until asked cannot be scanned, and
   * scanning is what it is for.
   */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const empty = groups.every(g => g.results.length === 0);
  const filtered = query.trim() !== '' || filter !== 'all';

  return (
    <div className="flex flex-col gap-4">
      <div className={`${SURFACE} px-5 py-4`}>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">Assessment queue</h1>
            <p className={`text-[13px] mt-1 ${MUTED}`}>{lede}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-600" />
              <input
                type="text"
                value={query}
                onChange={e => onQuery(e.target.value)}
                placeholder="Study, outcome or comparison"
                aria-label="Search by study, outcome or comparison"
                className="h-9 w-[300px] max-w-full text-[13px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg pl-8 pr-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {(Object.keys(FILTER_LABEL) as QueueFilter[]).map(key => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => onFilter(key)}
              className={[
                'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-semibold',
                filter === key
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
              ].join(' ')}
            >
              {FILTER_LABEL[key]}
              <span className={`ml-2 tabular-nums ${filter === key ? 'opacity-70' : 'text-gray-400 dark:text-zinc-600'}`}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Above the table, not below it. These studies have no results at all, so
          nothing in the table stands for them — a reviewer who reads a short queue
          and stops scrolling never learns why it is short. */}
      {comparisonNeeded.length > 0 && (
        <div className="border border-gray-200 dark:border-[#2a2a2a] rounded-xl bg-white dark:bg-[#111111] overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-500/5 border-b border-gray-200 dark:border-[#2a2a2a]">
            <div className="text-[13px] font-semibold text-gray-700 dark:text-zinc-300">
              Comparison needed · {comparisonNeeded.length} stud
              {comparisonNeeded.length === 1 ? 'y' : 'ies'}
            </div>
            <div className="text-[11.5px] text-gray-700 dark:text-zinc-400 mt-0.5">
              These studies have outcome rows but no comparison, so nothing under them can be
              assessed yet. Name the arms and their results become available.
            </div>
          </div>
          {comparisonNeeded.map(study => (
            <div key={study.documentId}
                 className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold dark:text-zinc-200">{study.label}</div>
                <div className="text-[11px] text-gray-500 dark:text-zinc-500">
                  {study.arms} arms · no comparison defined
                  {study.rows.length > 0
                    && ` · ${study.rows.length} row${study.rows.length === 1 ? '' : 's'} waiting`}
                </div>
                {/* Naming the rows turns "a study is blocked" into "these
                    three results are blocked", which is the difference between
                    a notice and a reason to act. */}
                {study.rows.slice(0, 4).map((row, i) => (
                  <div key={i} className="text-[11px] text-gray-500 dark:text-zinc-500 mt-0.5">
                    {[row.outcome, row.timepoint].filter(Boolean).join(' · ')}
                    {row.source && <span className="text-gray-400 dark:text-zinc-600">
                      {' · '}{row.source}</span>}
                  </div>
                ))}
                {study.rows.length > 4 && (
                  <div className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">
                    …and {study.rows.length - 4} more.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onManageComparisons(study.documentId)}
                className={`${BTN_PRIMARY} flex-none !px-2.5 !py-1 !text-[11.5px]`}
              >
                Define comparison →
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`${SURFACE} overflow-hidden`}>
        <p className="sr-only">
          Result assessments grouped by study. Domain labels show your current judgements.
        </p>
        <div className={`hidden md:grid items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-[#0d0d0d] border-b border-gray-200 dark:border-[#1a1a1a] text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 ${GRID}`}>
          <span>Study · outcome · comparison</span>
          {['D1', 'D2', 'D3', 'D4', 'D5'].map((d, i) => (
            <abbr
              key={d}
              title={DOMAIN_NAME[i]}
              className="text-center no-underline cursor-help"
            >
              {d}
            </abbr>
          ))}
          <span>Your overall</span>
          <span>Review status</span>
        </div>

        {empty && (
          <div className="px-6 py-12 text-center">
            <div className="text-[16px] font-bold text-gray-900 dark:text-zinc-200">
              {filtered ? 'No matching results' : 'Nothing to assess yet'}
            </div>
            <p className={`text-[13px] mt-2 ${MUTED}`}>
              {filtered
                ? 'Try another search, or go back to all results.'
                : 'Create results on Setup, and they appear here.'}
            </p>
            {/* A filter that hides everything looks identical to an empty
                project, and the reviewer cannot tell which they are looking at
                without undoing the filter they may not remember setting. */}
            {filtered && (
              <button
                type="button"
                onClick={onClearFilters}
                className={`${BTN} mt-4`}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {groups.map(group => group.results.length > 0 && (() => {
          // Said once on the header when every row shares it; moved down onto
          // the rows when they do not, because a header listing three
          // comparisons tells you nothing about which row is which.
          const contrasts = [...new Set(
            group.results.map(r => contrastLabel(r.result.contrast)))];
          const sharedContrast = contrasts.length === 1 ? contrasts[0] : '';
          const subGroups = subGroupsOf(group.results);
          // Said once beside the study's counts when every result shares it.
          // When they do not — a study with one row that recorded no population
          // and the rest that did — it stays on the rows, where the difference
          // is the whole point.
          const populations = [...new Set(
            group.results.map(r => (r.result.population ?? '').trim()))];
          const sharedPopulation = populations.length === 1 ? populations[0] : '';
          const completeCount = group.results.filter(r => r.progress === 'complete').length;
          // Trial answers are stored per study AND comparison, so a study with
          // several comparisons has several sets of them. One button here used
          // to open whichever comparison happened to sort first, which is an
          // arbitrary choice presented as no choice at all.
          const comparisons = [...new Map(group.results.map(r =>
            [r.result.contrast?.id ?? '',
             { id: r.result.contrast?.id ?? '', label: contrastLabel(r.result.contrast),
               count: 0 }])).values()]
            .map(c => ({
              ...c,
              count: group.results.filter(
                r => (r.result.contrast?.id ?? '') === c.id).length,
            }));
          return (
          <div key={group.documentId}>
            {/* A study heading in the house pattern: a dot, the name, a
                hairline, the counts. The imported wash (#f5f7fa) read as a
                faint lavender band against EviStream's neutral greys — it
                neither matched the product nor highlighted anything, which is
                the worst of both. The name and the rule do the separating. */}
            <div className="flex items-start gap-3 flex-wrap px-4 pt-4 pb-2.5 bg-white dark:bg-[#111111] border-t-2 border-t-gray-200 dark:border-t-[#242424] border-b border-b-gray-100 dark:border-b-[#1a1a1a] first:border-t-0 first:pt-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* The study is what a reviewer scans for, so it carries the
                      one accent this product has — blue, the same chip the
                      Documents search uses for the option in force. Bold black
                      on white was correct and invisible: it weighed the same
                      as everything around it. */}
                  <span className="text-[13px] font-semibold rounded-md px-2 py-0.5 text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30">
                    {group.label}
                  </span>
                  <span className="flex-1 min-w-[1rem]" />
                  <span className="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0">
                    <span className="tabular-nums">
                      {group.results.length} shown · {completeCount} complete
                    </span>
                    {sharedPopulation && ` · ${sharedPopulation}`}
                  </span>
                </div>
                {sharedContrast && (
                  <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1 ml-2">
                    {sharedContrast}
                  </div>
                )}
                {/* The seat, once. It belongs to the study — every form of it —
                    so repeating it on each result said the same sentence five
                    times and buried what each row actually needed. */}
                <div className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5 ml-2">
                  {group.seat === 'reviewer_1' ? 'You are reviewer 1 on this study'
                    : group.seat === 'reviewer_2' ? 'You are reviewer 2 on this study'
                      : group.seat === 'adjudicator' ? 'You adjudicate this study'
                        : 'No reviewer seat — your assessments are recorded as additional reviews'}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                <button
                  type="button"
                  aria-label={`Manage comparisons for ${group.label}`}
                  onClick={() => onManageComparisons(group.documentId)}
                  className={`${BTN} !px-2.5 !py-1 !text-[11.5px]`}
                >
                  Manage comparisons
                </button>
                {/* One button, as the instrument's workspace has it: a study
                    with several comparisons routes to a picker rather than
                    guessing which set of trial answers was meant. */}
                <button
                  type="button"
                  aria-label={`Trial answers for ${group.label}`}
                  onClick={() => onOpenTrial(
                    group.documentId,
                    comparisons.length === 1 ? (comparisons[0]?.id ?? '') : '')}
                  className={`${BTN} !px-2.5 !py-1 !text-[11.5px]`}
                >
                  Trial answers →
                </button>
              </div>
            </div>

            {subGroups.map(sub => {
              /**
               * One line when the block holds a single comparison, two levels
               * when it holds several.
               *
               * The heading exists to say the outcome ONCE for the comparisons
               * under it. A block with one comparison has nothing to factor
               * out, so a heading plus a single row would be two lines saying
               * what one line says — which is how a five-outcome study with one
               * comparison ends up twice as tall as it needs to be.
               */
              const heading = (
                <span className="flex items-baseline gap-2 flex-wrap min-w-0">
                  <span
                    title={sub.storedName}
                    className="text-[13.5px] font-semibold text-gray-800 dark:text-zinc-200 leading-snug"
                  >
                    {sub.name}
                  </span>
                  {sub.measurement && <SlotChip label="Measure" value={sub.measurement} />}
                  <SlotChip
                    label="Time"
                    value={sub.time || 'not specified'}
                    muted={!sub.time}
                  />
                </span>
              );

              const rowBody = (row: QueueResult, left: React.ReactNode) => (
                <button
                  key={row.result.id}
                  type="button"
                  onClick={() => onOpenResult(row.result.id)}
                  className={[
                    'w-full text-left border-b border-gray-100 dark:border-[#1a1a1a] px-4 py-2.5',
                    'md:grid md:items-center md:gap-3 hover:bg-gray-50 dark:hover:bg-[#141414]',
                    GRID,
                    activeResultId === row.result.id ? 'bg-gray-50 dark:bg-[#161616]' : '',
                  ].join(' ')}
                >
                  <span className="block min-w-0">
                    {left}
                    {/* Only what differs between the rows of this block. A slot
                        that is the same on all of them is already said above,
                        or is not worth a line. Chipped like Measure and Time,
                        because a bare "Overall" under a comparison reads as a
                        word about the comparison rather than as the population
                        slot — which is the one thing telling these rows apart. */}
                    {sub.varying.length > 0 && (
                      <span className="flex items-center gap-1.5 flex-wrap mt-1">
                        {sub.varying.map(slot => {
                          const value = (row.result[slot] ?? '').trim();
                          return (
                            <SlotChip
                              key={slot}
                              label={VARYING_LABEL[slot]}
                              value={value || 'not recorded'}
                              muted={!value}
                            />
                          );
                        })}
                      </span>
                    )}
                    <ProgressLine row={row} />
                  </span>

                {/* Stacked on a phone: a seven-column grid at 390px is unreadable. */}
                <span className="flex items-center gap-1.5 mt-1.5 md:hidden">
                  {row.severities.map((s, i) => (
                    <Dot key={i} severity={s ?? 'none'} domain={i} />
                  ))}
                  <span className={`text-[11.5px] font-semibold ml-1 ${STATUS_TONE[row.progress]}`}>
                    {PROGRESS_LABEL[row.progress]}
                  </span>
                  {/* The overall is a column on a wide screen and would other-
                      wise simply vanish on a phone. */}
                  {row.overall !== 'none' && (
                    <span className="text-[11.5px] font-semibold text-gray-600 dark:text-zinc-400">
                      {[SEVERITY_GLYPH[row.overall], SEVERITY_SHORT[row.overall]]
                      .filter(Boolean).join(' ')}
                    </span>
                  )}
                  {row.stale && row.progress !== 'stale' && <StaleMark />}
                </span>

                {row.severities.map((s, i) => (
                  <span key={i} className="hidden md:flex justify-center">
                    <Dot severity={s ?? 'none'} domain={i} />
                  </span>
                ))}
                <span className="hidden md:block">
                  <Badge tone={row.overall === 'none' ? 'info' : row.overall}>
                    {[SEVERITY_GLYPH[row.overall], SEVERITY_SHORT[row.overall]]
                      .filter(Boolean).join(' ')}
                  </Badge>
                </span>
                <span className="hidden md:block">
                  <Badge tone={STATUS_BADGE[row.progress]}>
                    {PROGRESS_LABEL[row.progress]}
                  </Badge>
                  {/* `stale` is a status in its own right now, ranked below
                      `complete` as the instrument's workspace ranks it. That
                      ranking loses the one case that matters most — a FINISHED
                      review whose identity moved under it — so the marker
                      stays for exactly that case. */}
                  {row.stale && row.progress !== 'stale' && <StaleMark />}
                </span>
              </button>
              );

              if (sub.rows.length === 1) {
                return (
                  <div key={sub.key}>
                    {rowBody(sub.rows[0], heading)}
                  </div>
                );
              }

              // Only a block with rows UNDER a heading can be folded. A
              // one-comparison block is already a single line, and an arrow on
              // it would offer to hide the line it sits on.
              const foldKey = `${group.documentId}::${sub.key}`;
              const isShut = !!collapsed[foldKey];
              return (
                <div key={sub.key}>
                  <button
                    type="button"
                    aria-expanded={!isShut}
                    onClick={() => setCollapsed(c => ({ ...c, [foldKey]: !c[foldKey] }))}
                    className="w-full flex items-center gap-3 flex-wrap text-left px-4 py-2 bg-gray-50 dark:bg-[#0d0d0d] border-b border-gray-100 dark:border-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-[#141414]"
                  >
                    {heading}
                    <span className="flex-1 min-w-[1rem]" />
                    <span className="flex items-center gap-1.5 flex-none text-[11px] text-gray-400 dark:text-zinc-600">
                      {isShut && (
                        <span className="tabular-nums">
                          {sub.rows.length} comparison{sub.rows.length === 1 ? '' : 's'}
                        </span>
                      )}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${isShut ? '-rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  {!isShut && sub.rows.map(row => rowBody(row, <ContrastChips row={row} />))}
                </div>
              );
            })}
          </div>
          );
        })())}
      </div>

      <div className={`flex items-start gap-3 flex-wrap border-t border-gray-200 dark:border-[#242424] bg-white dark:bg-[#0d0d0d] rounded-xl px-5 py-3.5 text-[12px] text-gray-500 dark:text-zinc-400 border border-gray-200`}>
        <span>
          <strong>✓ low · ! some concerns · ▲ high · not yet judged.</strong> Every judgement
          carries a symbol as well as a colour. These are <em>your</em> judgements of each result —
          there is no such thing as one risk-of-bias judgement for a paper.
        </span>
        <a
          href="https://www.riskofbias.info/welcome/rob-2-0-tool/current-version-of-rob-2"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none font-semibold text-gray-700 dark:text-zinc-300 hover:underline whitespace-nowrap"
        >
          RoB 2 instrument &amp; guidance ↗
        </a>
      </div>
    </div>
  );
}
