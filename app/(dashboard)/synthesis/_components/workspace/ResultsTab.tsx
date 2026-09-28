'use client';

/**
 * Results — a deterministic narrative built from the latest run's outputs
 * (every sentence carries its reference), the methods from engine metadata,
 * exports, the live pre-finalization audit and the role-gated Finalize /
 * Approve card. The server enforces the same gates; this screen shows why a
 * button is disabled rather than letting a request fail.
 */

import { useMemo, useState } from 'react';

import { downloadSvg, downloadSvgAsImage, slugify } from '@/lib/rasterizeSvg';
import { shortHash } from '../../_lib/datasetHash';
import { buildForestSvg } from '../../_lib/forestSvg';
import { useSynthesisNav } from '../../_lib/nav';
import { runContext, runSnapshotResult, sameAnalysis } from '../../_lib/runSnapshot';
import { voteText } from '../../_lib/swim';
import {
  ENGINE_VERSION, analysisRef, presetLabel, resultsNarrative, type NarrativeSentence,
  runBranchOf,
} from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { MethodsPanel } from '../MethodsPanel';
import { SnapshotNote, leftFavoursOf, runCsv } from './AnalysisTab';
import {
  Banner, Chip, Collapsible, EmptyPanel, Mono, OutlineButton, PrimaryButton, ReasonInput, SectionTitle, StateText, day,
} from '../ui';

