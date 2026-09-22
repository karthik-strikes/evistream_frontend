'use client';

/**
 * The questions RoB 2 is not asking, said once instead of card by card.
 *
 * Two different silences, and a reviewer has to be able to tell them apart:
 *
 * **Skipped** — an earlier answer ruled this out. It is excluded from progress
 * and exported as `Not applicable`. Nothing more is owed on it.
 *
 * **Waiting** — its prerequisite is unanswered, so nothing has ruled it out
 * yet. It may still appear. Presenting this as "not applicable" would tell the
 * reviewer they are finished when they are not, which is why the two are never
 * folded together.
 *
 * Collapsed by default: on a domain where four of five questions route out,
 * a card each buries the one question that is actually being asked.
 */

import type { SignallingQuestion } from '../_lib/rob2';
import { ROUTED } from '../_lib/robSkin';

export function RoutedBlock({ skipped, waiting }: {
  skipped: SignallingQuestion[];
  waiting: SignallingQuestion[];
}) {
  if (!skipped.length && !waiting.length) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {skipped.length > 0 && (
        <details className={`${ROUTED} py-2.5`}>
          <summary className="text-[11.5px] text-gray-600 dark:text-zinc-400 cursor-pointer select-none">
            <strong className="font-semibold">{skipped.map(q => q.id).join(', ')}</strong>
            {' · '}not applicable under your current answers
          </summary>
          <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed">
            Excluded from progress and exported as <strong>Not applicable</strong>. If you change
            the answer that ruled them out they come back, and anything you had already recorded
            against them is still in the audit record.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {skipped.map(q => (
              <li key={q.id} className="text-[11.5px] text-gray-500 dark:text-zinc-500 leading-relaxed">
                <span className="font-mono text-gray-400 dark:text-zinc-600">{q.id}</span>{' '}
                {q.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {waiting.length > 0 && (
        <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 px-3 py-1.5 leading-relaxed">
          <strong className="font-semibold">{waiting.map(q => q.id).join(', ')}</strong>{' '}
          will appear if your earlier answers require them — nothing has ruled them out yet.
        </p>
      )}
    </div>
  );
}
