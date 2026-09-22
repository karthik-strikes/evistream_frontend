'use client';

/**
 * The comparisons one study reports, edited where the reviewer met them.
 *
 * **A trial is not one comparison.** A four-arm trial with a placebo arm has
 * three, and each is a separate estimate with its own answers to 2.4 and 5.2.
 *
 * This lives off the queue's study header rather than in project setup, because
 * that is where a reviewer discovers the problem: they open a study, find a
 * result they cannot assess, and the reason is a pair nobody has named. Setup
 * keeps only a readiness summary that links here.
 *
 * The order of the two arms is the direction of effect. Swapping it turns
 * RR 1.84 favouring the drug into RR 0.54 favouring placebo, so a swap is an
 * edit somebody makes deliberately — never a string nobody can correct.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { RobContrast, RobResultCandidate } from '@/services/rob.service';

interface Props {
  studyLabel: string;
  contrasts: RobContrast[];
  /** How many results currently point at each comparison. */
  resultCounts: Record<string, number>;
  busy: boolean;
  canManage: boolean;
  onAdd: (intervention: string, comparator: string) => void;
  onSwap: (contrastId: string) => void;
  onRemove: (contrastId: string) => void;
  onBack: () => void;
  /** Back goes where the reviewer came FROM — setup and the queue both link here. */
  backLabel: string;
  /** This study's candidate rows, held and ready, so the effect of naming a
   *  comparison is visible on the screen where it is named. */
  candidates: RobResultCandidate[];
  /** Forms whose mapping is unconfirmed — results cannot be created until they are. */
  mappingNotReady: string[];
  creating: boolean;
  onCreate: () => void;
  onOpenSetup: () => void;
}

const SELECT =
  'h-8 max-w-[240px] text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 '
  + 'bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none';

