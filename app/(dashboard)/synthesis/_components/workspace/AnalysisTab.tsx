'use client';

/**
 * Analysis — the method preset comes from the protocol; any other preset is a
 * logged deviation with a reason. Run computes on the client engine and posts
 * the dataset, config and outputs; the server re-hashes the dataset and
 * refuses a mismatch. Everything shown below the run box is computed on the
 * DISPLAYED run's stored snapshot, never on the live dataset — so a caption
 * can never describe numbers the run did not produce.
 */

import { useMemo, useState } from 'react';

import {
  EFFECT_LABEL, isSingleGroupMeasure, poolingMethodsFor, type EffectMeasure, type StudyEffect,
} from '@/lib/metaAnalysis';
import type { SynthesisPreset, SynthesisRun } from '@/services/synthesis.service';
import { shortHash } from '../../_lib/datasetHash';
import { designGuards } from '../../_lib/designGuards';
import { useSynthesisNav } from '../../_lib/nav';
import { plainReading } from '../../_lib/plainReading';
import { runContext, runSnapshotCsv, runSnapshotResult } from '../../_lib/runSnapshot';
import {
  ENGINE_VERSION, PRESET_REF, computeRunOutputs, presetEquals, presetLabel, postHocProposals,
  runBranchOf, type DatasetRow, type RunOutputs,
} from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { AbsoluteEffectCard } from '../AbsoluteEffectCard';
import { DesignGuardCard } from '../DesignGuardCard';
import { ForestPlot } from '../ForestPlot';
import {
  Banner, EmptyPanel, Mono, OutlineButton, PrimaryButton, ReasonInput, SectionTitle, StateText, when,
} from '../ui';

/**
 * The run the `run` URL param names, when it belongs to `branch`; otherwise
 * the latest run of that branch. A SWiM run is never read as a meta-analysis
 * (and vice versa), even after the synthesis switched branch.
 */
export function displayedRun(ws: WorkspaceState, param: string, branch: 'ma' | 'swim' = 'ma'): SynthesisRun | null {
  const n = Number(param);
  const ofBranch = ws.runs.filter(r => runBranchOf(r) === branch);
  const requested = param && Number.isFinite(n) ? ofBranch.find(r => r.n === n) : undefined;
  return requested ?? ofBranch[ofBranch.length - 1] ?? null;
}

/**
 * The side of the null line a lower effect favours, from the run's own config
 * (`lower_is_benefit`, from the target's sign convention). Older runs without
 * the flag read as "lower favours the intervention", the default convention.
 */
export function leftFavoursOf(run: SynthesisRun | null | undefined): 'treatment' | 'comparator' {
  const lower = (run?.config as Record<string, unknown> | undefined)?.lower_is_benefit;
  return lower === false ? 'comparator' : 'treatment';
}

/** A saved run's result, read from its stored outputs (see `_lib/runSnapshot`). */
export function runResult(run: SynthesisRun, comparatorRisk: number | null = null) {
  return runSnapshotResult(run, comparatorRisk).result;
}

export function runCsv(run: SynthesisRun, fileBase: string) {
  runSnapshotCsv(run, fileBase);
}

