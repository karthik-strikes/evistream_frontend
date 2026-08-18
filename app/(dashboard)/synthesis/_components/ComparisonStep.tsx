'use client';

import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Info, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EFFECT_LABEL, MODEL_LABEL, type EffectMeasure, type PoolingModel,
} from '@/lib/metaAnalysis';
import type { ExcludedStudy, Facet } from '../_lib/buildStudies';
import { groupExclusions } from '../_lib/buildStudies';

export interface LedgerInput {
  matched: number;
  included: number;
  corrected: number;
  multiArm: Array<{ groupKey: string; documentId: string; label: string; arms: number }>;
  excluded: ExcludedStudy[];
}

/**
 * Study labels come from the document filename, and a lot of real uploads are
 * named with the paper's full title — 200+ characters that bury the sentence
 * they sit in. Truncate for reading; the full title stays in the tooltip.
 */
function shorten(label: string, max = 64): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max).trimEnd()}…`;
}

/**
 * Pick the comparison, then account for every study that matched it.
 *
 * The ledger is the point of this screen. A reviewer has to be able to say, at
 * peer review, why each study is in or out — so the counts here are derived from
 * the same pass that builds the plot, and the two can never disagree.
 */
export function ComparisonStep({
  facets,
  outcome, onOutcome,
  comparison, onComparison,
  timepoint, onTimepoint,
  timepointLocked,
  timepointSourceColumn,
  outcomeColumn,
  comparisonSourceColumn,
  measure, onMeasure, measureOptions,
  model, onModel,
  ledger,
  onNext,
}: {
  facets: { outcomes: Facet[]; comparisons: Facet[]; timepoints: Facet[] };
  outcome: string; onOutcome: (v: string) => void;
  comparison: string; onComparison: (v: string) => void;
  timepoint: string; onTimepoint: (v: string) => void;
  timepointLocked: boolean;
  timepointSourceColumn: string | null;
  outcomeColumn: string | null;
  comparisonSourceColumn: string | null;
  measure: EffectMeasure; onMeasure: (m: EffectMeasure) => void; measureOptions: EffectMeasure[];
  model: PoolingModel; onModel: (m: PoolingModel) => void;
  ledger: LedgerInput;
  onNext: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = groupExclusions(ledger.excluded);

  const selectClass =
    'h-9 border border-gray-200 rounded-lg bg-white text-[13px] px-2 text-gray-900 ' +
    'dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none max-w-full';

  const countText = (f: Facet[], v: string) => {
    const hit = f.find(x => x.value === v);
    return hit ? `${hit.documents} ${hit.documents === 1 ? 'study' : 'studies'}` : '';
  };

  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
        <div className="text-[15px] font-semibold mb-3.5 dark:text-white">Define the comparison</div>

        <div className="grid grid-cols-[110px_minmax(0,340px)_auto] gap-3 items-center">
          <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">Outcome</span>
          <select value={outcome} onChange={e => onOutcome(e.target.value)} className={selectClass}>
            {facets.outcomes.map(o => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
          <span className="text-[12.5px] text-gray-400 dark:text-zinc-600">
            {countText(facets.outcomes, outcome)}
          </span>

          <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">Comparison</span>
          <select value={comparison} onChange={e => onComparison(e.target.value)} className={selectClass}>
            {facets.comparisons.map(c => (
              <option key={c.value} value={c.value}>{c.value}</option>
            ))}
          </select>
          <span className="text-[12.5px] text-gray-400 dark:text-zinc-600">
            {countText(facets.comparisons, comparison)}
          </span>

          <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">Timepoint</span>
          {timepointLocked ? (
            <div className="h-9 border border-gray-200 rounded-lg bg-gray-50 flex items-center gap-2 px-2.5 text-[13px] text-gray-500 dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-400">
              <Lock className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{timepoint || '—'}</span>
            </div>
          ) : (
            <select value={timepoint} onChange={e => onTimepoint(e.target.value)} className={selectClass}>
              <option value="">Any timepoint</option>
              {facets.timepoints.map(t => (
                <option key={t.value} value={t.value}>{t.value}</option>
              ))}
            </select>
          )}
          <span className="text-[12.5px] text-gray-400 dark:text-zinc-600">
            {countText(facets.timepoints, timepoint)}
          </span>
        </div>

        {timepointLocked && (
          <div className="text-xs text-gray-400 dark:text-zinc-600 mt-2 leading-relaxed">
            Each outcome in{' '}
            <span className="font-mono text-[11px]">{outcomeColumn ?? 'this form'}</span> implies a
            single timepoint, so it follows the outcome — contradictory selections aren&rsquo;t
            possible.
          </div>
        )}
        {!timepointLocked && timepointSourceColumn && (
          <div className="text-xs text-gray-400 dark:text-zinc-600 mt-2 leading-relaxed">
            Timepoints read from{' '}
            <span className="font-mono text-[11px]">{timepointSourceColumn}</span>.
          </div>
        )}
        {comparisonSourceColumn && (
          <div className="text-xs text-gray-400 dark:text-zinc-600 mt-1 leading-relaxed">
            Comparisons read from{' '}
            <span className="font-mono text-[11px]">{comparisonSourceColumn}</span>.
          </div>
        )}

        <div className="flex gap-3 items-center mt-3.5 pt-3.5 border-t border-gray-100 dark:border-[#1f1f1f] flex-wrap">
          <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">Effect</span>
          <select
            value={measure}
            onChange={e => onMeasure(e.target.value as EffectMeasure)}
            className={selectClass}
          >
            {measureOptions.map(m => (
              <option key={m} value={m}>{EFFECT_LABEL[m]}</option>
            ))}
          </select>
          <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300 ml-2">Model</span>
          <select
            value={model}
            onChange={e => onModel(e.target.value as PoolingModel)}
            className={selectClass}
          >
            <option value="random">{MODEL_LABEL.random}</option>
            <option value="fixed">{MODEL_LABEL.fixed}</option>
          </select>
        </div>
      </div>

      {/* ── Inclusion ledger ─────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
        <div className="text-[15px] font-semibold mb-0.5 dark:text-white">Inclusion ledger</div>
        <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-3.5">
          Every matching study is accounted for. Nothing is dropped silently.
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight dark:text-white">{ledger.matched}</span>
          <span className="text-[13px] text-gray-700 dark:text-zinc-300">
            {ledger.matched === 1 ? 'study matches' : 'studies match'} this outcome, comparison and
            timepoint
          </span>
        </div>

        <div className="mt-3 flex flex-col">
          <LedgerRow icon={<Check className="h-3 w-3 text-green-600 dark:text-green-500" />}>
            <span className="text-[13px] font-semibold dark:text-white">
              {ledger.included} included
            </span>
          </LedgerRow>

          {ledger.corrected > 0 && (
            <LedgerNote>
              {ledger.corrected} of the {ledger.included} {ledger.corrected === 1 ? 'has' : 'have'} zero
              events in one arm — kept in with a continuity correction (+0.5), disclosed under the plot
            </LedgerNote>
          )}

          {ledger.multiArm.map(m => (
            <LedgerNote key={m.groupKey} warn>
              <span title={m.label} className="font-medium">{shorten(m.label)}</span> contributes{' '}
              {m.arms} treatment arms — its comparator arm is shared across those comparisons, so the
              control group is counted once per comparison
            </LedgerNote>
          ))}

          {groups.map(g => (
            <div key={g.reason} className="border-t border-gray-100 dark:border-[#1f1f1f]">
              <button
                type="button"
                onClick={() => setOpen(o => ({ ...o, [g.reason]: !o[g.reason] }))}
                className="flex items-center gap-2.5 w-full text-left cursor-pointer py-2.5"
              >
                <ChevronRight
                  className={cn(
                    'h-3 w-3 flex-shrink-0 text-gray-400 dark:text-zinc-600 transition-transform',
                    open[g.reason] && 'rotate-90',
                  )}
                />
                <span className="text-[13px] font-semibold text-red-700 dark:text-red-400">
                  {g.studies.length} excluded
                </span>
                <span className="text-[13px] text-gray-500 dark:text-zinc-400">— {g.text}</span>
              </button>
              {open[g.reason] && (
                <div className="flex gap-2 flex-wrap pb-3 pl-5">
                  {g.studies.map(s => (
                    <span
                      key={s.key}
                      title={s.column ? `${s.label}\ncolumn: ${s.column}` : s.label}
                      className="flex items-center gap-1.5 max-w-full text-xs text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] rounded-full px-2.5 py-1"
                    >
                      <span className="truncate max-w-[280px]">{shorten(s.label, 48)}</span>
                      {s.column && (
                        <span className="font-mono text-[10px] text-gray-400 dark:text-zinc-600">
                          {s.column}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="cursor-pointer text-[13px] font-semibold bg-[#0a0a0a] text-white rounded-md px-4.5 py-2.5 px-5 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
        >
          View forest plot →
        </button>
      </div>
    </div>
  );
}

function LedgerRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5 border-t border-gray-100 dark:border-[#1f1f1f]">
      <span className="flex-shrink-0">{icon}</span>
      {children}
    </div>
  );
}

function LedgerNote({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-2 pl-5 border-t border-gray-100 dark:border-[#1f1f1f]">
      {warn ? (
        <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
      ) : (
        <Info className="h-3 w-3 flex-shrink-0 mt-0.5 text-gray-400 dark:text-zinc-600" />
      )}
      <span className="text-[12.5px] text-gray-500 dark:text-zinc-400 leading-relaxed">{children}</span>
    </div>
  );
}
