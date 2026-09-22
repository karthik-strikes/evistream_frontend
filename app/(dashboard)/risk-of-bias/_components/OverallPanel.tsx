'use client';

/**
 * The last page of an assessment: five domains, one overall, and the declaration.
 *
 * Completing is a declaration, not a derived state. Until the reviewer presses
 * it the assessment stays editable; afterwards every control is disabled and the
 * only way forward is Reopen, which is recorded. A terminal status with no way
 * back is how reviewers end up asking an administrator to edit the database.
 */

import { SEVERITY_GLYPH, SEVERITY_SHORT } from '../_lib/robQueue';
import { JUDGEMENT } from '../_lib/robSkin';
import { ROB2_SIGNALLING, type OverallJudgement, type Severity } from '../_lib/rob2';
import { SeverityPill } from './DomainRail';

interface Props {
  resultLabel: string;
  estimate: string;
  severities: Severity[];
  derived: Array<Severity | null>;
  overrides: Record<number, Severity>;
  overrideWhy: Record<number, string>;
  confirmed: boolean[];
  unansweredByDomain: string[][];
  direction: Record<number, string>;
  overall: OverallJudgement;
  overallOverride: Severity | null;
  overallOverrideWhy: string;
  overallDirection: string;
  complete: boolean;
  canEdit: boolean;
  /** Jump back to one domain from the summary. */
  onSelectDomain?: (index: number) => void;
  onComplete: () => void;
  onReopen: () => void;
  onBack: () => void;
  saving: boolean;
}

export function OverallPanel({
  resultLabel, estimate, severities, derived, overrides, overrideWhy, confirmed,
  unansweredByDomain, direction, overall, overallOverride, overallOverrideWhy,
  overallDirection, complete, canEdit, onComplete, onReopen, onBack, saving,
  onSelectDomain,
}: Props) {
  const shown = overallOverride ?? overall.severity ?? 'none';
  const unconfirmed = confirmed.filter(Boolean).length;
  const openQuestions = unansweredByDomain.flat();
  const ready = openQuestions.length === 0 && unconfirmed === 5;

  const tone: Record<Severity, string> = {
    low: 'text-emerald-600 dark:text-emerald-400',
    some: 'text-amber-700 dark:text-amber-400',
    high: 'text-red-600 dark:text-red-400',
    none: 'text-gray-400 dark:text-zinc-600',
  };

  return (
    <div>
      <div className="px-4 py-3.5 border-b border-gray-100 dark:border-[#1a1a1a]">
        <h2 className="text-[15px] font-semibold dark:text-white">Overall risk of bias</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
          {resultLabel}{estimate ? ` · ${estimate}` : ''}
        </p>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {ROB2_SIGNALLING.map((domain, i) => {
          const open = unansweredByDomain[i] ?? [];
          const note = overrides[i]
            ? `Your judgement. The rules proposed ${derived[i] ? SEVERITY_SHORT[derived[i]!] : 'nothing yet'}. ${overrideWhy[i] ?? ''}`
            : open.length
              ? `Waiting on ${open.join(', ')}`
              : confirmed[i] ? 'Confirmed by you' : 'Derived — not yet confirmed';
          return (
            <div key={domain.code} className="flex items-start gap-3 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] pt-3 first:border-t-0 first:pt-0">
              <div className="min-w-0 flex-1">
                {/* A summary whose job is "check these five" has to be able to
                    take you to the one you want to check. Reading it and then
                    hunting for the domain in the rail is the step this screen
                    exists to remove. */}
                {onSelectDomain ? (
                  <button
                    type="button"
                    onClick={() => onSelectDomain(i)}
                    className="text-[13px] font-semibold text-left dark:text-white hover:underline"
                  >
                    {domain.code} · {domain.name} <span aria-hidden>→</span>
                  </button>
                ) : (
                  <div className="text-[13px] font-semibold dark:text-white">
                    {domain.code} · {domain.name}
                  </div>
                )}
                <div className="text-[12px] text-gray-500 dark:text-zinc-500 mt-0.5">{note}</div>
                {direction[i] && (
                  <div className="text-[12px] text-gray-500 dark:text-zinc-500">
                    Predicted direction: {direction[i]}
                  </div>
                )}
              </div>
              <SeverityPill severity={severities[i] ?? 'none'} />
            </div>
          );
        })}

        <div className="border border-gray-200 dark:border-[#242424] rounded-xl bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3.5 mt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
            {overallOverride ? 'Final overall judgement' : 'Proposed overall judgement'}
          </div>
          <div className={`text-[21px] font-bold tracking-[-0.4px] mt-2 ${JUDGEMENT[shown] ?? tone[shown]}`}>
            {shown === 'none' ? 'Incomplete' : `${SEVERITY_GLYPH[shown]}  ${SEVERITY_SHORT[shown]}`}
          </div>
          {overallOverride && (
            <p className="text-[12.5px] text-gray-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              RoB 2 proposed <strong>{overall.severity ? SEVERITY_SHORT[overall.severity] : 'nothing yet'}</strong>.
              Both values and your reason are stored, and the override is what Synthesis reads.
              <br />
              <span className="text-gray-500 dark:text-zinc-500">Reason: {overallOverrideWhy || '—'}</span>
            </p>
          )}
          {overallDirection && (
            <div className="text-[12px] text-gray-500 dark:text-zinc-500 mt-1">
              Predicted direction of bias overall: {overallDirection}
            </div>
          )}
          <p className="text-[12px] text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed">
            The overall judgement follows the RoB 2 rules: <strong>all domains low → low</strong>;
            <strong> any domain high → high</strong>; otherwise <strong>some concerns</strong>. Where
            several domains raise some concerns, whether that <em>together</em> substantially lowers
            confidence — and so warrants <strong>high</strong> — is a reviewer judgement the rules do
            not make.
          </p>
        </div>

        {overall.considerHigh && !overallOverride && (
          <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
            <span>
              More than one domain raises some concerns. Decide whether, taken together, they
              substantially lower confidence in this result — and if so, override the overall
              judgement from the panel on the right.
            </span>
          </div>
        )}

        <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
          <span>
            Completing is a declaration, not a guess. Until you press it this assessment stays
            editable; afterwards it is locked, visible to the adjudicator, and reopenable by you.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap px-4 py-3 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50 dark:bg-[#0d0d0d] rounded-b-xl">
        <span className="text-[11px] font-mono text-gray-500 dark:text-zinc-500">
          {complete
            ? 'Completed by you · read-only'
            : openQuestions.length
              ? `${openQuestions.length} unanswered — ${openQuestions.join(', ')}`
              : unconfirmed < 5
                ? `${5 - unconfirmed} domain${5 - unconfirmed > 1 ? 's' : ''} not yet confirmed`
                : 'All five domains confirmed'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onBack}
          className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={saving || !canEdit || (!complete && !ready)}
          onClick={complete ? onReopen : onComplete}
          className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {complete
            ? 'Reopen assessment'
            : 'Complete assessment — I reviewed all applicable questions'}
        </button>
      </div>
    </div>
  );
}
