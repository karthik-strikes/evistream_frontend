'use client';

import { cn } from '@/lib/utils';

export type FullTextAvailability = 'pdf' | 'pmc' | 'none' | 'checking' | 'unknown';

/** Small dot + label indicator for a reference's predicted open-access
 * status — shared by the RIS and EndNote import dialogs so both previews
 * read the same way. 'pdf'/'pmc'/'none' come straight from
 * fulltext_service.probe_full_text_availability; 'unknown' means the probe
 * request itself failed (import may still find something — not the same
 * as 'none'). */
export function StatusPill({ status }: { status?: FullTextAvailability }) {
  const map = {
    pdf: ['bg-emerald-400', 'text-emerald-600 dark:text-emerald-400', 'Open access'],
    pmc: ['bg-sky-400', 'text-sky-600 dark:text-sky-400', 'PMC full text'],
    none: ['bg-amber-400', 'text-amber-600 dark:text-amber-400', 'Needs PDF'],
    unknown: ['bg-gray-300 dark:bg-zinc-600', 'text-gray-400 dark:text-zinc-500', 'Will try'],
    checking: ['bg-gray-300 dark:bg-zinc-600', 'text-gray-400 dark:text-zinc-500', 'checking…'],
  } as const;
  const [dot, text, label] = map[status || 'checking'];
  return (
    <span className={cn('shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium mt-0.5', text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dot, status === 'checking' && 'animate-pulse')} />
      {label}
    </span>
  );
}
