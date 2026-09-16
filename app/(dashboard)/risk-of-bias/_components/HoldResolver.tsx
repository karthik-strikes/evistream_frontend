'use client';

/**
 * The way out of a held result.
 *
 * A result is held when the comparison it is about cannot be derived — a trial
 * with three arms, or two with no arm that reads as a control. That is a genuine
 * question and the machine is right not to guess it: an arm name cannot say what
 * it was compared against, and guessing inverts every estimate that points here.
 *
 * What was wrong was stating the question and offering nothing. Every control on
 * the screen was dead, with the decision named on a different screen that had no
 * control for it either. The decision belongs where the reviewer hits it.
 *
 * **One control, never two.** Where the study already has comparisons on
 * record, the only question left is which of them this result is about — so
 * that is the only thing asked. The arm pickers appear only when the study has
 * no comparison at all, because offering both at once invites somebody to
 * re-describe a comparison that already exists, which is how a study ended up
 * with two records of the same pair.
 *
 * The order of the two arms is the direction of effect, and it is stated:
 * swapping them turns RR 1.84 favouring the drug into RR 0.54 favouring placebo.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { RobContrast } from '@/services/rob.service';

interface Props {
  contrasts: RobContrast[];
  busy: boolean;
  /** `arms` is sent only when the chosen comparison has no direction yet. */
  onResolve: (contrastId: string, arms?: { intervention: string; comparator: string }) => void;
}

const SELECT =
  'h-8 max-w-full text-[12px] border border-amber-300 dark:border-amber-900/60 rounded-lg px-2 '
  + 'bg-white dark:bg-[#0d0d0d] text-gray-900 dark:text-zinc-200 focus:outline-none';

export function HoldResolver({ contrasts, busy, onResolve }: Props) {
  const resolved = contrasts.filter(c => c.intervention);
  // Only when nothing is settled yet. A study that already has a comparison
  // needs picking, not describing.
  const open = resolved.length === 0
    ? contrasts.find(c => !c.intervention && (c.arms ?? []).length > 1)
    : undefined;

  const suggested = open?.suggested_comparator ?? '';
  const [intervention, setIntervention] = useState('');
  // The comparator starts on the arm that reads as a control, where there is
  // exactly one. It is a starting point, not an answer — both sides stay
  // editable, and the comparison is unresolved until somebody confirms it.
  const [comparator, setComparator] = useState(suggested);

  if (resolved.length === 0 && !open) {
    return (
      <div className="mt-1.5 pl-6 text-[11.5px]">
        This study has no comparison on record yet. Re-derive the project on{' '}
        <strong>Setup &amp; results</strong> to propose one from the outcome forms.
      </div>
    );
  }

  return (
    <div className="mt-2.5 pl-6 flex flex-col gap-2">
      {resolved.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="sr-only" htmlFor="hold-pick">Which comparison this result is about</label>
          <select
            id="hold-pick"
            defaultValue=""
            disabled={busy}
            onChange={e => { if (e.target.value) onResolve(e.target.value); }}
            className={SELECT}
          >
            <option value="">Which comparison is this result about?</option>
            {resolved.map(c => (
              <option key={c.id} value={c.id}>{c.intervention} vs {c.comparator}</option>
            ))}
          </select>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
      )}

      {open && (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="hold-int" className="block text-[10px] font-semibold uppercase tracking-wider mb-0.5">
              Intervention
            </label>
            <select id="hold-int" value={intervention} disabled={busy}
                    onChange={e => setIntervention(e.target.value)} className={SELECT}>
              <option value="">Choose an arm</option>
              {(open.arms ?? []).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <span className="text-[11.5px] pb-1.5">vs</span>
          <div>
            <label htmlFor="hold-cmp" className="block text-[10px] font-semibold uppercase tracking-wider mb-0.5">
              Comparator
            </label>
            <select id="hold-cmp" value={comparator} disabled={busy}
                    onChange={e => setComparator(e.target.value)} className={SELECT}>
              <option value="">Choose an arm</option>
              {(open.arms ?? []).filter(a => a !== intervention)
                .map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || !intervention || !comparator}
            onClick={() => onResolve(open.id, { intervention, comparator })}
            className="h-8 text-[12px] font-semibold rounded-lg px-3 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Use this comparison'}
          </button>
          <span className="text-[11.5px] w-full">
            The order is the direction of effect, and it can be changed later.
          </span>
        </div>
      )}
    </div>
  );
}
