'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildAxis, EFFECT_LABEL, formatEffect, formatP, formatTick, MODEL_SHORT,
  runMetaAnalysis, type EffectMeasure, type MetaResult, type MetaStudy, type PoolingModel,
} from '@/lib/metaAnalysis';
import {
  funnelAndEgger, leaveOneOut, MIN_ASYMMETRY_TEST, MIN_LEAVE_ONE_OUT, subgroupAnalysis,
} from '../_lib/diagnostics';

type Tab = 'sensitivity' | 'subgroups' | 'funnel';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'subgroups', label: 'Subgroups' },
  { id: 'funnel', label: 'Funnel plot' },
];

const cardClass =
  'border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]';

/**
 * Step 4 — the stress tests.
 *
 * Risk of bias is deliberately absent: those judgments live in a separate form
 * on real corpora, so the tab would need a cross-form join. An empty tab
 * promising an analysis it cannot perform is worse than no tab.
 */
export function DiagnosticsStep({
  studies,
  result,
  measure,
  model,
  subgroupColumns,
  subgroupColumn,
  onSubgroupColumn,
}: {
  /** The same MetaStudy list that produced the forest plot. */
  studies: MetaStudy[];
  result: MetaResult;
  measure: EffectMeasure;
  model: PoolingModel;
  subgroupColumns: string[];
  subgroupColumn: string;
  onSubgroupColumn: (c: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('sensitivity');

  const random = useMemo(() => runMetaAnalysis(studies, measure, 'random'), [studies, measure]);
  const fixed = useMemo(() => runMetaAnalysis(studies, measure, 'fixed'), [studies, measure]);
  const loo = useMemo(() => leaveOneOut(studies, measure, model), [studies, measure, model]);
  const subgroups = useMemo(
    () => subgroupAnalysis(studies, measure, model,
      s => String((s.evidence as any)?.row?.[subgroupColumn] ?? '')),
    [studies, measure, model, subgroupColumn],
  );
  const funnel = useMemo(() => funnelAndEgger(result), [result]);
  const axis = useMemo(() => buildAxis(result), [result]);

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] rounded-lg p-0.5 self-start">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'cursor-pointer text-[13px] font-medium px-3.5 py-1.5 rounded-md transition-colors',
              tab === t.id
                ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2a2a2a] dark:text-white'
                : 'bg-transparent text-gray-500 dark:text-zinc-500',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sensitivity ──────────────────────────────────────────────────── */}
      {tab === 'sensitivity' && (
        <>
          <div className={cardClass}>
            <div className="text-[15px] font-semibold dark:text-white">Model sensitivity</div>
            <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1">
              Does the conclusion depend on the model choice?
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3 max-w-[560px]">
              <Stat label="Random effects (DL)" value={estText(random)} active={model === 'random'} />
              <Stat label="Fixed effect (IV)" value={estText(fixed)} active={model === 'fixed'} />
            </div>
            {random.pooled && fixed.pooled && (
              <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2.5 leading-relaxed">
                {agreementNote(random, fixed, measure)}
              </div>
            )}
          </div>

          <div className={cardClass}>
            <div className="text-[15px] font-semibold dark:text-white">Leave-one-out</div>
            {loo ? (
              <>
                <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1">
                  Pooled estimate with each study omitted in turn.{' '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {loo.mostInfluentialLabel}
                  </span>{' '}
                  moves the estimate most.
                </div>
                <div className="grid grid-cols-[minmax(0,200px)_180px_60px] gap-x-3 items-center mt-3 pb-1.5 border-b border-gray-200 dark:border-[#2a2a2a] max-w-[520px]">
                  <Th>Omitted study</Th>
                  <Th>Pooled {measure} (95% CI)</Th>
                  <Th right>I²</Th>
                </div>
                {loo.rows.map(r => (
                  <div
                    key={r.key}
                    className={cn(
                      'grid grid-cols-[minmax(0,200px)_180px_60px] gap-x-3 items-center h-7 max-w-[520px] rounded-md',
                      r.mostInfluential && 'bg-amber-50 dark:bg-amber-500/5',
                    )}
                  >
                    <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 pl-1.5 truncate" title={r.label}>
                      {r.label}
                    </span>
                    <span className="text-[12.5px] text-zinc-900 dark:text-zinc-100 tabular-nums">
                      {r.est !== null ? formatEffect(r.est, r.lo!, r.hi!) : '—'}
                    </span>
                    <span className="text-[12.5px] text-gray-500 dark:text-zinc-500 text-right tabular-nums">
                      {r.i2 !== null ? `${r.i2.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                ))}
                <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2.5 leading-relaxed">
                  All studies together: {formatEffect(loo.baseline.est, loo.baseline.lo, loo.baseline.hi)}.
                  A row far from that line is a study the conclusion leans on.
                </div>
              </>
            ) : (
              <Gate>
                Leave-one-out needs at least {MIN_LEAVE_ONE_OUT} studies — omitting one from
                {' '}{studies.length} would leave too few to pool, so every row would be blank.
              </Gate>
            )}
          </div>
        </>
      )}

      {/* ── Subgroups ────────────────────────────────────────────────────── */}
      {tab === 'subgroups' && (
        <div className={cardClass}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="text-[15px] font-semibold dark:text-white">Subgroup analysis</div>
            <span className="text-xs text-gray-500 dark:text-zinc-500">grouped by</span>
            {subgroupColumns.length > 0 ? (
              <select
                value={subgroupColumn}
                onChange={e => onSubgroupColumn(e.target.value)}
                className="h-8 border border-gray-200 rounded-md bg-white font-mono text-xs px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
              >
                {subgroupColumns.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-gray-400 dark:text-zinc-600">
                no groupable column in this form
              </span>
            )}
          </div>

          {subgroupColumn && subgroups.rows.length > 0 ? (
            <>
              <div className="grid grid-cols-[minmax(0,160px)_70px_minmax(120px,1fr)_180px_50px] gap-x-3 items-center mt-3.5 pb-1.5 border-b border-gray-200 dark:border-[#2a2a2a]">
                <Th>Subgroup</Th>
                <Th>Studies</Th>
                <span />
                <Th>{measure} (95% CI)</Th>
                <Th right>I²</Th>
              </div>
              {subgroups.rows.map(g => (
                <div
                  key={g.name}
                  className="grid grid-cols-[minmax(0,160px)_70px_minmax(120px,1fr)_180px_50px] gap-x-3 items-center h-10"
                >
                  <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate" title={g.name}>
                    {g.name}
                  </span>
                  <span className="text-[12.5px] text-gray-500 dark:text-zinc-500">{g.k}</span>
                  <div className="relative h-10 text-gray-300 dark:text-[#2a2a2a]">
                    {g.poolable && (
                      <>
                        <div
                          className="absolute top-0 bottom-0 w-px bg-current"
                          style={{ left: `${axis.nullX}%` }}
                        />
                        <div
                          className="absolute top-1/2 h-[1.5px] bg-zinc-600 dark:bg-zinc-400 -translate-y-1/2"
                          style={{
                            left: `${axis.toX(g.lo!)}%`,
                            width: `${Math.max(axis.toX(g.hi!) - axis.toX(g.lo!), 0.5)}%`,
                          }}
                        />
                        <div
                          className="absolute top-1/2 w-2.5 h-2.5 bg-blue-500 rotate-45"
                          style={{ left: `${axis.toX(g.est!)}%`, transform: 'translate(-50%,-50%) rotate(45deg)' }}
                        />
                      </>
                    )}
                  </div>
                  <span className="text-[12.5px] text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {g.poolable ? formatEffect(g.est!, g.lo!, g.hi!) : 'too few to pool'}
                  </span>
                  <span className="text-[12.5px] text-gray-500 dark:text-zinc-500 text-right tabular-nums">
                    {g.i2 !== null ? `${g.i2.toFixed(0)}%` : '—'}
                  </span>
                </div>
              ))}

              <div className="text-[12.5px] text-gray-700 dark:text-zinc-300 border-t border-gray-100 dark:border-[#1f1f1f] mt-2 pt-3 tabular-nums">
                {subgroups.test
                  ? `Test for subgroup differences: Q = ${subgroups.test.q.toFixed(2)}, df = ${subgroups.test.df} (p = ${formatP(subgroups.test.p)})`
                  : 'Test for subgroup differences: not available — fewer than two subgroups could be pooled'}
              </div>
              {subgroups.test && (
                <div className="text-xs text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed">
                  {subgroups.test.p < 0.05
                    ? 'The subgroups differ by more than chance would explain — the pooled estimate may be hiding two different answers.'
                    : 'No evidence the subgroups differ. This is not evidence that they are the same; subgroup tests are usually underpowered.'}
                </div>
              )}
              {subgroups.unpoolable > 0 && (
                <div className="text-xs text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed">
                  {subgroups.unpoolable}{' '}
                  {subgroups.unpoolable === 1 ? 'subgroup has' : 'subgroups have'} too few studies to
                  pool. They are listed with their counts rather than dropped, so the studies still
                  add up.
                </div>
              )}
              <div className="text-xs text-gray-400 dark:text-zinc-600 mt-2 leading-relaxed">
                Subgroup columns come from the mapped form — any column can group. Splitting an
                analysis after seeing the result is how false findings are made; these should be
                pre-specified in your protocol.
              </div>
            </>
          ) : (
            <Gate>
              No column is available to group by. Subgroups need a column on the mapped table that
              labels each row — a population, a setting, a dose.
            </Gate>
          )}
        </div>
      )}

      {/* ── Funnel ───────────────────────────────────────────────────────── */}
      {tab === 'funnel' && (
        <div className={cardClass}>
          <div className="text-[15px] font-semibold dark:text-white">Funnel plot</div>
          <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1">
            Each point is a study: effect against precision. Asymmetry suggests missing small studies
            or publication bias.
          </div>

          <div className="relative h-[260px] max-w-[640px] mt-3.5 border-l border-b border-gray-200 dark:border-[#2a2a2a]">
            <svg
              width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"
              className="absolute inset-0"
            >
              {funnel.pseudo && (
                <polygon
                  points={[
                    `${axis.toX(funnel.pseudo.apex)},0`,
                    `${axis.toX(funnel.pseudo.lo)},100`,
                    `${axis.toX(funnel.pseudo.hi)},100`,
                  ].join(' ')}
                  className="fill-gray-100 dark:fill-[#1a1a1a]"
                />
              )}
              {funnel.pseudo && (
                <line
                  x1={axis.toX(funnel.pseudo.apex)} y1="0"
                  x2={axis.toX(funnel.pseudo.apex)} y2="100"
                  strokeWidth="0.4" strokeDasharray="2 2"
                  className="stroke-gray-300 dark:stroke-[#3a3a3a]"
                />
              )}
            </svg>
            {funnel.points.map(p => (
              <span
                key={p.key}
                title={`${p.label} · ${p.effect.toFixed(2)}`}
                className="absolute w-2 h-2 rounded-full bg-zinc-900 dark:bg-zinc-100 ring-2 ring-white dark:ring-[#111111] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${axis.toX(p.effect)}%`, top: `${(p.se / funnel.maxSe) * 100}%` }}
              />
            ))}
            <span className="absolute -left-2.5 top-0 origin-top-left -rotate-90 -translate-x-full text-[11px] text-gray-400 dark:text-zinc-600 whitespace-nowrap">
              Standard error →
            </span>
          </div>
          <div className="flex justify-between max-w-[640px] text-[11px] text-gray-400 dark:text-zinc-600 mt-1">
            <span>{formatTick(axis.min)}</span>
            <span>{EFFECT_LABEL[measure]}{axis.log ? ' (log scale)' : ''}</span>
            <span>{formatTick(axis.max)}</span>
          </div>

          <div className="text-[12.5px] text-gray-700 dark:text-zinc-300 mt-3 tabular-nums">
            {funnel.egger
              ? `Egger's test: intercept ${funnel.egger.intercept.toFixed(2)} (SE ${funnel.egger.se.toFixed(2)}), p = ${formatP(funnel.egger.p)}`
              : "Egger's test needs at least 3 studies."}
          </div>
          {funnel.egger && !funnel.egger.interpretable && (
            <Gate>
              Not interpretable with {funnel.points.length} studies. Asymmetry tests have almost no
              power below {MIN_ASYMMETRY_TEST}, so a result either way here would be noise. The
              numbers are shown for completeness, not as evidence.
            </Gate>
          )}
          {funnel.egger?.interpretable && (
            <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed">
              {funnel.egger.p < 0.05
                ? 'Asymmetry detected. Publication bias is one explanation; genuine differences between small and large trials are another, and this test cannot tell them apart.'
                : 'No asymmetry detected. That is not proof there is no publication bias — only that this test did not find any.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function estText(r: MetaResult): string {
  return r.pooled ? formatEffect(r.pooled.est, r.pooled.lo, r.pooled.hi) : 'not pooled';
}

/**
 * Whether the two models tell the same story. What matters is not whether the
 * point estimates match to two decimals but whether they land on the same side
 * of "no effect" — that is the conclusion a reader takes away.
 */
function agreementNote(random: MetaResult, fixed: MetaResult, measure: EffectMeasure): string {
  const nullAt = measure === 'RR' || measure === 'OR' ? 1 : 0;
  const crosses = (r: MetaResult) => r.pooled!.lo <= nullAt && r.pooled!.hi >= nullAt;
  const sameSide = crosses(random) === crosses(fixed);
  return sameSide
    ? 'Both models reach the same conclusion, so the result does not hinge on that choice.'
    : 'The two models disagree about whether the effect is distinguishable from no effect — say which you pre-specified, and why.';
}

function Th({ children, right = false }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <span
      className={cn(
        'text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500',
        right && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div
      className={cn(
        'border rounded-lg px-3.5 py-3',
        active
          ? 'border-gray-300 bg-gray-50 dark:border-[#3a3a3a] dark:bg-[#1a1a1a]'
          : 'border-gray-200 dark:border-[#2a2a2a]',
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
        {label}
        {active && <span className="ml-1.5 normal-case tracking-normal font-medium">· in use</span>}
      </div>
      <div className="text-[17px] font-bold tabular-nums mt-1 dark:text-white">{value}</div>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border border-dashed border-gray-300 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3.5 py-2.5 mt-3">
      <Info className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500 flex-shrink-0 mt-0.5" />
      <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 leading-relaxed">
        {children}
      </span>
    </div>
  );
}
