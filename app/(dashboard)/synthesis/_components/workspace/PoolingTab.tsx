'use client';

/**
 * Pooling decision — pool (meta-analysis) or do not pool (structured
 * synthesis), recorded with a typed reason. Switching branch in either
 * direction needs a reason; the server logs it as a pooling decision.
 */

import { useState } from 'react';

import { useSynthesisNav } from '../../_lib/nav';
import { POOLING_REF, poolingDimensions, poolingOf } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { Banner, OutlineButton, PrimaryButton, ReasonInput, StateText, TableFrame, Th, day } from '../ui';

export function PoolingTab({ ws }: { ws: WorkspaceState }) {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const g = ws.group;
  const decisions = ws.bundle?.decisions ?? [];
  const dims = poolingDimensions(ws.model, g.target, syn.designByDocument);
  const { decision, choice } = poolingOf(decisions);
  const [mode, setMode] = useState<null | 'record' | 'switch'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const swim = g.branch === 'swim';
  const wanted = swim ? 'do_not_pool' : 'pool';
  const provisional = ws.model.blocking.some(b => b.kind === 'instrument' || b.kind === 'eligibility');
  const okCount = dims.filter(d => d.ok).length;

  const recordHere = async () => {
    setBusy(true); setError(null);
    try {
      await syn.addDecision(g.id, { kind: 'pooling', target_ref: POOLING_REF, value: { decision: wanted, per_dimension: dims, provisional }, reason: reason.trim() });
      setMode(null); setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not record the decision.'); } finally { setBusy(false); }
  };
  const switchBranch = async () => {
    setBusy(true); setError(null);
    try {
      await syn.patchGroup(g.id, { branch: swim ? 'ma' : 'swim', reason: reason.trim() });
      setMode(null); setReason('');
      go({ tab: swim ? 'analysis' : 'swim' });
    } catch (e: any) { setError(e?.message ?? 'Could not switch branch.'); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-[860px]">
      <div className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white">Is pooling appropriate?</div>
      <div className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
        Per dimension, over the included studies. {okCount} of {dims.length} dimensions compatible{provisional ? '; open decisions on Evidence may change this' : ''}.
      </div>

      <TableFrame className="mt-4">
        <div className="min-w-[520px]">
          {dims.map(d => (
            <div key={d.key} className="grid min-h-[44px] grid-cols-[28px_190px_1fr] items-center gap-3 border-t border-[#ececea] px-3 py-2 first:border-t-0 dark:border-[#1f1f1f]">
              <span className={d.ok ? 'text-[#047857]' : 'text-[#92400e]'}>{d.ok ? '✓' : '!'}</span>
              <span className="text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{d.key}</span>
              <span className="text-[12.5px] text-[#374151] dark:text-zinc-300">{d.finding}</span>
            </div>
          ))}
        </div>
      </TableFrame>

      <div className="mt-6 rounded-[12px] bg-[#fafafa] px-5 py-4 dark:bg-[#141414]">
        {choice ? (
          <>
            <div className={`text-[15px] font-semibold ${choice === 'pool' ? 'text-[#047857] dark:text-emerald-400' : 'text-[#92400e] dark:text-amber-300'}`}>
              Decision: {choice === 'pool' ? 'Pool — meta-analysis' : 'Do not pool — structured synthesis'}
            </div>
            {decision?.reason && <div className="mt-1 text-[13px] leading-[20px] text-[#374151] dark:text-zinc-300">{decision.reason}</div>}
            <div className="mt-1 text-[12px] text-gray-500">
              Recorded by {decision?.by_name ?? syn.nameOf(decision?.by)} · {day(decision?.at)}
              {decision?.value?.provisional ? ' · provisional until the open Evidence decisions are made' : ''}
            </div>
            {choice !== wanted && <div className="mt-2"><StateText tone="amber">The recorded decision does not match this synthesis’s branch — record it again.</StateText></div>}
          </>
        ) : (
          <div className="text-[13.5px] text-gray-600 dark:text-zinc-400">No pooling decision recorded yet. The audit blocks finalization until one is.</div>
        )}
      </div>
      {error && <Banner tone="red" className="mt-3">{error}</Banner>}

      {syn.canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          {choice === wanted ? (
            <PrimaryButton onClick={() => go({ tab: swim ? 'swim' : 'analysis' })}>Continue to {swim ? 'Structured synthesis' : 'Analysis'} →</PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => { setMode('record'); setReason(''); }}>{swim ? 'Record: do not pool' : 'Record: pool — meta-analysis'}</PrimaryButton>
          )}
          <OutlineButton onClick={() => { setMode('switch'); setReason(''); }}>
            {swim ? 'Revert to meta-analysis · with reason' : 'Do not pool · switch to structured synthesis'}
          </OutlineButton>
        </div>
      )}

      {mode && (
        <div className="mt-4 flex flex-col gap-2.5 rounded-[12px] border border-[#fde68a] bg-[#fffdf5] px-5 py-4 dark:border-amber-900/60 dark:bg-amber-500/[0.03]">
          <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">
            {mode === 'record' ? (swim ? 'Do not pool — structured synthesis' : 'Pool — meta-analysis')
              : swim ? 'Revert to meta-analysis' : 'Do not pool · switch to structured synthesis'}
          </div>
          <div className="text-[12.5px] text-gray-600 dark:text-zinc-400">
            {mode === 'switch' ? 'The branch change is logged with your reason; runs and decisions so far are kept.' : 'Say which dimensions you weighed and why they support this.'}
          </div>
          <ReasonInput value={reason} onChange={setReason} autoFocus />
          <div className="flex gap-2">
            <PrimaryButton disabled={busy || !reason.trim()} onClick={mode === 'record' ? recordHere : switchBranch}>
              {mode === 'record' ? 'Record decision' : 'Switch with this reason'}
            </PrimaryButton>
            <OutlineButton onClick={() => setMode(null)}>Cancel</OutlineButton>
          </div>
        </div>
      )}
    </div>
  );
}