export function StudyComparisons({
  studyLabel, contrasts, resultCounts, busy, canManage,
  onAdd, onSwap, onRemove, onBack, backLabel,
  candidates, mappingNotReady, creating, onCreate, onOpenSetup,
}: Props) {
  const held = candidates.filter(c => c.state === 'held');
  const ready = candidates.filter(c => c.state !== 'held');
  const settled = contrasts.filter(c => c.intervention);
  const arms = [...new Set(contrasts.flatMap(c => c.arms ?? []))];
  const suggested = contrasts.find(c => c.suggested_comparator)?.suggested_comparator ?? '';

  const [intervention, setIntervention] = useState('');
  const [comparator, setComparator] = useState(suggested);
  /** Which comparison is mid-confirmation, and for which action. */
  const [confirming, setConfirming] = useState<{ id: string; action: 'swap' | 'remove' } | null>(null);

  // Reverse duplicates are the same comparison read backwards, and storing both
  // would make one study's results disagree about which way the effect runs.
  const taken = new Set(settled.flatMap(c => [
    `${c.intervention}|${c.comparator}`.toLowerCase(),
    `${c.comparator}|${c.intervention}`.toLowerCase(),
  ]));
  const duplicate = !!intervention && !!comparator
    && taken.has(`${intervention}|${comparator}`.toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
              Queue · study comparisons
            </div>
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">{studyLabel}</h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed max-w-[76ch]">
              The intervention–comparator pairs this study reports. They apply across its extraction
              forms, and each one gets its own trial answers and its own results.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-none text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            {backLabel}
          </button>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 py-2">
          Comparisons for this study
        </div>

        {settled.length === 0 && (
          <div className={`text-[12.5px] pb-3 ${held.length
            ? 'text-gray-600 dark:text-zinc-400'
            : 'text-gray-500 dark:text-zinc-500'}`}>
            {held.length
              ? <><strong className="font-semibold">Comparison needed · {held.length} candidate
                row{held.length === 1 ? '' : 's'} on hold.</strong> Its arms do not say which was
                compared against which, so none of them can become results until you name a pair.</>
              : <>None yet. Its arms do not say which was compared against which, so nothing here
                can be assessed until you name a pair.</>}
          </div>
        )}

        {settled.map(c => {
          const used = resultCounts[c.id] ?? 0;
          return (
            <div key={c.id} className="flex items-start gap-3 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium dark:text-zinc-200">
                  {c.intervention} <span className="text-gray-400 dark:text-zinc-600">vs</span> {c.comparator}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-zinc-500 mt-0.5">
                  {used === 0 ? 'No results yet' : `${used} result${used === 1 ? '' : 's'}`}
                  {' · its own trial answers'}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1.5 flex-none">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Swap ${studyLabel}: ${c.intervention} versus ${c.comparator}`}
                    onClick={() => setConfirming({ id: c.id, action: 'swap' })}
                    className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                  >
                    ⇄ Swap
                  </button>
                  <button
                    type="button"
                    disabled={busy || used > 0}
                    aria-label={`Remove ${studyLabel}: ${c.intervention} versus ${c.comparator}`}
                    onClick={() => setConfirming({ id: c.id, action: 'remove' })}
                    title={used > 0
                      ? `${used} result${used === 1 ? '' : 's'} point at this comparison`
                      : 'Remove this comparison'}
                    className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-1 text-gray-500 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              )}

              {/* What the action will DO, before it does it. Swapping a
                  comparison is not a cosmetic edit — it inverts the direction
                  of every estimate attached to it. */}
              {confirming?.id === c.id && (
                <div className="w-full border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-lg px-3 py-2.5 mt-1">
                  {confirming.action === 'swap' ? (
                    <div className="text-[12px] text-gray-700 dark:text-zinc-300 leading-relaxed">
                      This becomes <strong>{c.comparator} vs {c.intervention}</strong>.
                      {used > 0 && <> {used} result{used === 1 ? '' : 's'} point at it, and every
                        estimate reverses direction — an effect favouring {c.intervention} will read
                        as favouring {c.comparator}.</>}
                      {' '}Judgements already made are not changed; the answers were about the same
                      two arms either way.
                    </div>
                  ) : (
                    <div className="text-[12px] text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Removes this comparison. Nothing points at it, so no assessment is lost.
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirming.action === 'swap') onSwap(c.id); else onRemove(c.id);
                        setConfirming(null);
                      }}
                      className="text-[11.5px] font-semibold rounded-lg px-2.5 py-1 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                    >
                      {confirming.action === 'swap' ? 'Swap the direction' : 'Remove it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-600 dark:text-zinc-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {canManage && arms.length > 1 && (
          <div className="border-t border-gray-100 dark:border-[#1a1a1a] py-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label htmlFor="cmp-int" className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-0.5">
                  Intervention
                </label>
                <select id="cmp-int" value={intervention} className={SELECT}
                        onChange={e => setIntervention(e.target.value)}>
                  <option value="">Choose an arm</option>
                  {arms.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <span className="text-[11.5px] text-gray-500 dark:text-zinc-500 pb-1.5">vs</span>
              <div>
                <label htmlFor="cmp-cmp" className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-0.5">
                  Comparator
                </label>
                <select id="cmp-cmp" value={comparator} className={SELECT}
                        onChange={e => setComparator(e.target.value)}>
                  <option value="">Choose an arm</option>
                  {arms.filter(a => a !== intervention)
                    .map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <button
                type="button"
                disabled={busy || !intervention || !comparator || duplicate}
                onClick={() => { onAdd(intervention, comparator); setIntervention(''); setComparator(suggested); }}
                className="h-8 inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {settled.length ? 'Add another comparison' : 'Add this comparison'}
              </button>
            </div>
            {duplicate && (
              <div className="text-[11.5px] text-gray-600 dark:text-zinc-400 mt-1.5">
                This study already records those two arms. The same pair read backwards is the same
                comparison — use <strong>Swap</strong> on it instead.
              </div>
            )}
            <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1.5">
              The order is the direction of effect, and it can be changed later. Assessments
              already made keep the comparison they were made against; changes here apply to
              results created from now on.
            </div>
          </div>
        )}
      </div>

      {/* What naming a comparison actually buys, on the screen where it is
          named. Without this the reviewer settles a pair and has no way to see
          that four rows just came off hold except by going back to the queue
          and counting. */}
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 py-2">
          Candidate results for this study
        </div>

        {held.length > 0 && (
          <div className="text-[12px] text-gray-700 dark:text-zinc-400 pb-2 leading-relaxed">
            {held.length} candidate row{held.length === 1 ? '' : 's'} need a comparison before
            {held.length === 1 ? ' it' : ' they'} can become assessment results.
          </div>
        )}

        {[...held, ...ready].slice(0, 20).map((c, i) => (
          <div key={i} className="border-t border-gray-100 dark:border-[#1a1a1a] py-2.5">
            <div className="text-[12.5px] font-medium dark:text-zinc-200">
              {[c.outcome_domain, c.timepoint].filter(Boolean).join(' · ')}
            </div>
            <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
              {c.state === 'held'
                ? <span className="text-gray-600 dark:text-zinc-400">Comparison needed</span>
                : c.contrast
                  ? `${c.contrast.intervention} vs ${c.contrast.comparator}`
                  : 'No comparison attached'}
              {(c as any).source_form_name && ` · Source: ${(c as any).source_form_name}`}
            </div>
          </div>
        ))}
        {held.length + ready.length > 20 && (
          <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 border-t border-gray-100 dark:border-[#1a1a1a] py-2.5">
            …and {held.length + ready.length - 20} more.
          </div>
        )}

        {held.length === 0 && ready.length === 0 && (
          <div className="text-[12.5px] text-gray-500 dark:text-zinc-500 pb-3">
            All current candidate results for these comparisons are already in the queue.
          </div>
        )}

        {ready.length > 0 && mappingNotReady.length > 0 && (
          <div className="flex items-start gap-2.5 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] py-2.5 text-[12px] text-gray-700 dark:text-zinc-400">
            <span className="min-w-0 flex-1 leading-relaxed">
              Confirm the mapping for {mappingNotReady.join(', ')} before creating results.
            </span>
            <button
              type="button"
              onClick={onOpenSetup}
              className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a]"
            >
              Review form mappings →
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] py-3">
          {canManage && (
            <button
              type="button"
              disabled={creating || ready.length === 0 || mappingNotReady.length > 0}
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating && <Loader2 className="h-3 w-3 animate-spin" />}
              Create {ready.length} result{ready.length === 1 ? '' : 's'} for this study
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
