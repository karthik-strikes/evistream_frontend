'use client';

/**
 * Conditional questions in the field editor: a one-line summary of the rule
 * and a way into the Question logic map, where rules are made and removed.
 * (Rules are drawn on the map, not built from dropdowns here.)
 */

import React from 'react';
import { GitBranch } from 'lucide-react';
import type { FieldCondition } from '@/types/api';

export function ConditionSummary({
  condition, parentLabel, subject, blockedReason, errors = [], onOpenLogic,
}: {
  condition: FieldCondition | null | undefined;
  parentLabel?: string;
  /** "this question" / "this column" / "the whole table". */
  subject: string;
  blockedReason?: string;
  errors?: string[];
  onOpenLogic?: () => void;
}) {
  const cond = condition && condition.field ? condition : null;
  const open = onOpenLogic && (
    <button type="button" onClick={onOpenLogic}
      className="font-medium text-slate-700 underline decoration-dotted underline-offset-2 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white">
      {cond ? 'Edit in logic map' : 'Open logic map'}
    </button>
  );
  if (blockedReason) {
    return <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-500"><GitBranch className="h-3 w-3 shrink-0" />{blockedReason}</p>;
  }
  if (!cond) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 dark:text-zinc-500">
        <GitBranch className="h-3 w-3 shrink-0" /> Always asked. {open && <>To make it a follow-up, {open}.</>}
      </p>
    );
  }
  const vals = (cond.values || []).map(v => `“${v}”`).join(' or ') || '…';
  const who = parentLabel || cond.field;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:border-[#262626] dark:bg-[#131313] dark:text-zinc-400">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <GitBranch className="h-3 w-3 shrink-0" />
        <span>Asked only when <span className="font-medium text-slate-800 dark:text-zinc-200">{who}</span>{cond.from === 'row' ? ' (same row)' : ''} is <span className="font-medium text-slate-800 dark:text-zinc-200">{vals}</span>. Otherwise {subject} is saved as NA.</span>
        {open}
      </p>
      {errors.map(e => <p key={e} className="mt-1 text-red-500">{e}</p>)}
    </div>
  );
}

/** The parent side: which follow-ups this question controls. */
export function ControlsFollowUps({ uses, onOpen }: {
  uses: Array<{ label: string; target: string; values: string[] }>;
  onOpen?: (target: string) => void;
}) {
  if (!uses.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500 dark:text-zinc-400">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span>Controls {uses.length} follow-up{uses.length === 1 ? '' : 's'}:</span>
      {uses.map(u => (
        <button key={u.label} type="button" onClick={() => onOpen?.(u.target)} disabled={!onOpen}
          className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700 transition-colors hover:bg-slate-200 disabled:hover:bg-slate-100 dark:bg-[#1a1a1a] dark:text-zinc-300 dark:hover:bg-[#222]">
          {u.label} <span className="text-slate-400 dark:text-zinc-500">if {u.values.join(' / ') || '…'}</span>
        </button>
      ))}
    </div>
  );
}
