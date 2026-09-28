'use client';

/**
 * Diagnostics — the old DiagnosticsStep split into Sensitivity · Subgroups ·
 * Small-study effects · Fragility · Risk of bias, every one computed on the
 * displayed run's stored snapshot (SPEC §2: captions bind to a run's hash).
 */

import { useMemo, useState } from 'react';

import {
  buildAxis, formatEffect, formatP, formatTick, EFFECT_LABEL, type MetaResult, type MetaStudy,
} from '@/lib/metaAnalysis';
import { shortHash } from '../../_lib/datasetHash';
import {
  funnelAndEgger, leaveOneOut, MIN_ASYMMETRY_TEST, MIN_LEAVE_ONE_OUT, subgroupAnalysis,
} from '../../_lib/diagnostics';
import { fragilitySummary, fragilityTable } from '../../_lib/fragility';
import { useSynthesisNav } from '../../_lib/nav';
import { metaOptionsFor, readAs, runMeta, studiesFromDataset, type RunConfig, type RunOutputs } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { displayedRun } from './AnalysisTab';
import { EmptyPanel, OutlineButton, Segmented, Select, StateText, TableFrame, Th } from '../ui';

type Sub = 'sensitivity' | 'subgroups' | 'small' | 'fragility' | 'rob';

function est(r: MetaResult): string {
  return r.pooled ? formatEffect(r.pooled.est, r.pooled.lo, r.pooled.hi) : 'not pooled';
}

