/**
 * Reading a SAVED run back exactly as it was recorded.
 *
 * A run stores its dataset, its config and its outputs; a finalized version
 * additionally stores the target it was frozen under. Anything shown for a
 * saved run — the forest plot, the CSV, labels, the MID, the transformations
 * and deviations in force, the methods line — is read from those, never from
 * the live workspace. The current engine is used only to lay the plot out (it
 * needs per-study arms); every number it would draw is replaced by the stored
 * output. Where an older run lacks a field, the caller falls back to live
 * state and says so (`recomputed` / `*FromSnapshot = false`).
 */

import type {
  SynthesisDecision, SynthesisRun, SynthesisTarget, SynthesisVersion,
} from '@/services/synthesis.service';
import {
  TRANSFORM_NAME, analysisConfigKey, readAs, runBranchOf, runMeta, studiesFromDataset,
  type DatasetRow, type RunConfig, type RunOutputs,
} from './synthesisModel';

// ── Run identity ─────────────────────────────────────────────────────────────

/**
 * The full analysis-config fingerprint of a stored run: every config key
 * (method, MID, proportion method, sign convention, SWiM grouping…) plus the
 * branch. Two runs with the same dataset hash and the same key describe the
 * same analysis; a changed method is a different one.
 */
export function runConfigKey(run: Pick<SynthesisRun, 'config'>): string {
  return analysisConfigKey(run.config ?? {}, { branch: runBranchOf(run) }) + '|' + runBranchOf(run);
}

