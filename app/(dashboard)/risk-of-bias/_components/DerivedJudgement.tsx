'use client';

/**
 * The judgement panel — derived, never chosen.
 *
 * Neither the AI nor this screen picks a domain's label. It comes out of the
 * published RoB 2 algorithm applied to the signalling answers, and while any
 * applicable question is unanswered it stays blank rather than guessing from a
 * partial set. That blankness is the point: the page this replaces let a
 * reviewer type a judgement straight into a select box, so the label and the
 * answers could disagree with nothing to say which was meant.
 *
 * Overriding is allowed — RoB 2 expects reviewer judgement — but it is a
 * deliberate act: the algorithm's proposal stays on screen, the override needs a
 * written reason, and both values are stored.
 */

import { useState } from 'react';

import { SEVERITY_GLYPH, SEVERITY_SHORT } from '../_lib/robQueue';
import { ROB2_SIGNALLING, type OverallJudgement, type Severity } from '../_lib/rob2';
import { SeverityPill } from './DomainRail';

const DIRECTIONS = [
  '', 'Favours experimental', 'Favours comparator', 'Towards null',
  'Away from null', 'Unpredictable',
];

interface Props {
  /** 0–4 for a domain, 5 for the overall page. */
  domain: number;
  derived: Severity | null;
  shown: Severity;
  unanswered: string[];
  override: Severity | null;
  overrideWhy: string;
  direction: string;
  overall: OverallJudgement;
  severities: Severity[];
  readOnly: boolean;
  onOverride: (severity: Severity | null, why: string) => void;
  onDirection: (value: string) => void;
  onSelectDomain: (index: number) => void;
  /** Where this assessment sits in the review workflow. */
  workflow: Array<[string, string]>;
}

export function DerivedJudgement({
  domain, derived, shown, unanswered, override, overrideWhy, direction,
  overall, severities, readOnly, onOverride, onDirection, onSelectDomain, workflow,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftWhy, setDraftWhy] = useState(overrideWhy);
  const isOverall = domain === 5;
  const code = isOverall ? 'Overall judgement' : `${ROB2_SIGNALLING[domain].code} judgement`;

  const tone: Record<Severity, string> = {
    low: 'text-emerald-600 dark:text-emerald-400',
    some: 'text-amber-600 dark:text-amber-400',
    high: 'text-red-600 dark:text-red-400',
    none: 'text-gray-400 dark:text-zinc-600',
  };

  let waiting: React.ReactNode;
  if (override) {
    waiting = <>Reason recorded: {overrideWhy || '—'}</>;
  } else if (unanswered.length) {
    waiting = (
      <>Waiting on <strong className="font-semibold">{unanswered.join(', ')}</strong>. The label stays
        blank until they are in.</>
    );
  } else if (isOverall && overall.considerHigh) {
    waiting = (
      <>Several domains raise some concerns. Whether that <em>together</em> substantially lowers
        confidence in this result is a reviewer judgement the rules do not make.</>
    );
  } else {
    waiting = <>Neither the AI nor this screen picks the label.</>;
  }

  return (
    <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="px-3.5 py-3.5 border-b border-gray-100 dark:border-[#1a1a1a]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
          {code}
        </div>
        <div className={`text-[15.5px] font-bold tracking-tight mt-2 ${tone[shown]}`}>
          {shown === 'none'
            ? (isOverall ? 'Incomplete' : 'Not yet judged')
            : `${SEVERITY_GLYPH[shown]}  ${SEVERITY_SHORT[shown]}`}
        </div>
        <div className="text-[10px] font-mono text-gray-400 dark:text-zinc-600 mt-0.5">
          {override
            ? `your judgement — the rules proposed ${derived ? SEVERITY_SHORT[derived] : 'nothing yet'}`
            : 'derived from the signalling answers'}
        </div>
        <p className="text-[12px] text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed">{waiting}</p>

        <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-[#1a1a1a]">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-[11.5px] font-semibold text-gray-500 dark:text-zinc-500 hover:underline"
          >
            {open ? 'Advanced ▴' : 'Advanced ▾'}
          </button>
          {open && (
            <div className="flex flex-col gap-2.5 mt-2.5">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">
                  Override the judgement
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(['low', 'some', 'high'] as Severity[]).map(s => (
                    <button
                      key={s}
                      type="button"
                      disabled={readOnly}
                      onClick={() => onOverride(override === s ? null : s, draftWhy)}
                      className={[
                        'text-[11px] font-semibold rounded-lg border px-2 py-1',
                        override === s
                          ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
                        readOnly && 'opacity-40 cursor-not-allowed',
                      ].filter(Boolean).join(' ')}
                    >
                      {SEVERITY_SHORT[s]}
                    </button>
                  ))}
                  {override && (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onOverride(null, '')}
                      className="text-[11px] font-semibold rounded-lg border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-500 dark:hover:bg-[#1a1a1a]"
                    >
                      Follow the rules
                    </button>
                  )}
                </div>
                {override && (
                  <textarea
                    value={draftWhy}
                    disabled={readOnly}
                    rows={2}
                    placeholder="Why this differs from the derived judgement — required"
                    onChange={e => setDraftWhy(e.target.value)}
                    onBlur={() => onOverride(override, draftWhy)}
                    className="w-full mt-1.5 text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 py-1.5 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none resize-y"
                  />
                )}
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">
                  Predicted direction of bias — optional
                </label>
                <select
                  value={direction}
                  disabled={readOnly}
                  onChange={e => onDirection(e.target.value)}
                  className="w-full h-8 text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
                >
                  {DIRECTIONS.map(d => (
                    <option key={d || 'none'} value={d}>{d || 'Not specified'}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-3.5 py-3 border-b border-gray-100 dark:border-[#1a1a1a]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-2">
          All domains
        </div>
        {ROB2_SIGNALLING.map((d, i) => (
          <div key={d.code} className="flex items-start justify-between gap-2 py-1.5 border-t border-gray-100 dark:border-[#1a1a1a] first:border-t-0">
            {/* Wraps rather than truncating: the domain a reviewer is looking
                for should not be the one they cannot read. */}
            <button
              type="button"
              onClick={() => onSelectDomain(i)}
              className="min-w-0 flex-1 text-[12px] text-left leading-snug text-gray-700 dark:text-zinc-300 hover:underline"
            >
              {d.code} · {d.name}
            </button>
            <span className="flex-none mt-px"><SeverityPill severity={severities[i] ?? 'none'} /></span>
          </div>
        ))}
        <div className="flex items-start justify-between gap-2 py-1.5 border-t border-gray-100 dark:border-[#1a1a1a] font-semibold">
          <button
            type="button"
            onClick={() => onSelectDomain(5)}
            className="min-w-0 flex-1 text-[12px] text-left leading-snug text-gray-800 dark:text-zinc-200 hover:underline"
          >
            Overall
          </button>
          <span className="flex-none mt-px"><SeverityPill severity={overall.severity ?? 'none'} /></span>
        </div>
      </div>

      <div className="px-3.5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-2">
          Workflow
        </div>
        {workflow.map(([name, status]) => (
          <div key={name} className="flex items-center justify-between gap-2 py-0.5 text-[12px] text-gray-500 dark:text-zinc-500">
            <span>{name}</span>
            <span className="font-semibold text-gray-700 dark:text-zinc-300">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