export function ResultsTab({ ws }: { ws: WorkspaceState }) {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const g = ws.group;
  const run = ws.latestRun;
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [notRunFor, setNotRunFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the RUN is, not what the synthesis is now: after a branch change the
  // latest run can still be a meta-analysis, and must be described as one.
  const swimRun = runBranchOf(run) === 'swim';
  // Everything below describes the run as SAVED: numbers from its stored
  // outputs, labels / MID / transformations / deviations from its snapshot.
  const snap = useMemo(() => (run && !swimRun ? runSnapshotResult(run) : null), [run, swimRun]);
  const result = snap?.result ?? null;
  const ctx = useMemo(() => (run ? runContext(run, ws.bundle?.versions ?? [], ws.bundle?.decisions ?? [], g.target) : null),
    [run, ws.bundle?.versions, ws.bundle?.decisions, g.target]);
  const runTarget = ctx?.target ?? g.target;
  const comparisonLabel = `${runTarget.comparison.intervention || 'Intervention'} vs ${runTarget.comparison.comparator || 'comparator'}`;

  const narrative: NarrativeSentence[] = useMemo(() => {
    if (!run) return [];
    if (swimRun) {
      const o = run.outputs as any;
      const success = ((run.config as any)?.success ?? 'benefit') as 'benefit' | 'harm';
      const out: NarrativeSentence[] = [{ text: `${(run.dataset as unknown[]).length} studies contributed to structured synthesis run ${run.n} of ${runTarget.outcome}; results were not pooled.`, ref: `dataset ${shortHash(run.dataset_hash)}` }];
      for (const gr of (o?.swim ?? []) as Array<{ name: string; count: any; rows: unknown[] }>) {
        out.push({ text: `${gr.name}: ${voteText(gr.count, success)}.`, ref: `group · ${gr.rows.length} results` });
      }
      return out;
    }
    return resultsNarrative(run, runTarget, shortHash);
  }, [run, swimRun, runTarget]);

  const versions = [...(ws.bundle?.versions ?? [])].sort((a, b) => b.n - a.n);
  const live = versions.find(v => !v.superseded_by) ?? null;
  const roles = syn.protocol.roles;
  const isFinalizer = !!roles.finalizer && roles.finalizer === syn.currentUserId;
  const isApprover = !!roles.approver && roles.approver === syn.currentUserId;
  const needsReview = ws.status.key === 'needs_review';
  // A version covers the latest run when it froze that run, or the same
  // analysis (dataset hash + branch + full config) — not merely the same data:
  // a re-run with a changed method is a new analysis that can replace it.
  const liveRun = live ? ws.runs.find(r => r.id === live.run_id) ?? null : null;
  const liveCoversRun = !!live && !!run && (live.run_id === run.id || sameAnalysis(liveRun, run));
  const awaiting = live?.status === 'awaiting';
  // Only a CURRENT awaiting version blocks finalizing. One made stale by
  // changed evidence, a branch change or a re-run with another method is
  // superseded by the next finalization (the server withdraws it).
  const awaitingCurrent = awaiting && !needsReview && liveCoversRun;
  const alreadyFinal = !!live && live.status === 'finalized' && !needsReview && liveCoversRun;
  const canFinalize = ws.auditPass && isFinalizer && !!run && !alreadyFinal && !awaitingCurrent;
  const replacesNote = !live || awaitingCurrent || alreadyFinal ? null
    : needsReview
      ? (live.dataset_hash !== ws.hash
        ? ` v${live.n} was ${awaiting ? 'submitted' : 'finalized'} on dataset ${shortHash(live.dataset_hash)}; dependencies changed since — v${live.n} is preserved.`
        : ` v${live.n} was ${awaiting ? 'submitted' : 'finalized'} as a ${(live.bundle as any)?.branch === 'swim' ? 'structured synthesis' : 'meta-analysis'}; the branch changed since — v${live.n} is preserved.`)
      : ` v${live.n} ${awaiting ? 'is awaiting approval for' : 'was finalized from'} run ${liveRun?.n ?? '?'}; run ${run?.n} is a different analysis of the same data — finalizing creates a replacement and v${live.n} is preserved.`;
  const withdrawsNote = awaiting && !awaitingCurrent && live ? ` Finalizing withdraws v${live.n}’s pending approval request.` : '';

  const note = !roles.finalizer ? { tone: 'red' as const, text: 'No finalizer is set on the protocol — nobody can finalize.' }
    : !ws.auditPass ? { tone: 'red' as const, text: 'Blocked by the audit above.' }
      : !isFinalizer ? { tone: 'amber' as const, text: `Only the finalizer role (${syn.nameOf(roles.finalizer)}) can finalize.` }
        : roles.second_approval === 'required' ? { tone: 'green' as const, text: `Audit passes. Finalizing will request second approval from ${syn.nameOf(roles.approver)}.` }
          : { tone: 'green' as const, text: 'Audit passes. Finalizing creates an immutable version.' };

  const pendingAnalyses = ws.statuses.filter(a => a.status === 'pending' && a.analysis_type !== 'Primary');

  const finalize = async () => {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      await syn.finalize(g.id, {
        run_id: run.id, current_hash: ws.hash, audit: ws.audit,
        bundle: {
          target: g.target, branch: g.branch, protocol_version: syn.protocol.version,
          run_n: run.n, config: run.config, outputs: run.outputs,
          narrative, analyses: ws.statuses.map(a => ({ id: a.id, type: a.analysis_type, planning: a.planning, status: a.status, text: a.text })),
          engine_version: ENGINE_VERSION,
        },
      });
    } catch (e: any) { setError(e?.message ?? 'Finalization was refused.'); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!live) return;
    setBusy(true); setError(null);
    try { await syn.approve(g.id, live.id); } catch (e: any) { setError(e?.message ?? 'Approval was refused.'); } finally { setBusy(false); }
  };
  const markNotRun = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await syn.addDecision(g.id, { kind: 'analysis_not_run', target_ref: analysisRef(id), value: { analysis_id: id }, reason: reason.trim() });
      setNotRunFor(null); setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not record.'); } finally { setBusy(false); }
  };

  const save = async (format: 'png' | 'jpg' | 'svg') => {
    if (!result || !run) return;
    setError(null);
    try {
      const { svg, width, height } = buildForestSvg(result, {
        outcomeLabel: runTarget.outcome,
        comparisonLabel,
        treatmentHeading: 'Intervention', comparatorHeading: 'Comparator', mid: ctx?.mid ?? null,
        leftFavours: leftFavoursOf(run),
        footer: `${g.title} · run ${run.n} · dataset ${shortHash(run.dataset_hash)} · EviStream`,
      });
      const name = `${slugify(g.title)}-run${run.n}`;
      if (format === 'svg') downloadSvg(svg, name);
      else await downloadSvgAsImage(svg, name, format, { width, height });
    } catch (e: any) { setError(e?.message ?? 'The figure could not be exported.'); }
  };

  if (!run) {
    return <EmptyPanel title="No run yet" action={<OutlineButton onClick={() => go({ tab: g.branch === 'swim' ? 'swim' : 'analysis' })}>Go to {g.branch === 'swim' ? 'Structured synthesis' : 'Analysis'}</OutlineButton>}>
      The narrative, methods and finalization are built from a run’s outputs.
    </EmptyPanel>;
  }

  // In force when the run was recorded, not now.
  const deviations = ctx?.deviations ?? [];
  const confirmedTransforms = ctx?.transformations ?? [];
  const liveMatches = !ws.diff.stale;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <SectionTitle right={<Chip tone="gray">deterministic · from run {run.n} outputs · claim-level refs</Chip>}>Results narrative</SectionTitle>
        <div className="flex flex-col gap-3">
          {narrative.map((s, i) => (
            <p key={i} className="text-[14.5px] leading-[26px] text-[#374151] dark:text-zinc-200">
              {s.text} <span className="font-mono text-[11.5px] text-gray-500">[{s.ref}]</span>
            </p>
          ))}
        </div>
        <div className="mt-3 font-mono text-[11.5px] text-gray-500">
          {narrative.length} sentences · every number read from run {run.n} outputs · refs used: {[...new Set(narrative.map(s => s.ref.split(' ')[0]))].join(', ')}
        </div>
        {ctx && (
          <div className="mt-1">
            <SnapshotNote recomputed={!!snap?.recomputed} drift={!!snap?.drift} engine={run.engine_version}
              targetLive={!ctx.targetFromSnapshot && !liveMatches} midLive={!ctx.midFromSnapshot && !liveMatches} />
          </div>
        )}
        {run.partial && <Banner tone="slate" className="mt-3">Run {run.n} is a partial draft — the narrative describes the ready studies only and cannot be finalized.</Banner>}
        {ws.diff.stale && <Banner tone="slate" className="mt-3">The dataset has changed since run {run.n} ({ws.diff.text}). Re-run before finalizing.</Banner>}

        <div className="mt-6 flex flex-col gap-4">
          <Collapsible title="Methods · from engine metadata" open={methodsOpen} onToggle={() => setMethodsOpen(o => !o)}>
            <div className="text-[12.5px] leading-[19px] text-[#374151] dark:text-zinc-300">
              {run.engine_version} · {swimRun ? 'structured synthesis, vote counting by direction' : presetLabel({ model: (run.config as any).model, tau2: (run.config as any).tau2, ci: (run.config as any).ci })}
              {!swimRun && ' · prediction interval per Higgins, Thompson & Spiegelhalter 2009 (reported from k = 5) · I² CI by Higgins & Thompson 2002'}
              {confirmedTransforms.length > 0 && <> · transformations: {confirmedTransforms.map(t => `${t.name} (${t.label})`).join('; ')}</>}
              {deviations.length > 0 && <> · deviations: {deviations.map(d => `${String(d.value?.what ?? d.target_ref)} — “${d.reason}”`).join('; ')}</>}
            </div>
            {result && <MethodsPanel result={result} outcomeLabel={runTarget.outcome} comparisonLabel={comparisonLabel} />}
          </Collapsible>

          {!swimRun && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[#ececea] pt-3 dark:border-[#1f1f1f]">
              <span className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Exports</span>
              <span className="text-[12px] text-gray-500">run {run.n}</span>
              <OutlineButton small onClick={() => runCsv(run, g.title)}>CSV</OutlineButton>
              <OutlineButton small onClick={() => save('png')}>PNG</OutlineButton>
              <OutlineButton small onClick={() => save('jpg')}>JPG</OutlineButton>
              <OutlineButton small onClick={() => save('svg')}>SVG</OutlineButton>
            </div>
          )}

          <div className="border-t border-[#ececea] pt-3 dark:border-[#1f1f1f]">
            <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Handoff to GRADE</div>
            <div className="mt-1 text-[12.5px] text-gray-600 dark:text-zinc-400">
              {live && live.status === 'finalized'
                ? <>GRADE consumes <Mono>v{live.n} · {shortHash(live.dataset_hash)}</Mono> (version id <Mono>{live.id}</Mono>).</>
                : 'Available once a version is finalized.'}
            </div>
          </div>
        </div>
      </div>

      <aside className="min-w-0">
        <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">Pre-finalization audit · live</div>
        <div className="flex flex-col gap-2.5">
          {ws.audit.map(a => {
            const mark = a.ok ? (a.warn ? '!' : '✓') : a.blocking ? '×' : '!';
            const color = a.ok ? (a.warn ? 'text-[#92400e]' : 'text-[#047857]') : a.blocking ? 'text-[#b91c1c]' : 'text-[#92400e]';
            return (
              <div key={a.id} className="flex gap-3 text-[13px] leading-[19px] text-[#374151] dark:text-zinc-300">
                <span className={`w-3 shrink-0 font-semibold ${color}`}>{mark}</span><span className="min-w-0">{a.text}</span>
              </div>
            );
          })}
        </div>

        {syn.canEdit && pendingAnalyses.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {pendingAnalyses.map(a => (
              <div key={a.id}>
                {notRunFor === a.id ? (
                  <div className="flex flex-col gap-2 rounded-[10px] bg-[#fafafa] p-3 dark:bg-[#141414]">
                    <div className="text-[12.5px] font-medium">{a.analysis_type} · {a.description || a.field} — not run</div>
                    <ReasonInput value={reason} onChange={setReason} autoFocus placeholder="Why it was not run (required)" />
                    <div className="flex gap-2">
                      <OutlineButton small disabled={busy || !reason.trim()} onClick={() => markNotRun(a.id)}>Record not run</OutlineButton>
                      <OutlineButton small onClick={() => setNotRunFor(null)}>Cancel</OutlineButton>
                    </div>
                  </div>
                ) : (
                  <OutlineButton small onClick={() => { setNotRunFor(a.id); setReason(''); }}>Mark {a.analysis_type.toLowerCase()} {a.description || a.field} not run · with reason</OutlineButton>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-[12px] bg-[#fafafa] px-4 py-4 dark:bg-[#141414]">
          {awaitingCurrent && live ? (
            <>
              <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Awaiting approval · v{live.n}</div>
              <div className="mt-1 text-[12.5px] text-gray-600 dark:text-zinc-400">Finalized by {live.finalized_by_name ?? syn.nameOf(live.finalized_by)} · awaiting second approval ({syn.nameOf(roles.approver)}).</div>
              {isApprover && (
                <PrimaryButton className="mt-3 w-full" disabled={busy} onClick={approve}>Approve as {syn.nameOf(roles.approver)}</PrimaryButton>
              )}
            </>
          ) : alreadyFinal && live ? (
            <>
              <div className="text-[14px] font-semibold text-[#047857] dark:text-emerald-400">Finalized v{live.n}</div>
              <div className="mt-1 text-[12.5px] text-gray-600 dark:text-zinc-400">
                By {live.finalized_by_name ?? syn.nameOf(live.finalized_by)}{live.approved_by ? ` · approved by ${live.approved_by_name ?? syn.nameOf(live.approved_by)}` : ''} · {day(live.at)} · dataset {shortHash(live.dataset_hash)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Finalize {versions.length ? `v${(versions[0]?.n ?? 0) + 1}` : 'v1'}</div>
              <div className="mt-1 text-[12.5px] leading-[18px] text-gray-600 dark:text-zinc-400">
                Freezes run {run.n} (dataset {shortHash(run.dataset_hash)}), its decisions and the audit as an immutable version.
                {replacesNote}{withdrawsNote}
              </div>
              <PrimaryButton className="mt-3 w-full" disabled={!canFinalize || busy} onClick={finalize}>
                {roles.second_approval === 'required' ? 'Finalize and request approval' : live ? 'Finalize replacement version' : 'Finalize version'}
              </PrimaryButton>
              <div className={`mt-2 text-[12.5px] ${note.tone === 'red' ? 'text-[#b91c1c]' : note.tone === 'amber' ? 'text-[#92400e]' : 'text-[#047857]'}`}>{note.text}</div>
            </>
          )}
          {error && <div className="mt-2 text-[12.5px] text-[#b91c1c]">{error}</div>}
        </div>
      </aside>
    </div>
  );
}