/** "…recomputed with the current engine" / drift notes for a saved run. */
export function SnapshotNote({ recomputed, drift, targetLive, midLive, engine }: {
  recomputed: boolean; drift: boolean; targetLive: boolean; midLive: boolean; engine: string;
}) {
  const parts = [
    recomputed && `This run has no stored per-study outputs — its numbers are recomputed with the current engine (${ENGINE_VERSION}) on its stored dataset and config.`,
    !recomputed && drift && `Numbers shown are the run's stored outputs (${engine}); the current engine (${ENGINE_VERSION}) would compute some of them differently.`,
    (targetLive || midLive) && `No saved snapshot of this run's ${[targetLive && 'target labels', midLive && 'MID'].filter(Boolean).join(' or ')} — the current ${targetLive && midLive ? 'values are' : 'value is'} shown.`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return <div className="text-[11.5px] text-gray-500 dark:text-zinc-500">{parts.join(' ')}</div>;
}

export function AnalysisTab({ ws, openStudy }: { ws: WorkspaceState; openStudy: (d: string) => void }) {
  const syn = useSynthesis();
  const { get, go } = useSynthesisNav();
  const m = ws.model;
  const g = ws.group;
  const decisions = ws.bundle?.decisions ?? [];
  const [pending, setPending] = useState<SynthesisPreset | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assumedRisk, setAssumedRisk] = useState('');

  const run = displayedRun(ws, get('run'));
  const isLatest = run?.id === ws.latestRun?.id;
  const riskValue = useMemo(() => {
    const n = Number(assumedRisk.replace('%', '').trim());
    return assumedRisk.trim() !== '' && Number.isFinite(n) && n > 0 && n < 100 ? n / 100 : null;
  }, [assumedRisk]);
  const snap = useMemo(() => (run ? runSnapshotResult(run, riskValue) : null), [run, riskValue]);
  const result = snap?.result ?? null;
  const outputs = (run?.outputs ?? null) as RunOutputs | null;
  // Labels, MID and kind of the DISPLAYED run, from its snapshot; the live
  // target is used only when the run predates the snapshot fields.
  const ctx = useMemo(() => (run ? runContext(run, ws.bundle?.versions ?? [], decisions, g.target) : null), [run, ws.bundle?.versions, decisions, g.target]);
  const runTarget = ctx?.target ?? g.target;
  const runKind = ((run?.dataset?.[0] as DatasetRow | undefined)?.kind ?? m.kind);
  const liveMatches = isLatest && !ws.diff.stale;
  const comparisonLabel = `${runTarget.comparison.intervention || 'Intervention'} vs ${runTarget.comparison.comparator || 'comparator'}`;

  // Evidence for the drawer comes from the live studies by document id.
  const onOpen = (s: StudyEffect) => openStudy(s.documentId);

  const hasArms = m.kind === 'dichotomous' || m.kind === 'continuous';
  const models = poolingMethodsFor(m.measure as EffectMeasure, hasArms);
  const candidatesP: SynthesisPreset[] = [
    m.protocolPreset,
    { model: 'random', tau2: 'reml', ci: 'hk' },
    { model: 'random', tau2: 'dl', ci: 'z' },
    { model: 'random', tau2: 'pm', ci: 'hk' },
    { model: 'fixed', tau2: 'dl', ci: 'z' },
    { model: 'mh', tau2: 'dl', ci: 'z' },
    { model: 'peto', tau2: 'dl', ci: 'z' },
  ];
  const presetOptions = candidatesP.filter((p, i, all) => all.findIndex(q => presetEquals(p, q)) === i && models.includes(p.model));

  const choosePreset = async (p: SynthesisPreset) => {
    setError(null);
    if (presetEquals(p, m.preset)) { setPending(null); return; }
    if (presetEquals(p, m.protocolPreset) && m.presetDeviation) {
      // Back to the protocol: the deviation is revoked, not overwritten.
      setBusy(true);
      try { await syn.revokeDecision(g.id, m.presetDeviation.id, null); setPending(null); }
      catch (e: any) { setError(e?.message ?? 'Could not revert.'); } finally { setBusy(false); }
      return;
    }
    setPending(p); setReason('');
  };
  const logDeviation = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      await syn.addDecision(g.id, {
        kind: 'deviation', target_ref: PRESET_REF,
        value: { preset: pending, from: m.protocolPreset, what: `Method preset ${presetLabel(m.protocolPreset)} → ${presetLabel(pending)}` },
        reason: reason.trim(),
      });
      setPending(null); setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not log the deviation.'); } finally { setBusy(false); }
  };

  const k = m.dataset.length;
  const n = m.potential;
  const partial = m.blocking.length > 0;
  const doRun = async () => {
    setBusy(true); setError(null);
    try {
      const outs = computeRunOutputs(m.datasetStudies, ws.config, ws.analyses, syn.rob.high, syn.rob.assessed);
      const omitted = m.studies
        .filter(s => !s.inDataset && (s.eligibility === 'needs_decision' || (s.eligibility === 'eligible' && s.readiness !== 'excluded')))
        .map(s => ({ ref: s.ref, label: s.label, why: s.eligibility === 'needs_decision' ? s.eligibilityReason : s.readinessReason }));
      await syn.createRun(g.id, {
        dataset: ws.dataset, dataset_hash: ws.hash,
        config: ws.config as unknown as Record<string, unknown>,
        outputs: outs as unknown as Record<string, unknown>,
        partial, omitted, engine_version: ENGINE_VERSION,
      });
      go({ run: null });
    } catch (e: any) { setError(e?.message ?? 'The run could not be saved.'); } finally { setBusy(false); }
  };

  const proposals = useMemo(() => postHocProposals(m, ws.analyses, syn.rob.high, outputs?.influence?.label ?? null),
    [m, ws.analyses, syn.rob.high, outputs]);
  const addPostHoc = async (p: (typeof proposals)[number]) => {
    setBusy(true); setError(null);
    try {
      await syn.addDecision(g.id, {
        kind: 'post_hoc_add', target_ref: `analysis:posthoc:${p.id}`,
        value: { id: `posthoc_${p.id}`, analysis_type: p.analysis_type, description: p.description, field: p.field, trigger: p.trigger },
        reason: null, provenance: { catalogue: 'synthesis post-hoc catalogue v1', trigger: p.trigger },
      });
    } catch (e: any) { setError(e?.message ?? 'Could not add the analysis.'); } finally { setBusy(false); }
  };

  const guards = useMemo(() => (result ? designGuards(result.studies, syn.designByDocument, result.measure) : null), [result, syn.designByDocument]);
  const reading = result ? plainReading(result, { outcomeLabel: runTarget.outcome, comparisonLabel: `${runTarget.comparison.intervention || 'intervention'} vs ${runTarget.comparison.comparator || 'comparator'}` }) : [];

  if (!m.targetConfirmed) {
    return <EmptyPanel title="Confirm the target first" action={<OutlineButton onClick={() => go({ tab: 'target' })}>Go to Target</OutlineButton>}>Runs are computed on the dataset the confirmed target derives.</EmptyPanel>;
  }

  const hetLine = result?.heterogeneity
    ? `τ² = ${result.heterogeneity.tau2.toFixed(3)} (${String(result.tau2Method).toUpperCase()}); I² = ${result.heterogeneity.i2.toFixed(0)}%${result.heterogeneity.i2Lo != null && result.heterogeneity.i2Hi != null ? ` (95% CI ${result.heterogeneity.i2Lo.toFixed(0)}–${result.heterogeneity.i2Hi.toFixed(0)}%)` : ''}. ${result.prediction ? `The prediction interval runs ${result.prediction.lo.toFixed(2)} to ${result.prediction.hi.toFixed(2)} — where a new study's effect is expected to fall.` : result.predictionSuppressed ? `No prediction interval (${result.predictionSuppressed}).` : ''} Descriptive only: variation is not explained by any variable here.`
    : 'No heterogeneity statistics for this run.';

  return (
    <div className="flex flex-col gap-6">
      {/* Control strip */}
      <div className="flex flex-col gap-4 rounded-[12px] border border-[#ececea] px-4 py-4 lg:flex-row lg:items-start dark:border-[#1f1f1f]">
        <div className="min-w-[140px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Effect</div>
          <div className="mt-1 text-[13.5px] font-medium text-[#0a0a0a] dark:text-white">{m.measure} · {EFFECT_LABEL[m.measure]}</div>
          <div className="text-[11.5px] text-gray-500">validated · read-only</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Method preset</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {presetOptions.map(p => {
              const on = presetEquals(p, pending ?? m.preset);
              return (
                <button key={presetLabel(p)} type="button" disabled={!syn.canEdit || busy} onClick={() => choosePreset(p)}
                  className={`rounded-[7px] border px-3 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed ${on ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900' : 'border-[#e4e4e7] text-[#374151] hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-300'}`}>
                  {presetLabel(p)}{presetEquals(p, m.protocolPreset) ? ' · protocol' : ''}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 text-[12px]">
            {m.presetDeviation ? <StateText tone="amber">Deviation logged — “{m.presetDeviation.reason}”</StateText> : <StateText tone="muted">✓ matches protocol</StateText>}
          </div>
        </div>
        <div className="min-w-[110px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">MID</div>
          <div className="mt-1 text-[13.5px] text-[#0a0a0a] dark:text-white">{g.target.mid.value ?? '—'}</div>
          <div className="text-[11.5px] text-gray-500">from target</div>
        </div>
        <div className="flex flex-col items-start gap-1 lg:items-end">
          {syn.canEdit && (
            <PrimaryButton disabled={busy || k === 0} onClick={doRun}>
              {partial ? `Run draft with ${k} of ${n}` : `Run analysis · ${k} ${k === 1 ? 'study' : 'studies'}`}
            </PrimaryButton>
          )}
          {partial && <div className="max-w-[240px] text-[11.5px] text-gray-500 lg:text-right">{m.blocking.length} open item{m.blocking.length === 1 ? '' : 's'} — a draft run is marked partial and cannot be finalized.</div>}
        </div>
      </div>

      {pending && (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-[#fde68a] bg-[#fffdf5] px-5 py-4 dark:border-amber-900/60 dark:bg-amber-500/[0.03]">
          <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Deviation from protocol · {presetLabel(m.protocolPreset)} → {presetLabel(pending)}</div>
          <div className="text-[13px] text-gray-600 dark:text-zinc-400">The protocol prespecifies {presetLabel(m.protocolPreset)}. A different method is allowed as a logged deviation; the methods text and the audit will say so.</div>
          <ReasonInput value={reason} onChange={setReason} autoFocus />
          <div className="flex gap-2">
            <PrimaryButton disabled={busy || !reason.trim()} onClick={logDeviation}>Log deviation and apply</PrimaryButton>
            <OutlineButton onClick={() => setPending(null)}>Cancel</OutlineButton>
          </div>
        </div>
      )}
      {error && <Banner tone="red">{error}</Banner>}

      {/* Run box */}
      {!run ? (
        <EmptyPanel title="No run yet">
          {k === 0 ? 'No study is ready — resolve the items on Evidence and Harmonization.' : `Run the analysis to compute on the ${k} ready ${k === 1 ? 'study' : 'studies'}. Every run is kept with its dataset hash.`}
        </EmptyPanel>
      ) : (
        <div className="rounded-[12px] bg-[#fafafa] px-5 py-4 dark:bg-[#141414]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-[#374151] dark:text-zinc-300">
            <span className="font-semibold text-[#0a0a0a] dark:text-white">Run {run.n}</span>
            <span>{when(run.at)}</span>
            <span>{run.by_name ?? syn.nameOf(run.by)}</span>
            <Mono>dataset {shortHash(run.dataset_hash)}</Mono>
            <span>{presetLabel({ model: (run.config as any).model, tau2: (run.config as any).tau2, ci: (run.config as any).ci })}</span>
            {run.partial && <StateText tone="amber">partial draft</StateText>}
            {!isLatest && <button type="button" onClick={() => go({ run: null })} className="text-[12.5px] underline">Show latest run</button>}
          </div>
          {isLatest && ws.diff.stale && (
            <div className="mt-2 text-[12.5px] text-[#92400e] dark:text-amber-300">Stale — the current dataset is {shortHash(ws.hash)}: {ws.diff.text}. Re-run to update.</div>
          )}
          {isLatest && !ws.diff.stale && <div className="mt-2 text-[12.5px] text-[#047857] dark:text-emerald-400">Matches the current dataset.</div>}
          {run.omitted.length > 0 && (
            <div className="mt-2 text-[12.5px] text-gray-600 dark:text-zinc-400">
              Omitted from this run: {run.omitted.map(o => `${o.label} (${o.why})`).join('; ')}
            </div>
          )}
        </div>
      )}

      {run && result && (
        <>
          {result.studies.length === 0 ? (
            <EmptyPanel title="Nothing estimable in this run">Every study in the snapshot was not estimable for {result.measure}.</EmptyPanel>
          ) : (
            <ForestPlot
              result={result}
              outcomeLabel={runTarget.outcome}
              comparisonLabel={comparisonLabel}
              treatmentHeading={isSingleGroupMeasure(result.measure) ? 'Events / n' : runKind === 'effect' ? 'As reported' : runKind === 'dichotomous' ? 'Intervention n/N' : 'Intervention'}
              comparatorHeading={isSingleGroupMeasure(result.measure) ? 'Observed' : runKind === 'effect' ? 'Precision' : runKind === 'dichotomous' ? 'Comparator n/N' : 'Comparator'}
              onOpenStudy={onOpen}
              onExport={() => runCsv(run, g.title)}
              onDiagnostics={() => go({ tab: 'diagnostics' })}
              fileBase={`${g.title}-run${run.n}`}
              mid={ctx?.mid ?? null}
              leftFavours={leftFavoursOf(run)}
            />
          )}
          <div className="-mt-3 flex flex-col gap-1">
            <div className="text-[11.5px] text-gray-500 dark:text-zinc-500">
              Shaded: within the MID{ctx?.mid != null ? ` (${ctx.mid})` : ''} · dashed: 95% prediction interval (shown from k = 5) · † SD derived rather than reported · {snap?.recomputed ? 'computed' : 'stored outputs of'} run {run.n}, dataset {shortHash(run.dataset_hash)}.
            </div>
            {snap && ctx && (
              <SnapshotNote recomputed={snap.recomputed} drift={snap.drift} engine={run.engine_version}
                targetLive={!ctx.targetFromSnapshot && !liveMatches} midLive={!ctx.midFromSnapshot && !liveMatches} />
            )}
          </div>

          <section className="border-t border-[#ececea] pt-5 dark:border-[#1f1f1f]">
            <SectionTitle>What this says</SectionTitle>
            <div className="flex flex-col gap-2">
              {reading.map((p, i) => <p key={i} className={i === 0 ? 'text-[13.5px] leading-[21px] text-[#0a0a0a] dark:text-zinc-100' : 'text-[13px] leading-[20px] text-gray-600 dark:text-zinc-400'}>{p}</p>)}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-[10px] bg-[#fafafa] px-4 py-3 dark:bg-[#141414]">
                <div className="text-[12px] font-semibold text-gray-600 dark:text-zinc-300">Variation across studies · descriptive</div>
                <div className="mt-1 text-[12.5px] leading-[19px] text-[#374151] dark:text-zinc-300">{hetLine}</div>
              </div>
              <div className="rounded-[10px] bg-[#fafafa] px-4 py-3 dark:bg-[#141414]">
                <div className="text-[12px] font-semibold text-gray-600 dark:text-zinc-300">Influence · from leave-one-out</div>
                <div className="mt-1 text-[12.5px] leading-[19px] text-[#374151] dark:text-zinc-300">
                  {outputs?.influence
                    ? `${outputs.influence.label} produces the largest change when omitted (${outputs.influence.est.toFixed(2)}, ${outputs.influence.lo.toFixed(2)} to ${outputs.influence.hi.toFixed(2)}). Influence is not a reason for exclusion.`
                    : 'Leave-one-out needs at least four studies.'}
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-[#ececea] pt-5 dark:border-[#1f1f1f]">
            <SectionTitle right={<span className="text-[12px] text-gray-500">you add, the engine computes</span>}>Proposed post-hoc analyses · from catalogue</SectionTitle>
            {proposals.length === 0 ? (
              <div className="text-[12.5px] text-gray-500">No catalogue trigger fires for this dataset. Triggers are properties of the data (derived SDs, an ICC assumption, high risk of bias, an influential study) — never the direction of a result.</div>
            ) : proposals.map(p => (
              <div key={p.id} className="grid grid-cols-1 items-center gap-2 border-t border-[#ececea] py-2.5 first:border-t-0 sm:grid-cols-[1fr_1fr_150px] dark:border-[#1f1f1f]">
                <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">{p.trigger}</span>
                <span className="text-[13px] text-[#0a0a0a] dark:text-zinc-100">{p.description}</span>
                <span className="sm:text-right">
                  {p.alreadyPlanned ? <StateText tone="muted">already planned</StateText>
                    : syn.canEdit ? <OutlineButton small disabled={busy} onClick={() => addPostHoc(p)}>Add · post-hoc</OutlineButton> : null}
                </span>
              </div>
            ))}
            {proposals.some(p => !p.alreadyPlanned) && <div className="mt-1 text-[11.5px] text-gray-500">Added analyses are labelled post-hoc and computed on the next run.</div>}
          </section>

          {result.pooled && !isSingleGroupMeasure(result.measure) && (
            <AbsoluteEffectCard result={result} assumedRisk={assumedRisk} onAssumedRisk={setAssumedRisk} />
          )}
          {guards && <DesignGuardCard checks={guards} sourceLabel={syn.designSourceLabel} />}
        </>
      )}
    </div>
  );
}
