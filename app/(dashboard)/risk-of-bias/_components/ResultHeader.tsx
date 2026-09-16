'use client';

/**
 * Which estimate this assessment is about — all eight slots, always visible.
 *
 * Not behind an expander. A reviewer who cannot see which result they are
 * judging can answer 5.2 — "were the reported results selected from multiple
 * analyses?" — about the wrong one, and nothing downstream would ever catch it.
 * The page this replaces showed a single composite string built by joining an
 * outcome name, a timepoint and a comparison with a separator, under which an
 * intention-to-treat estimate and a per-protocol estimate of the same outcome
 * were the same target.
 *
 * Slots that hold a written default rather than something the trial reported are
 * marked, because "Overall population" is what we filled in when no source form
 * had a population column — not a finding.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { identitySlots, type ResultIdentity } from '../_lib/robIdentity';

interface Props {
  result: ResultIdentity;
  studyLabel: string;
  /** Design line — "Parallel-group RCT", NCT number, and so on, when known. */
  studyMeta?: string;
  measurementInferred?: boolean;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  seatText: string;
  progressText: string;
  /** True when the identity has changed since this assessment was made. */
  stale?: boolean;
}

export function ResultHeader({
  result, studyLabel, studyMeta, measurementInferred,
  position, total, onPrev, onNext, seatText, progressText, stale,
}: Props) {
  const slots = identitySlots(result, measurementInferred);

  return (
    <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="flex items-start gap-4 flex-wrap px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold tracking-tight dark:text-white">{studyLabel}</div>
          {studyMeta && (
            <div className="text-[12px] text-gray-500 dark:text-zinc-500 mt-0.5">{studyMeta}</div>
          )}
        </div>
        <div className="text-right flex-none">
          <div className="text-[9px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
            Result
          </div>
          <div className="text-[12px] font-mono text-gray-600 dark:text-zinc-400">
            {position} of {total}
          </div>
          <div className="flex items-center gap-1 justify-end mt-1.5">
            <button
              type="button"
              onClick={onPrev}
              disabled={total < 2}
              aria-label="Previous result"
              className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#2a2a2a] p-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={total < 2}
              aria-label="Next result"
              className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#2a2a2a] p-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-2.5 px-4 py-3.5 mt-3 border-t border-gray-100 dark:border-[#1a1a1a] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {slots.map(slot => (
          <div key={slot.label} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
                {slot.label}
              </span>
              {slot.tag && (
                <span className={[
                  'text-[9px] font-mono rounded px-1 py-px',
                  slot.isDefault
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-500',
                ].join(' ')}>
                  {slot.tag}
                </span>
              )}
            </div>
            <div className="text-[12.5px] font-medium mt-0.5 break-words dark:text-zinc-200">
              {slot.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] text-[11.5px] text-gray-500 dark:text-zinc-500">
        <span><strong className="font-semibold">RoB 2 · parallel group</strong> · 22 Aug 2019 · effect of assignment</span>
        <span className="flex-1" />
        <span>{seatText}</span>
        <span>{progressText}</span>
      </div>

      {stale && (
        <div className="flex items-start gap-2 px-4 py-2.5 border-t border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/5 text-[12px] text-amber-900 dark:text-amber-300">
          <span aria-hidden className="font-bold">!</span>
          <span>
            This result&rsquo;s identity was corrected after the assessment was made. The answers are
            kept as they were — check that they still describe the estimate above.
          </span>
        </div>
      )}
    </div>
  );
}
