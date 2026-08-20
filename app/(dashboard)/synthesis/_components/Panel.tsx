'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PanelTone = 'neutral' | 'caution' | 'alert';

/**
 * A collapsible card with a one-line summary.
 *
 * Step 3 accumulated four stacked cards of prose — the plot, the absolute effect,
 * the design check, the methods — and a reviewer scrolling past three explanations
 * to reach the fourth reads none of them. Collapsed, each card still states its
 * conclusion in one line, so nothing is hidden: the summary is the finding, and
 * opening it shows the working.
 *
 * `tone` exists so a blocking design guard can be visible as one without being
 * expanded — the colour carries the severity while the detail stays folded.
 */
export function Panel({
  title,
  summary,
  tone = 'neutral',
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Shown whether open or closed. One line — it is the card's conclusion. */
  summary: string;
  tone?: PanelTone;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        'border rounded-lg mt-4',
        tone === 'alert'
          ? 'border-red-200 bg-red-50/40 dark:border-red-900/60 dark:bg-red-500/[0.03]'
          : tone === 'caution'
            ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-500/[0.03]'
            : 'border-border bg-white dark:bg-[#111111] dark:border-[#1f1f1f]',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-start gap-2 text-left cursor-pointer px-4 py-3"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 mt-1 flex-shrink-0 text-gray-400 dark:text-zinc-600 transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold dark:text-white">{title}</span>
          <span className="block text-[12.5px] text-gray-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
            {summary}
          </span>
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
