'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: 'Map fields' },
  { n: 2, label: 'Choose comparison' },
  { n: 3, label: 'Plot' },
  { n: 4, label: 'Diagnostics' },
];

export function StepNav({
  step,
  furthest,
  onGo,
}: {
  step: Step;
  /** How far the reviewer has legitimately got — later steps stay unreachable. */
  furthest: Step;
  onGo: (s: Step) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      {STEPS.map((s, i) => {
        const active = step === s.n;
        const done = furthest > s.n && step !== s.n;
        const reachable = s.n <= furthest;
        return (
          <div key={s.n} className="flex items-center gap-2.5">
            {i > 0 && <div className="w-9 h-px bg-gray-200 dark:bg-[#2a2a2a]" />}
            <button
              type="button"
              onClick={() => reachable && onGo(s.n)}
              disabled={!reachable}
              className={cn(
                'flex items-center gap-2 px-0.5 py-1 rounded transition-opacity',
                reachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
              )}
            >
              <span
                className={cn(
                  'w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-semibold border',
                  active && 'bg-[#0a0a0a] text-white border-[#0a0a0a] dark:bg-white dark:text-black dark:border-white',
                  done && 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-900/60',
                  !active && !done && 'bg-white text-gray-400 border-gray-200 dark:bg-[#111111] dark:text-zinc-600 dark:border-[#2a2a2a]',
                )}
              >
                {done ? <Check className="h-3 w-3" /> : s.n}
              </span>
              <span
                className={cn(
                  'text-[13px]',
                  active
                    ? 'font-semibold text-gray-900 dark:text-white'
                    : 'font-medium text-gray-500 dark:text-zinc-400',
                )}
              >
                {s.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