/** Same run, or the same analysis on the same data. */
export function sameAnalysis(a: SynthesisRun | null | undefined, b: SynthesisRun | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  return a.dataset_hash === b.dataset_hash && runConfigKey(a) === runConfigKey(b);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

export type SnapshotMeta = ReturnType<typeof readAs>;

export interface RunSnapshotResult {
  result: SnapshotMeta;
  /** True when the run has no stored per-study outputs and the numbers are the current engine's. */
  recomputed: boolean;
  /** True when the current engine would give different numbers than the ones stored (and shown). */
  drift: boolean;
}

const near = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

/**
 * The run's result with every stored number laid over the engine's layout.
 * Study order, labels, estimates, CIs and weights come from `outputs.studies`;
 * the pooled estimate, heterogeneity, prediction and CI method from the other
 * stored outputs. Absolute effects (which depend on a reader-entered risk) are
 * the one live computation, and they use the run's stored config.
 */
export function runSnapshotResult(run: SynthesisRun, comparatorRisk: number | null = null): RunSnapshotResult {
  const config = run.config as unknown as RunConfig;
  const base = readAs(runMeta(studiesFromDataset(run.dataset), config, { comparatorRisk }));
  const o = (run.outputs ?? {}) as Partial<RunOutputs>;
  if (!Array.isArray(o.studies) || typeof o.k !== 'number') return { result: base, recomputed: true, drift: false };

  const byKey = new Map(base.studies.map(s => [s.key, s]));
  let drift = base.studies.length !== o.studies.length;
  const studies: SnapshotMeta['studies'] = [];
  for (const st of o.studies) {
    const s = byKey.get(st.ref);
    if (!s) { drift = true; continue; }
    if (!near(s.est, st.est) || !near(s.lo, st.lo) || !near(s.hi, st.hi) || !near(s.weightPct, st.weight)) drift = true;
    studies.push({ ...s, label: st.label, est: st.est, lo: st.lo, hi: st.hi, weightPct: st.weight });
  }
  const pooled = 'pooled' in o ? (o.pooled ?? null) : base.pooled;
  if (!near(pooled?.est, base.pooled?.est) || !near(pooled?.lo, base.pooled?.lo) || !near(pooled?.hi, base.pooled?.hi)) drift = true;
  return {
    recomputed: false,
    drift,
    result: {
      ...base,
      studies,
      pooled,
      zInterval: 'z_interval' in o ? (o.z_interval ?? null) : base.zInterval,
      hksj: 'hksj' in o ? (o.hksj ?? null) : base.hksj,
      heterogeneity: 'heterogeneity' in o ? (o.heterogeneity ?? null) : base.heterogeneity,
      prediction: 'prediction' in o ? (o.prediction ?? null) : base.prediction,
      predictionSuppressed: 'prediction_suppressed' in o ? (o.prediction_suppressed ?? null) : base.predictionSuppressed,
      tau2Method: (o.tau2_method as SnapshotMeta['tau2Method']) ?? base.tau2Method,
      ciMethod: (o.ci_method as SnapshotMeta['ciMethod']) ?? base.ciMethod,
      model: o.model ?? base.model,
      measure: o.measure ?? base.measure,
      totals: o.totals ?? base.totals,
      overallEffect: o.overall ?? base.overallEffect,
    },
  };
}

/** CSV of a saved run, from its stored outputs (falls back to the engine for runs without them). */
export function runSnapshotCsv(run: SynthesisRun, fileBase: string) {
  const { result: r, recomputed } = runSnapshotResult(run);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Study', r.measure, 'CI lower', 'CI upper', 'Weight %', 'Derived SD'].join(',')];
  for (const s of r.studies) lines.push([s.label, s.est.toFixed(4), s.lo.toFixed(4), s.hi.toFixed(4), s.weightPct.toFixed(2), (s.evidence as any)?.derived ? 'yes' : ''].map(esc).join(','));
  if (r.pooled) lines.push(['Total', r.pooled.est.toFixed(4), r.pooled.lo.toFixed(4), r.pooled.hi.toFixed(4), '100.00', ''].map(esc).join(','));
  lines.push('', `# run ${run.n} · dataset ${run.dataset_hash} · ${run.engine_version}${recomputed ? ' · no stored per-study outputs: recomputed with the current engine' : ' · from stored run outputs'}`);
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${fileBase.replace(/\W+/g, '_')}_run${run.n}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Context: target, MID, transformations, deviations ────────────────────────

export interface RunContext {
  target: SynthesisTarget;
  /** False when no version froze this run's target and the live target is shown. */
  targetFromSnapshot: boolean;
  mid: number | null;
  midFromSnapshot: boolean;
  /** Confirmed transformations applied in the run's dataset, from the stored decision ids. */
  transformations: Array<{ id: string; name: string; label: string }>;
  /** Deviations in force when the run was recorded. */
  deviations: SynthesisDecision[];
}

export function runContext(
  run: SynthesisRun, versions: SynthesisVersion[], decisions: SynthesisDecision[], liveTarget: SynthesisTarget,
): RunContext {
  const frozen = [...versions].filter(v => v.run_id === run.id).sort((a, b) => b.n - a.n)[0];
  const frozenTarget = (frozen?.bundle as { target?: SynthesisTarget } | undefined)?.target;
  const cfg = (run.config ?? {}) as Record<string, unknown>;
  const midFromSnapshot = 'mid' in cfg;
  const mid = midFromSnapshot ? ((cfg.mid as number | null) ?? null) : (liveTarget.mid?.value ?? null);
  const baseTarget = frozenTarget ?? liveTarget;
  const target: SynthesisTarget = { ...baseTarget, mid: { scale: baseTarget.mid?.scale ?? null, source: baseTarget.mid?.source ?? null, value: mid } };

  const byId = new Map(decisions.map(d => [d.id, d]));
  const seen = new Set<string>();
  const transformations: RunContext['transformations'] = [];
  for (const row of (run.dataset ?? []) as DatasetRow[]) {
    for (const id of row?.transformations ?? []) {
      if (seen.has(`${row.ref}|${id}`)) continue;
      seen.add(`${row.ref}|${id}`);
      const d = byId.get(id);
      const kind = d?.target_ref.match(/:transform:([a-z_]+)$/)?.[1] ?? '';
      const name = (TRANSFORM_NAME as Record<string, string>)[kind] ?? (kind ? kind.replace(/_/g, ' ') : 'transformation');
      transformations.push({ id, name, label: row.label });
    }
  }
  const at = run.at;
  const deviations = decisions.filter(d => d.kind === 'deviation' && d.at <= at && (!d.revoked_at || d.revoked_at > at));
  return { target, targetFromSnapshot: !!frozenTarget, mid, midFromSnapshot, transformations, deviations };
}
