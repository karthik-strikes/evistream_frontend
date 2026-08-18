'use client';

import { useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  classifyVariability,
  DEFAULT_VARIABILITY_ACTION,
  isMedian,
  VARIABILITY_FORMULA,
  VARIABILITY_LABEL,
  type CentralTendencyAction,
  type VariabilityAction,
} from '../_lib/buildStudies';

export interface MeasureTally {
  /** The declared option text exactly as the form wrote it. */
  measure: string;
  documents: number;
}

/**
 * Resolve how each reported spread enters the analysis.
 *
 * The rows are the `variability_measure` values actually present in the
 * extracted data, with real document counts — not a fixed list. A measure the
 * corpus never reports does not appear, and one the app has never heard of
 * appears as "Unrecognised" rather than being quietly converted with the wrong
 * formula.
 *
 * These choices are methods-section decisions, which is why the card states the
 * formula it will apply rather than just the name of the option.
 */
export function UnitsCard({
  measures,
  actions,
  onAction,
  centralTendencies,
  centralActions,
  onCentralAction,
  variabilityColumn,
  excludedCount,
  excludedStudies,
}: {
  measures: MeasureTally[];
  actions: Record<string, VariabilityAction>;
  onAction: (measure: string, action: VariabilityAction) => void;
  centralTendencies: MeasureTally[];
  centralActions: Record<string, CentralTendencyAction>;
  onCentralAction: (measure: string, action: CentralTendencyAction) => void;
  variabilityColumn: string | null;
  excludedCount: number;
  excludedStudies: string[];
}) {
  const [open, setOpen] = useState(false);

  if (measures.length === 0 && centralTendencies.length === 0) return null;

  const selectClass =
    'h-8 border border-gray-200 rounded-md bg-white text-[12.5px] px-2 text-gray-900 ' +
    'dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none';

  return (
    <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="text-[15px] font-semibold dark:text-white">Resolve units</div>
      <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1 leading-relaxed">
        These studies report their spread in different ways. Decide how each one enters the analysis —
        these choices belong in your methods section.
      </div>

      <div className="mt-3 border border-gray-100 dark:border-[#1f1f1f] rounded-lg overflow-hidden">
        {measures.map(m => {
          const kind = classifyVariability(m.measure);
          const action = actions[m.measure] ?? DEFAULT_VARIABILITY_ACTION[kind];
          const unknown = kind === 'UNKNOWN' || kind === 'NA';
          return (
            <div
              key={m.measure}
              className={cn(
                'grid grid-cols-[minmax(0,180px)_80px_minmax(0,220px)_1fr] gap-3 items-center px-3 py-2 border-b border-gray-100 dark:border-[#1f1f1f]',
                unknown && 'bg-gray-50 dark:bg-[#0d0d0d]',
              )}
            >
              <span className="font-mono text-[12.5px] font-semibold text-gray-900 dark:text-white truncate" title={m.measure}>
                {VARIABILITY_LABEL[kind] === 'Unrecognised measure' ? m.measure : VARIABILITY_LABEL[kind]}
              </span>
              <span className="text-xs text-gray-500 dark:text-zinc-500">
                {m.documents} {m.documents === 1 ? 'study' : 'studies'}
              </span>
              <select
                value={action}
                onChange={e => onAction(m.measure, e.target.value as VariabilityAction)}
                className={selectClass}
              >
                <option value="use">Use as-is</option>
                <option value="convert">Convert to SD</option>
                <option value="approximate">Approximate</option>
                <option value="exclude">Exclude from analysis</option>
              </select>
              <span className="font-mono text-[11.5px] text-gray-400 dark:text-zinc-600 truncate" title={VARIABILITY_FORMULA[kind]}>
                {VARIABILITY_FORMULA[kind]}
              </span>
            </div>
          );
        })}

        {centralTendencies.map(m => {
          const median = isMedian(m.measure);
          const action = centralActions[m.measure] ?? (median ? 'approximate' : 'use');
          return (
            <div
              key={`ct-${m.measure}`}
              className="grid grid-cols-[minmax(0,180px)_80px_minmax(0,220px)_1fr] gap-3 items-center px-3 py-2 border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0"
            >
              <span className="font-mono text-[12.5px] font-semibold text-gray-900 dark:text-white truncate">
                {m.measure}
              </span>
              <span className="text-xs text-gray-500 dark:text-zinc-500">
                {m.documents} {m.documents === 1 ? 'study' : 'studies'}
              </span>
              {median ? (
                <select
                  value={action}
                  onChange={e => onCentralAction(m.measure, e.target.value as CentralTendencyAction)}
                  className={selectClass}
                >
                  <option value="approximate">Approximate (mean ≈ median)</option>
                  <option value="exclude">Exclude from analysis</option>
                </select>
              ) : (
                <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 pl-2">Use as-is</span>
              )}
              <span className="font-mono text-[11.5px] text-gray-400 dark:text-zinc-600 truncate">
                {median ? "medians can't be pooled directly" : 'central tendency, used unchanged'}
              </span>
            </div>
          );
        })}
      </div>

      {variabilityColumn && (
        <div className="flex items-start gap-2 mt-2.5 text-xs text-gray-500 dark:text-zinc-500 leading-relaxed">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            <span className="font-mono text-[11.5px]">{variabilityColumn}</span> is read as text, so
            interval bounds are parsed from strings like &ldquo;1.2 to 3.4&rdquo; before conversion.
            Anything that can&rsquo;t be parsed is listed in the exclusion ledger rather than dropped.
          </span>
        </div>
      )}

      {excludedCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 mt-2.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
            {excludedCount} {excludedCount === 1 ? 'study' : 'studies'} excluded by these choices —
            review {excludedCount === 1 ? 'it' : 'them'}
          </button>
          {open && (
            <div className="flex gap-2 flex-wrap mt-2 pl-5">
              {excludedStudies.map(name => (
                <span
                  key={name}
                  className="text-xs text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] rounded-full px-2.5 py-1"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
