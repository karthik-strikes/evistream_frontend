'use client';

/**
 * Structured synthesis (SWiM) — the branch taken when pooling is judged
 * inappropriate. Vote counting by direction of the POINT ESTIMATE, per group,
 * with a Wilson interval and an exact sign test; studies without usable data
 * are listed and left out of every denominator. No cross-class overall test.
 */

import { useEffect, useMemo, useState } from 'react';

import { EFFECT_LABEL, formatEffect } from '@/lib/metaAnalysis';
import type { VoteCount } from '@/lib/voteCounting';
import type { SynthesisRun } from '@/services/synthesis.service';
import { shortHash } from '../../_lib/datasetHash';
import { useSynthesisNav } from '../../_lib/nav';
import { DIRECTION_TEXT, buildSwim, voteText, type SwimRow } from '../../_lib/swim';
import { ENGINE_VERSION, SWIM_GROUPING_REF, inForce, poolingOf, runBranchOf, type DatasetRow } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import {
  Banner, DefList, EmptyPanel, OutlineButton, PrimaryButton, ReasonInput, SectionTitle, Segmented, Select, StateText,
  TableFrame, Th, when,
} from '../ui';

const OUTCOME = '__outcome';
const ROB_RANK: Record<string, number> = { low: 0, some: 1, high: 2 };
const ROB_TEXT: Record<string, [string, string]> = { low: ['Low', 'text-[#047857]'], some: ['Some concerns', 'text-[#92400e]'], high: ['High', 'text-[#b91c1c]'] };

interface ShownSwim { groups: Array<{ name: string; rows: SwimRow[]; count: VoteCount }>; overall: VoteCount }

/** A recorded SWiM run exactly as stored: its groups, counts, grouping and success direction. */
function storedSwim(run: SynthesisRun): ShownSwim & { grouping: string; success: 'benefit' | 'harm' } {
  const o = (run.outputs ?? {}) as { swim?: Array<{ name: string; count: VoteCount; rows: Array<Omit<SwimRow, 'documentId' | 'group' | 'effectText'>> }>; overall?: VoteCount };
  const cfg = (run.config ?? {}) as { grouping?: string; success?: 'benefit' | 'harm' };
  const docOf = new Map(((run.dataset ?? []) as DatasetRow[]).map(r => [r.ref, r.document_id]));
  const groups = (o.swim ?? []).map(gr => ({
    name: gr.name, count: gr.count,
    rows: gr.rows.map(r => ({
      ...r, group: gr.name, documentId: docOf.get(r.ref) ?? '',
      effectText: r.est != null && r.lo != null && r.hi != null ? formatEffect(r.est, r.lo, r.hi) : '—',
    })),
  }));
  const empty: VoteCount = groups[0]?.count ? { ...groups[0].count } : ({} as VoteCount);
  return { groups, overall: o.overall ?? empty, grouping: cfg.grouping ?? OUTCOME, success: cfg.success ?? 'benefit' };
}

