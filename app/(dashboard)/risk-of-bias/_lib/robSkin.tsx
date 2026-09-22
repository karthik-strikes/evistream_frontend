'use client';

/**
 * This feature's visual language, in one place.
 *
 * **EviStream's own scale, not the design mock's.** The mock
 * (`RoB Redesign v2.dc.html`) was adopted literally to begin with — its navy
 * `#172b46`, its cool greys `#dfe4eb`/`#cbd3de`, its warm notice families —
 * and every one of them read as a foreign tint beside the rest of the product,
 * which is monochrome-first with blue as its single accent. The mock's
 * *structure* was worth copying; its palette was not. Tailwind's grey scale
 * and the shared `components/ui/badge.tsx` are the source now.
 *
 * Colour still means something, and only these things:
 *   - the RoB 2 judgements — emerald / amber / red, because the instrument is
 *     reported as a traffic light and Cochrane's own figures use those three;
 *   - `attention` / `critical` from the shared badge, which encode required
 *     human action;
 *   - blue, once, on a study name — the product's single accent.
 * Everything else is grey.
 *
 * One module because the alternative is fifteen files drifting apart: the
 * queue ended up with its own copy of these tokens once already, and it had
 * diverged from this file before anyone noticed.
 *
 * Every token carries a dark counterpart.
 */

import type React from 'react';

export const SURFACE =
  'bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl';

/** `.subtle` — the one grey most secondary text uses. */
export const MUTED = 'text-gray-500 dark:text-zinc-500';

/** `.eyebrow` — 11px, heavy, wide-tracked, uppercase. */
export const EYEBROW =
  'text-[11px] font-bold tracking-[0.09em] uppercase text-gray-500 dark:text-zinc-600';

export const BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 '
  + 'dark:border-[#2a2a2a] bg-white dark:bg-transparent px-3 py-1.5 text-[12.5px] font-semibold '
  + 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] '
  + 'disabled:opacity-40';

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-900 '
  + 'bg-gray-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-gray-800 '
  + 'dark:border-white dark:bg-white dark:text-gray-900 dark:hover:bg-zinc-200 '
  + 'disabled:opacity-40 disabled:cursor-not-allowed';

/** `.input` — 40px tall, its own border, a readable placeholder. */
export const INPUT =
  'w-full min-h-[40px] rounded-[7px] border border-gray-300 dark:border-[#2a2a2a] '
  + 'bg-white dark:bg-[#0d0d0d] px-[11px] py-[9px] text-[13px] text-gray-800 '
  + 'dark:text-zinc-200 placeholder:text-gray-400 focus:outline-none';

export type Tone = 'low' | 'some' | 'high' | 'info';

/** `.badge` — the three judgements plus a neutral. */
export const BADGE: Record<Tone, string> = {
  low: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-900/50',
  some: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-900/50',
  high: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-900/50',
  // Neutral, deliberately. Blue is this product's single accent and the study
  // name now wears it; a status with no meaning of its own must not compete
  // with the thing a reviewer is scanning for.
  info: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-zinc-400 dark:bg-[#1a1a1a] dark:border-[#2a2a2a]',
};

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full border px-2.5 py-1 whitespace-nowrap ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

/** `.notice` — a statement the reader must not skim past. Three families. */
export const NOTICE: Record<'info' | 'warning' | 'success', string> = {
  info: 'border border-gray-200 bg-gray-100 text-gray-700 dark:border-sky-900/50 dark:bg-sky-500/5 dark:text-sky-300',
  warning: 'border border-gray-200 bg-gray-50 text-gray-700 dark:border-[#2a2a2a] dark:bg-gray-500/5 dark:text-zinc-300',
  success: 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-500/5 dark:text-emerald-300',
};

export const NOTICE_BOX = 'rounded-[9px] px-4 py-[13px] text-[13px] leading-relaxed';

/** `.shared-box` — a quoted, read-only block inside a panel. */
export const SHARED_BOX =
  'rounded-[9px] border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3.5';

/** `.routed` — dashed, because it is what is NOT being asked. */
export const ROUTED =
  'rounded-[9px] border border-dashed border-gray-300 dark:border-[#2a2a2a] '
  + 'bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3 text-[12px] text-gray-500 dark:text-zinc-400';

/** `.question` — one card per signalling question. */
export const QUESTION_CARD =
  'rounded-[10px] border border-gray-200 dark:border-[#242424] bg-white dark:bg-[#0d0d0d] p-5 min-w-0';

/** `.qid` — the question number above its text. */
export const QID =
  'block text-[11px] font-bold tracking-[0.05em] text-gray-500 dark:text-zinc-500 mb-1.5';

/** `.answer` — the answer chips. Checked is solid navy, not a tint. */
export const ANSWER =
  'inline-flex items-center gap-2 cursor-pointer rounded-[7px] border border-gray-200 '
  + 'dark:border-[#2a2a2a] bg-white dark:bg-[#111111] min-h-[40px] px-2.5 py-2 text-[12px] '
  + 'text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]';
export const ANSWER_ON =
  'inline-flex items-center gap-2 cursor-pointer rounded-[7px] border border-gray-900 '
  + 'bg-gray-900 min-h-[40px] px-2.5 py-2 text-[12px] font-semibold text-white '
  + 'dark:border-white dark:bg-white dark:text-gray-900';

/** `.judgement` — the big derived label. */
export const JUDGEMENT: Record<'low' | 'some' | 'high' | 'none', string> = {
  low: 'text-emerald-700 dark:text-emerald-400',
  some: 'text-amber-700 dark:text-amber-400',
  high: 'text-red-700 dark:text-red-400',
  none: 'text-gray-500 dark:text-zinc-500',
};

/** `.identity` — the result header wears the instrument's accent. */
export const IDENTITY_TOP = 'border-t-[3px] border-t-gray-900 dark:border-t-gray-900';
