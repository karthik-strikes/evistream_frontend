'use client';

/**
 * What is left to assess, grouped by study.
 *
 * A study row shows the **spread** across its results — "▲1 !2 ✓1 across 4" —
 * and never one label, because there is no such thing as one risk-of-bias
 * judgement for a paper. Every dot carries a symbol as well as a colour, so the
 * grid is readable without colour vision.
 *
 * The group row leads to the trial questions rather than to a result: the six
 * are answered once per study and come first, and a queue that drops a reviewer
 * straight into D3 of a result whose randomisation questions are blank is a
 * queue that makes them navigate backwards to start.
 */

import { AlertTriangle, Search } from 'lucide-react';

import { SEVERITY_GLYPH, SEVERITY_SHORT, spreadText, type StudyGroup } from '../_lib/robQueue';
import type { Severity } from '../_lib/rob2';

interface Props {
  groups: StudyGroup[];
  activeResultId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onOpenTrial: (documentId: string) => void;
  onOpenResult: (resultId: string) => void;
  lede: string;
}

function Dot({ severity, glyph }: { severity: Severity; glyph?: string }) {
  const tone: Record<Severity, string> = {
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-900/50',
    some: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-900/50',
    high: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-900/50',
    none: 'bg-transparent text-gray-300 border-gray-200 dark:text-zinc-700 dark:border-[#242424]',
  };
  return (
    <span
      title={glyph ? 'Differs across this study’s results' : SEVERITY_SHORT[severity]}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${tone[severity]}`}
    >
      {glyph ?? SEVERITY_GLYPH[severity]}
    </span>
  );
}

export function ResultQueue({
  groups, activeResultId, query, onQuery, onOpenTrial, onOpenResult, lede,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-3.5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">Assessment queue</h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5">{lede}</p>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-600" />
            <input
              type="text"
              value={query}
              onChange={e => onQuery(e.target.value)}
              placeholder="Search studies"
              className="h-8 w-[220px] max-w-full text-[12.5px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg pl-8 pr-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-[#1a1a1a] text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 [grid-template-columns:minmax(220px,1fr)_repeat(5,28px)_minmax(120px,auto)_minmax(120px,auto)]">
            <span>Study · result</span>
            <span className="text-center">D1</span>
            <span className="text-center">D2</span>
            <span className="text-center">D3</span>
            <span className="text-center">D4</span>
            <span className="text-center">D5</span>
            <span>Overall</span>
            <span>Status</span>
          </div>

          {groups.length === 0 && (
            <div className="px-4 py-8 text-[13px] text-gray-500 dark:text-zinc-500">
              {query.trim() ? 'No studies match that search.' : 'Nothing to assess yet.'}
            </div>
          )}

          {groups.map(group => {
            const perDomain: Array<{ severity: Severity; mixed: boolean }> = [0, 1, 2, 3, 4]
              .map(i => {
                const values = group.results.map(r => r.severities[i] ?? 'none');
                const same = values.every(v => v === values[0]);
                return { severity: same ? values[0] : 'none', mixed: !same };
              });

            return (
              <div key={group.documentId}>
                <button
                  type="button"
                  onClick={() => onOpenTrial(group.documentId)}
                  className="w-full grid items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] text-left hover:bg-gray-50 dark:hover:bg-[#141414] [grid-template-columns:minmax(220px,1fr)_repeat(5,28px)_minmax(120px,auto)_minmax(120px,auto)]"
                >
                  <span className="text-[13px] font-semibold truncate dark:text-white">
                    {group.label}
                  </span>
                  {perDomain.map((d, i) => (
                    <span key={i} className="flex justify-center">
                      <Dot severity={d.severity} glyph={d.mixed ? '~' : undefined} />
                    </span>
                  ))}
                  <span
                    className="text-[11px] font-mono text-gray-500 dark:text-zinc-500"
                    title="Spread across this study’s results — not a judgement of the study"
                  >
                    {spreadText(group.spread, group.results.length)}
                  </span>
                  <span className={[
                    'text-[11.5px] font-semibold',
                    group.trialComplete
                      ? 'text-gray-500 dark:text-zinc-500'
                      : 'text-amber-700 dark:text-amber-400',
                  ].join(' ')}>
                    {group.trialComplete ? '✓ Trial questions done' : '⚠ Trial questions first'}
                  </span>
                </button>

                {group.results.map(row => (
                  <button
                    key={row.result.id}
                    type="button"
                    onClick={() => onOpenResult(row.result.id)}
                    className={[
                      'w-full grid items-center gap-3 pl-9 pr-4 py-2 border-b border-gray-100 dark:border-[#1a1a1a] text-left hover:bg-gray-50 dark:hover:bg-[#141414] [grid-template-columns:minmax(220px,1fr)_repeat(5,28px)_minmax(120px,auto)_minmax(120px,auto)]',
                      activeResultId === row.result.id ? 'bg-gray-50 dark:bg-[#161616]' : '',
                    ].join(' ')}
                  >
                    <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 truncate" title={row.label}>
                      {row.label}
                    </span>
                    {[0, 1, 2, 3, 4].map(i => (
                      <span key={i} className="flex justify-center">
                        <Dot severity={row.severities[i] ?? 'none'} />
                      </span>
                    ))}
                    <span className="text-[11.5px] font-semibold text-gray-600 dark:text-zinc-400">
                      {SEVERITY_GLYPH[row.overall]} {SEVERITY_SHORT[row.overall]}
                    </span>
                    <span className={[
                      'text-[11.5px] font-semibold inline-flex items-center gap-1',
                      row.progress === 'held'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-gray-500 dark:text-zinc-500',
                    ].join(' ')}>
                      {row.progress === 'held' && <AlertTriangle className="h-3 w-3" />}
                      {row.progress === 'held' ? 'Held'
                        : row.progress === 'complete' ? 'Complete'
                          : row.progress === 'in_progress'
                            ? `${row.answered} of ${row.applicable}`
                            : 'Not started'}
                      {row.stale && <span title="Identity changed since this was assessed">·&nbsp;stale</span>}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
        <span aria-hidden className="font-bold">i</span>
        <span>
          <strong>✓ low · ! some concerns · ▲ high · – not assessed.</strong> Every dot carries a
          symbol as well as a colour. A study row shows the <em>spread across its results</em> — there
          is no such thing as one risk-of-bias judgement for a paper.
        </span>
      </div>
    </div>
  );
}