function Gate({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 rounded-[10px] bg-[#fafafa] px-4 py-3 text-[12.5px] leading-[19px] text-gray-600 dark:bg-[#141414] dark:text-zinc-400">{children}</div>;
}

const ROB = { low: ['Low', 'text-[#047857]'], some: ['Some concerns', 'text-[#92400e]'], high: ['High', 'text-[#b91c1c]'] } as const;

export function DiagnosticsTab({ ws }: { ws: WorkspaceState }) {
  const syn = useSynthesis();
  const { get, go } = useSynthesisNav();
  const [sub, setSub] = useState<Sub>('sensitivity');
  const [showFunnel, setShowFunnel] = useState(false);
  const run = displayedRun(ws, get('run'));
  const config = (run?.config ?? null) as RunConfig | null;
  const studies: MetaStudy[] = useMemo(() => (run ? studiesFromDataset(run.dataset) : []), [run]);
  const opts = config ? metaOptionsFor({ model: config.model, tau2: config.tau2, ci: config.ci }, { proportionMethod: config.proportion_method }) : {};

  const result = useMemo(() => (config ? readAs(runMeta(studies, config)) : null), [studies, config]);
  const variants = useMemo(() => {
    if (!config) return [];
    const mk = (label: string, c: Partial<RunConfig>) => {
      const cfg = { ...config, ...c } as RunConfig;
      const inUse = cfg.model === config.model && (cfg.model !== 'random' || (cfg.tau2 === config.tau2 && cfg.ci === config.ci));
      return { label, r: readAs(runMeta(studies, cfg)), inUse };
    };
    return [
      mk('RE · DL τ² · z', { model: 'random', tau2: 'dl', ci: 'z' }),
      mk('RE · REML τ² · z', { model: 'random', tau2: 'reml', ci: 'z' }),
      mk(`RE · ${String(config.tau2 ?? 'reml').toUpperCase()} τ² · HK`, { model: 'random', tau2: config.model === 'random' ? config.tau2 : 'reml', ci: 'hk' }),
      mk('Common-effect · IV', { model: 'fixed', ci: 'z' }),
    ];
  }, [studies, config]);
  const loo = useMemo(() => (config ? leaveOneOut(studies, config.measure, config.model, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studies, config]);

  const plannedFields = ws.analyses.filter(a => a.analysis_type === 'Subgroup' && a.field).map(a => a.field!);
  const groupable = [...new Set([...plannedFields, ...ws.subgroupColumns])];
  const [field, setField] = useState<string>('');
  const activeField = field || groupable[0] || '';
  const subgroups = useMemo(() => (config && activeField
    ? subgroupAnalysis(studies, config.measure, config.model, s => String(((s.evidence as any)?.row ?? {})[activeField] ?? ''), opts)
    : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [studies, config, activeField]);
  const funnel = useMemo(() => (result ? funnelAndEgger(result) : null), [result]);
  const fragility = useMemo(() => (result ? fragilityTable(result.studies) : []), [result]);
  const axis = useMemo(() => (result ? buildAxis(result) : null), [result]);
  const outs = (run?.outputs ?? {}) as Partial<RunOutputs>;

  if (!run || !result || !config) {
    return <EmptyPanel title="No run to diagnose" action={<OutlineButton onClick={() => go({ tab: 'analysis' })}>Go to Analysis</OutlineButton>}>Diagnostics are computed on a run’s stored dataset.</EmptyPanel>;
  }

  const k = result.studies.length;
  const planned = new Set(plannedFields);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={sub} onChange={setSub}
          options={[
            { value: 'sensitivity', label: 'Sensitivity' }, { value: 'subgroups', label: 'Subgroups' },
            { value: 'small', label: 'Small-study effects' }, { value: 'fragility', label: 'Fragility' },
            { value: 'rob', label: 'Risk of bias' },
          ]}
          className="flex-wrap [&>button]:min-w-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12.5px]" />
        <span className="text-[12px] text-gray-500">Computed on run {run.n} · dataset {shortHash(run.dataset_hash)}{run.partial ? ' · partial draft' : ''}</span>
      </div>

      {sub === 'sensitivity' && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {variants.map(v => (
              <div key={v.label} className={`rounded-[10px] px-3.5 py-3 ${v.inUse ? 'border border-[#d4d4d8] bg-[#fafafa] dark:border-[#3a3a3a] dark:bg-[#141414]' : 'border border-[#ececea] dark:border-[#1f1f1f]'}`}>
                <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">{v.label}{v.inUse && <span className="ml-1 normal-case tracking-normal">· in use</span>}</div>
                <div className="mt-1 text-[15px] font-semibold tabular-nums text-[#0a0a0a] dark:text-white">{est(v.r)}</div>
              </div>
            ))}
          </div>
          <div className="text-[12px] text-gray-500">Reading these after the fact is a sensitivity check, not a way to choose — the method in use is the protocol’s (or a logged deviation).</div>

          <div className="mt-2">
            <div className="mb-2 text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Leave-one-out</div>
            {loo ? (
              <TableFrame>
                <div className="min-w-[460px]">
                  <div className="grid grid-cols-[1fr_200px_70px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                    <Th>Omitted study</Th><Th>Pooled {config.measure} (95% CI)</Th><Th className="text-right">I²</Th>
                  </div>
                  {loo.rows.map(r => (
                    <div key={r.key} className={`grid h-9 grid-cols-[1fr_200px_70px] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f] ${r.mostInfluential ? 'bg-[#fffdf5] dark:bg-amber-500/[0.04]' : ''}`}>
                      <span className="truncate text-[12.5px] text-[#374151] dark:text-zinc-300">{r.label}{r.mostInfluential ? ' · most influential' : ''}</span>
                      <span className="text-[12.5px] tabular-nums">{r.est !== null ? formatEffect(r.est, r.lo!, r.hi!) : '—'}</span>
                      <span className="text-right text-[12.5px] tabular-nums text-gray-500">{r.i2 !== null ? `${r.i2.toFixed(0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              </TableFrame>
            ) : <Gate>Leave-one-out needs at least {MIN_LEAVE_ONE_OUT} studies; this run has {k}.</Gate>}
          </div>

          {Object.values(outs.sensitivities ?? {}).length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Planned sensitivity analyses · run {run.n}</div>
              {Object.values(outs.sensitivities ?? {}).map(s => (
                <div key={s.key} className="text-[13px] leading-[20px] text-[#374151] dark:text-zinc-300">
                  {s.label}: {s.est !== null ? `${s.k} studies, ${formatEffect(s.est, s.lo!, s.hi!)}` : `k = ${s.k}, not pooled`}
                  {s.excluded.length ? <span className="text-gray-500"> — excludes {s.excluded.join(', ')}</span> : <span className="text-gray-500"> — no study excluded</span>}
                  {s.key === 'exclude_high_rob' && <span className="text-gray-500"> (study-level judgements)</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sub === 'subgroups' && (
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13px] text-gray-600 dark:text-zinc-400">Grouped by</span>
            {groupable.length ? (
              <Select<string> value={activeField} onChange={setField} options={groupable.map(c => ({ value: c, label: `${c}${planned.has(c) ? ' · prespecified' : ' · exploratory'}` }))} />
            ) : <span className="text-[12.5px] text-gray-500">no groupable column in this dataset</span>}
          </div>
          {activeField && !planned.has(activeField) && <div className="mt-2"><StateText tone="amber">Not prespecified — exploratory. Record it as post-hoc if it goes in the report.</StateText></div>}
          {subgroups && subgroups.rows.length > 0 && axis ? (
            <>
              <TableFrame className="mt-3">
                <div className="min-w-[620px]">
                  <div className="grid grid-cols-[160px_60px_1fr_190px_50px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                    <Th>Subgroup</Th><Th>k</Th><Th /><Th>{config.measure} (95% CI)</Th><Th className="text-right">I²</Th>
                  </div>
                  {subgroups.rows.map(gr => (
                    <div key={gr.name} className="grid h-10 grid-cols-[160px_60px_1fr_190px_50px] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f]">
                      <span className="truncate text-[13px] text-[#0a0a0a] dark:text-zinc-100" title={gr.name}>{gr.name}</span>
                      <span className="text-[12.5px] text-gray-500">{gr.k}</span>
                      <div className="relative h-10 text-gray-300 dark:text-[#2a2a2a]">
                        {gr.poolable && (
                          <>
                            <div className="absolute bottom-0 top-0 w-px bg-current" style={{ left: `${axis.nullX}%` }} />
                            <div className="absolute top-1/2 h-[1.5px] -translate-y-1/2 bg-zinc-700 dark:bg-zinc-300" style={{ left: `${axis.toX(gr.lo!)}%`, width: `${Math.max(axis.toX(gr.hi!) - axis.toX(gr.lo!), 0.5)}%` }} />
                            <div className="absolute top-1/2 h-2.5 w-2.5 bg-blue-500" style={{ left: `${axis.toX(gr.est!)}%`, transform: 'translate(-50%,-50%) rotate(45deg)' }} />
                          </>
                        )}
                      </div>
                      <span className="text-[12.5px] tabular-nums">{gr.poolable ? formatEffect(gr.est!, gr.lo!, gr.hi!) : `k = ${gr.k} < 3 · not pooled`}</span>
                      <span className="text-right text-[12.5px] tabular-nums text-gray-500">{gr.i2 !== null ? `${gr.i2.toFixed(0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              </TableFrame>
              <div className="mt-3 text-[12.5px] tabular-nums text-[#374151] dark:text-zinc-300">
                {subgroups.test
                  ? `Test for subgroup differences: Q = ${subgroups.test.q.toFixed(2)}, df = ${subgroups.test.df}, p = ${formatP(subgroups.test.p)}`
                  : 'Test for subgroup differences not shown — fewer than two subgroups reach k = 3.'}
              </div>
              <div className="mt-1 text-[12px] text-gray-500">Subgroup tests are observational and usually underpowered; a difference is not evidence that the grouping variable explains the effect.</div>
            </>
          ) : <Gate>No column in this run’s dataset labels the studies for grouping.</Gate>}
        </div>
      )}

      {sub === 'small' && funnel && axis && (
        <div>
          {k < MIN_ASYMMETRY_TEST && !showFunnel ? (
            <Gate>
              <div className="font-semibold text-[#0a0a0a] dark:text-white">Not run — k = {k} is below {MIN_ASYMMETRY_TEST}</div>
              Funnel asymmetry tests have almost no power below ten studies, so neither Egger’s test nor a funnel reading is reported for this run.
              <div className="mt-2"><OutlineButton small onClick={() => setShowFunnel(true)}>Show the plot without a test</OutlineButton></div>
            </Gate>
          ) : (
            <>
              <div className="relative mt-2 h-[260px] max-w-[640px] border-b border-l border-gray-200 dark:border-[#2a2a2a]">
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0">
                  {funnel.pseudo && <polygon points={`${axis.toX(funnel.pseudo.apex)},0 ${axis.toX(funnel.pseudo.lo)},100 ${axis.toX(funnel.pseudo.hi)},100`} className="fill-gray-100 dark:fill-[#1a1a1a]" />}
                  {funnel.pseudo && <line x1={axis.toX(funnel.pseudo.apex)} y1="0" x2={axis.toX(funnel.pseudo.apex)} y2="100" strokeWidth="0.4" strokeDasharray="2 2" className="stroke-gray-300 dark:stroke-[#3a3a3a]" />}
                </svg>
                {funnel.points.map(p => (
                  <span key={p.key} title={`${p.label} · ${p.effect.toFixed(2)}`}
                    className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-900 ring-2 ring-white dark:bg-zinc-100 dark:ring-[#111111]"
                    style={{ left: `${axis.toX(p.effect)}%`, top: `${(p.se / funnel.maxSe) * 100}%` }} />
                ))}
              </div>
              <div className="mt-1 flex max-w-[640px] justify-between text-[11px] text-gray-400">
                <span>{formatTick(axis.min)}</span><span>{EFFECT_LABEL[config.measure]}{axis.log ? ' (log scale)' : ''} · SE downwards</span><span>{formatTick(axis.max)}</span>
              </div>
              <div className="mt-3 text-[12.5px] tabular-nums text-[#374151] dark:text-zinc-300">
                {k >= MIN_ASYMMETRY_TEST && funnel.egger
                  ? `Egger's test: intercept ${funnel.egger.intercept.toFixed(2)} (SE ${funnel.egger.se.toFixed(2)}), t = ${funnel.egger.t.toFixed(2)} on ${funnel.egger.df} df, p = ${formatP(funnel.egger.p)}`
                  : `Egger's test not run (k = ${k} < ${MIN_ASYMMETRY_TEST}) — the plot is shown for description only.`}
              </div>
            </>
          )}
          <div className="mt-3 text-[12px] text-gray-500">Meta-regression is allowed with a method-specific warning: with few studies per covariate its estimates are unstable and it is observational across studies. The engine does not compute it; record it as not run with a reason on Results if it was planned.</div>
        </div>
      )}

      {sub === 'fragility' && (
        <div>
          <div className="text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">How many patients’ outcomes would have to change before each trial stopped being significant on its own (Walsh et al. 2014, Fisher’s exact test).</div>
          {fragilitySummary(fragility) && <div className="mt-2 text-[13px] text-[#374151] dark:text-zinc-300">{fragilitySummary(fragility)}</div>}
          <TableFrame className="mt-3">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[1fr_90px_90px_1.4fr] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Study</Th><Th className="text-right">Exact p</Th><Th className="text-right">Fragility</Th><Th>Reading</Th>
              </div>
              {fragility.map(r => (
                <div key={r.key} className="grid h-9 grid-cols-[1fr_90px_90px_1.4fr] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f]">
                  <span className="truncate text-[12.5px]">{r.label}</span>
                  <span className="text-right text-[12.5px] tabular-nums">{r.p != null ? formatP(r.p) : '—'}</span>
                  <span className="text-right text-[12.5px] font-semibold tabular-nums">{r.outcome.kind === 'fragile' ? r.outcome.index : '—'}</span>
                  <span className="truncate text-[12px] text-gray-500">
                    {r.outcome.kind === 'fragile' ? `${r.outcome.index} flipped (FQ ${r.outcome.quotient.toFixed(3)})`
                      : r.outcome.kind === 'not_significant' ? 'not significant on its own'
                        : r.outcome.kind === 'not_computable' ? 'stayed significant through every flip' : 'no 2×2 counts'}
                  </span>
                </div>
              ))}
            </div>
          </TableFrame>
        </div>
      )}

      {sub === 'rob' && (
        <div>
          <div className="text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">
            Study-level: the worst completed overall RoB 2 judgement among each study’s assessments (consensus preferred). Result-level identity needs the result registry, which this synthesis does not use, so no judgement here is specific to the result pooled.
          </div>
          <TableFrame className="mt-3">
            <div className="min-w-[480px]">
              <div className="grid grid-cols-[1fr_170px_170px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Study</Th><Th>Study-level judgement</Th><Th>Assessments</Th>
              </div>
              {result.studies.map(s => {
                const r = syn.rob.byDoc.get(s.documentId);
                return (
                  <div key={s.key} className="grid h-10 grid-cols-[1fr_170px_170px] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f]">
                    <span className="truncate text-[13px]">{s.label}</span>
                    <span className={`text-[12.5px] font-medium ${r?.overall ? ROB[r.overall][1] : 'text-[#9ca3af]'}`}>{r?.overall ? ROB[r.overall][0] : 'Not assessed'}</span>
                    <span className="text-[12.5px] text-gray-500">{r ? `${r.completed} of ${r.assessments} complete${r.source === 'consensus' ? ' · consensus' : ''}` : '—'}</span>
                  </div>
                );
              })}
            </div>
          </TableFrame>
          {outs.sensitivities?.exclude_high_rob && (
            <div className="mt-3 text-[13px] text-[#374151] dark:text-zinc-300">
              Sensitivity · excluding high risk of bias (study-level): {outs.sensitivities.exclude_high_rob.est !== null
                ? `${outs.sensitivities.exclude_high_rob.k} studies, ${formatEffect(outs.sensitivities.exclude_high_rob.est, outs.sensitivities.exclude_high_rob.lo!, outs.sensitivities.exclude_high_rob.hi!)}`
                : 'too few studies remain'}.
            </div>
          )}
          {ws.robMissing.length > 0 && <div className="mt-2"><StateText tone="amber">Not assessed: {ws.robMissing.join(', ')} — treated as missing, never inherited.</StateText></div>}
        </div>
      )}
    </div>
  );
}
