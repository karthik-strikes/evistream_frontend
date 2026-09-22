'use client';

/**
 * Reuse another result's answers for this one — after seeing how they differ.
 *
 * Copying is legitimate and common: two results of one trial usually share most
 * of D1 and D2, and retyping identical answers is how transcription errors get
 * in. But it is also the easiest way to assert something about an estimate
 * nobody looked at, so three things are non-negotiable here.
 *
 * **The differences are shown before anything is copied.** Not a list of what
 * matches — a list of what does not, because those are the slots that decide
 * whether the answers still hold. A different analysis population changes 2.6
 * and 2.7; a different measurement changes D4.
 *
 * **Applicability is confirmed, not assumed.** The reviewer ticks that the
 * answers apply to this result. A silent copy is an assertion made by the
 * software.
 *
 * **What was copied is recorded, and survives editing.** A copied answer is a
 * weaker claim than one made looking at this result, and consensus has to be
 * able to tell them apart — including when it has been edited since, which is a
 * third thing again.
 */

import { useState } from 'react';

import { identitySlots, shortLabel, type ResultIdentity } from '../_lib/robIdentity';
import { ROB2_SIGNALLING } from '../_lib/rob2';

interface Props {
  /** The result being assessed. */
  target: ResultIdentity;
  /** Its siblings in the same study, with how much each has answered. */
  candidates: Array<{ result: ResultIdentity; answered: number; applicable: number }>;
  /** Which domain's answers would be copied. */
  domainIndex: number;
  busy: boolean;
  onCopy: (fromResultId: string) => void;
  onClose: () => void;
}

export function CopyAnswers({
  target, candidates, domainIndex, busy, onCopy, onClose,
}: Props) {
  const [from, setFrom] = useState('');
  const [applies, setApplies] = useState(false);
  const source = candidates.find(c => c.result.id === from)?.result;

  // What is NOT the same. Matching slots are not the question; the ones that
  // differ are what decide whether the answers still hold.
  const differences = source
    ? identitySlots(source).map((slot, i) => ({
      label: slot.label,
      from: slot.value,
      to: identitySlots(target)[i]?.value ?? '',
    })).filter(d => d.from !== d.to)
    : [];

  const domain = ROB2_SIGNALLING[domainIndex];

  return (
    <div className="border border-gray-200 dark:border-[#242424] rounded-xl bg-gray-50 dark:bg-[#0d0d0d] px-3.5 py-3">
      <div className="text-[12.5px] font-semibold dark:text-white">
        Reuse another result&rsquo;s {domain.code} answers
      </div>
      <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
        Compare the two results before copying. Answers that arrive by copy are recorded as copied.
      </p>

      <label className="sr-only" htmlFor="copy-from">Result to copy from</label>
      <select
        id="copy-from"
        value={from}
        onChange={e => { setFrom(e.target.value); setApplies(false); }}
        className="h-8 w-full max-w-[420px] text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 mt-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
      >
        <option value="">Choose a result</option>
        {candidates.map(c => (
          <option key={c.result.id} value={c.result.id}>
            {shortLabel(c.result)} — {c.answered}/{c.applicable} answered
          </option>
        ))}
      </select>

      {source && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
            {differences.length
              ? `${differences.length} difference${differences.length === 1 ? '' : 's'}`
              : 'Identical on every identity slot'}
          </div>
          {differences.length === 0 ? (
            <p className="text-[11.5px] text-gray-600 dark:text-zinc-400 mt-1">
              Two results identical on every slot should not both exist — check whether one is a
              duplicate before copying between them.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-col gap-1">
              {differences.map(d => (
                <div key={d.label} className="text-[11.5px] flex items-start gap-2 flex-wrap">
                  <span className="text-gray-400 dark:text-zinc-600 w-[140px] flex-none">{d.label}</span>
                  <span className="text-gray-500 dark:text-zinc-500 line-through">{d.from}</span>
                  <span className="text-gray-400 dark:text-zinc-600">→</span>
                  <span className="text-gray-800 dark:text-zinc-200 font-medium">{d.to}</span>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-start gap-2 mt-3 text-[12px] text-gray-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={applies}
              onChange={e => setApplies(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-gray-900 dark:accent-white"
            />
            <span>
              I have read the differences above and the {domain.code} answers apply to this result
              too.
            </span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          disabled={busy || !from || !applies}
          onClick={() => onCopy(from)}
          className="text-[12px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
        >
          {busy ? 'Copying…' : `Copy ${domain.code} answers`}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-[#1a1a1a]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