export function SwimTab({ ws, openStudy }: { ws: WorkspaceState; openStudy: (d: string) => void }) {
  const syn = useSynthesis();
  const { get, go } = useSynthesisNav();
  const m = ws.model;
  const g = ws.group;
  const decisions = ws.bundle?.decisions ?? [];
  const pooling = poolingOf(decisions);
  const groupingDecision = inForce(decisions, 'pooling', SWIM_GROUPING_REF);
  const stored = (groupingDecision?.value ?? {}) as { grouping?: string; success?: 'benefit' | 'harm' };
  const [grouping, setGrouping] = useState<string>(stored.grouping ?? OUTCOME);
  const [success, setSuccess] = useState<'benefit' | 'harm'>(stored.success ?? 'benefit');
  // A newly recorded (or late-loading) grouping decision resets the controls.
  useEffect(() => { setGrouping(stored.grouping ?? OUTCOME); setSuccess(stored.success ?? 'benefit'); }, [stored.grouping, stored.success]);

  // `?run=N` (from History) shows that recorded run as stored, not the live tally.
  const runParam = get('run');
  const viewRun = useMemo(() => {
    const n = Number(runParam);
    return runParam && Number.isFinite(n) ? ws.runs.find(r => r.n === n && runBranchOf(r) === 'swim') ?? null : null;
  }, [runParam, ws.runs]);
  const recorded = useMemo(() => (viewRun ? storedSwim(viewRun) : null), [viewRun]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = (stored.grouping ?? OUTCOME) !== grouping || (stored.success ?? 'benefit') !== success;
  const studyById = useMemo(() => new Map(m.studies.map(s => [s.documentId, s])), [m.studies]);
  const groupOf = (documentId: string) => {
    const s = studyById.get(documentId);
    if (grouping === OUTCOME) return s?.selected?.outcome ?? s?.pendingCandidate?.outcome ?? '';
    return s?.attrs[grouping] ?? '';
  };

  const swim = useMemo(() => buildSwim({
    studies: m.datasetStudies,
    noData: m.studies.filter(s => s.eligibility === 'eligible' && s.readiness === 'missing_data')
      .map(s => ({ ref: s.ref, documentId: s.documentId, label: s.label, group: groupOf(s.documentId) })),
    measure: m.measure, lowerIsBenefit: m.lowerIsBenefit, groupOf: st => groupOf(st.documentId), success,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [m, grouping, success]);

  const nOf = (d: string) => studyById.get(d)?.nRandomised ?? 0;
  const robOf = (d: string) => syn.rob.byDoc.get(d)?.overall ?? null;
  const ordered = (rows: typeof swim.groups[number]['rows']) => [...rows].sort((a, b) =>
    (ROB_RANK[robOf(a.documentId) ?? ''] ?? 3) - (ROB_RANK[robOf(b.documentId) ?? ''] ?? 3) || nOf(b.documentId) - nOf(a.documentId));

  if (!m.targetConfirmed) {
    return <EmptyPanel title="Confirm the target first" action={<OutlineButton onClick={() => go({ tab: 'target' })}>Go to Target</OutlineButton>} />;
  }

  const saveGrouping = async () => {
    setBusy(true); setError(null);
    try {
      await syn.addDecision(g.id, { kind: 'pooling', target_ref: SWIM_GROUPING_REF, value: { grouping, success }, reason: reason.trim() });
      setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not record the grouping.'); } finally { setBusy(false); }
  };
  const recordRun = async () => {
    setBusy(true); setError(null);
    try {
      const omitted = m.studies
        .filter(s => !s.inDataset && (s.eligibility === 'needs_decision' || (s.eligibility === 'eligible' && s.readiness !== 'excluded')))
        .map(s => ({ ref: s.ref, label: s.label, why: s.eligibility === 'needs_decision' ? s.eligibilityReason : s.readinessReason }));
      await syn.createRun(g.id, {
        dataset: ws.dataset, dataset_hash: ws.hash,
        config: { ...(ws.config as unknown as Record<string, unknown>), branch: 'swim', grouping, success },
        outputs: { swim: swim.groups.map(gr => ({ name: gr.name, count: gr.count, rows: gr.rows.map(r => ({ ref: r.ref, label: r.label, direction: r.direction, est: r.est, lo: r.lo, hi: r.hi })) })), overall: swim.overall },
        partial: m.blocking.length > 0, omitted, engine_version: ENGINE_VERSION,
      });
    } catch (e: any) { setError(e?.message ?? 'Could not record the run.'); } finally { setBusy(false); }
  };

  const shown: ShownSwim = recorded ?? swim;
  const shownSuccess = recorded ? recorded.success : success;
  const shownGrouping = recorded ? recorded.grouping : grouping;
  const shownHash = viewRun ? viewRun.dataset_hash : ws.hash;
  const multi = shown.groups.length > 1;
  const who = shownSuccess === 'benefit' ? 'favoured the intervention' : 'favoured the comparator';
  const rowsOf = (rows: SwimRow[]) => (recorded ? rows : ordered(rows));

  return (
    <div className="flex flex-col gap-8">
      {viewRun && recorded && (
        <Banner tone="slate">
          Showing run {viewRun.n} as recorded · {when(viewRun.at)} · dataset {shortHash(viewRun.dataset_hash)} · grouped by {shownGrouping === OUTCOME ? 'outcome label as extracted' : shownGrouping}, counting {shownSuccess === 'benefit' ? 'favours intervention' : 'favours comparator'}{viewRun.partial ? ' · partial' : ''}. Risk of bias and source are current.{' '}
          <button type="button" onClick={() => go({ run: null })} className="underline">Show live</button>
        </Banner>
      )}
      <DefList rows={[
        { label: 'Reason not pooled', value: pooling.choice === 'do_not_pool' ? (pooling.decision?.reason || '—') : <StateText tone="amber">No do-not-pool decision recorded — see Pooling decision</StateText> },
        { label: 'Grouping', value: recorded ? (
          <div className="text-[13px]">{shownGrouping === OUTCOME ? 'Outcome label as extracted' : shownGrouping} · {shownSuccess === 'benefit' ? 'Count: favours intervention' : 'Count: favours comparator'} <span className="text-gray-500">(run {viewRun?.n})</span></div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select<string> value={grouping} onChange={setGrouping} disabled={!syn.canEdit}
                options={[{ value: OUTCOME, label: 'Outcome label as extracted' }, ...ws.subgroupColumns.map(c => ({ value: c, label: c }))]} />
              <Segmented value={success} onChange={setSuccess} disabled={!syn.canEdit}
                options={[{ value: 'benefit', label: 'Count: favours intervention' }, { value: 'harm', label: 'Count: favours comparator' }]}
                className="[&>button]:min-w-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px]" />
            </div>
            {groupingDecision && !changed && <div className="text-[12px] text-gray-500">Recorded by {groupingDecision.by_name ?? syn.nameOf(groupingDecision.by)} — “{groupingDecision.reason}”</div>}
            {changed && syn.canEdit && (
              <div className="flex flex-col gap-2">
                <ReasonInput value={reason} onChange={setReason} placeholder="Reason (required) — why this grouping" />
                <div><OutlineButton small disabled={busy || !reason.trim()} onClick={saveGrouping}>Record grouping</OutlineButton></div>
              </div>
            )}
          </div>
        ) },
        { label: 'Standardized metric', value: `Direction of effect by point estimate, with ${EFFECT_LABEL[m.measure]} (95% CI) per study where derivable` },
        { label: 'Synthesis method', value: 'Vote counting by direction of effect · exact two-sided sign test · Wilson 95% CI for the proportion' },
        { label: 'Basis for ordering', value: 'Study-level risk of bias (Low first), then sample size. No quantitative weights.' },
        { label: 'Limitations', value: 'Direction counts ignore effect size and precision; the sign test treats studies as exchangeable; studies without usable data are excluded from denominators.' },
      ]} />
      {error && <Banner tone="red">{error}</Banner>}

      <div className="flex flex-col gap-4">
        {shown.groups.length === 0 && <EmptyPanel title="No studies in the dataset yet">Resolve the items on Evidence first.</EmptyPanel>}
        {shown.groups.map(gr => (
          <div key={gr.name} className="rounded-[12px] border border-[#ececea] dark:border-[#1f1f1f]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#ececea] px-4 py-3 dark:border-[#1f1f1f]">
              <span className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">{gr.name}</span>
              <span className="text-[12.5px] text-gray-500">k = {gr.rows.length}</span>
              <span className="text-[12.5px] text-[#374151] dark:text-zinc-300">{voteText(gr.count, shownSuccess)}</span>
            </div>
            <TableFrame className="rounded-none border-0">
              <div className="min-w-[620px]">
                <div className="grid grid-cols-[1fr_220px_170px_120px_100px] gap-3 bg-[#fafafa] px-4 py-2 dark:bg-[#141414]">
                  <Th>Study</Th><Th>Direction</Th><Th>{m.measure} (95% CI)</Th><Th>RoB (study)</Th><Th>Source</Th>
                </div>
                {rowsOf(gr.rows).map(r => {
                  const st = studyById.get(r.documentId);
                  const rob = robOf(r.documentId);
                  return (
                    <div key={r.ref} className="grid h-10 grid-cols-[1fr_220px_170px_120px_100px] items-center gap-3 border-t border-[#ececea] px-4 dark:border-[#1f1f1f]">
                      <button type="button" disabled={!r.documentId} onClick={() => openStudy(r.documentId)} className="truncate text-left text-[13px] hover:underline">{r.label}</button>
                      <span className={`text-[12.5px] ${r.direction === 'benefit' ? 'text-[#047857]' : r.direction === 'harm' ? 'text-[#b91c1c]' : 'text-[#9ca3af]'}`}>{DIRECTION_TEXT[r.direction]}</span>
                      <span className="font-mono text-[12px]">{r.effectText}</span>
                      <span className={`text-[12.5px] ${rob ? ROB_TEXT[rob][1] : 'text-[#9ca3af]'}`}>{rob ? ROB_TEXT[rob][0] : 'Not assessed'}</span>
                      <span className="text-[12px] text-gray-500">{!st ? '—' : st.trust === 'ai' ? 'AI · reviewed' : st.trust === 'manual' ? 'Manual' : 'Consensus'}</span>
                    </div>
                  );
                })}
              </div>
            </TableFrame>
          </div>
        ))}
      </div>

      {shown.groups.length > 0 && (
        <div className="rounded-[12px] bg-[#fafafa] px-5 py-4 dark:bg-[#141414]">
          <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Overall · descriptive</div>
          <div className="mt-1 text-[13px] leading-[20px] text-[#374151] dark:text-zinc-300">
            {multi
              ? `No cross-group overall test: the groups were not judged one construct. Descriptive tally: ${shown.overall.success} of ${shown.overall.withDirection} studies with a direction ${who}.`
              : voteText(shown.overall, shownSuccess)}
          </div>
        </div>
      )}

      <section>
        <SectionTitle>Draft narrative · deterministic</SectionTitle>
        <div className="flex flex-col gap-2">
          {shown.groups.map(gr => (
            <p key={gr.name} className="text-[14px] leading-[24px] text-[#374151] dark:text-zinc-200">
              {gr.name}: {gr.count.success} of {gr.count.withDirection} studies with a direction {who}
              {gr.count.wilson ? ` (Wilson 95% CI ${(gr.count.wilson[0] * 100).toFixed(0)}–${(gr.count.wilson[1] * 100).toFixed(0)}%` : ' ('}
              {gr.count.p !== null ? `; sign test p = ${gr.count.p < 0.001 ? '< 0.001' : gr.count.p.toFixed(2)})` : ')'}
              {gr.count.nodata ? `; ${gr.count.nodata} without usable data` : ''}.{' '}
              <span className="font-mono text-[11.5px] text-gray-500">[group · {gr.rows.length} results · dataset {shortHash(shownHash)}{viewRun ? ` · run ${viewRun.n}` : ''}]</span>
            </p>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-[#ececea] pt-5 dark:border-[#1f1f1f]">
        {syn.canEdit && !recorded && (
          <PrimaryButton disabled={busy || m.dataset.length === 0} onClick={recordRun}>
            {m.blocking.length ? `Record draft with ${m.dataset.length} of ${m.potential}` : `Record structured synthesis · ${m.dataset.length} studies`}
          </PrimaryButton>
        )}
        {ws.latestRun && (
          <span className="text-[12.5px] text-gray-500">
            Run {ws.latestRun.n} · {when(ws.latestRun.at)} · dataset {shortHash(ws.latestRun.dataset_hash)}{ws.latestRun.partial ? ' · partial' : ''}
            {ws.diff.stale && <span className="text-[#92400e]"> · stale: {ws.diff.text}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
