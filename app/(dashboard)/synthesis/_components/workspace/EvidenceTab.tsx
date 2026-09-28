'use client';

/**
 * Evidence — the candidate results the engine derived against the confirmed
 * target, one row per study, with eligibility and data readiness kept apart.
 * Every decision the rules cannot make is asked here with a typed reason;
 * nothing is included or excluded without one.
 */

import { Fragment, useState } from 'react';

import type { DecisionIn } from '@/services/synthesis.service';
import { EXCLUSION_TEXT } from '../../_lib/buildStudies';
import { useSynthesisNav } from '../../_lib/nav';
import {
  formatWeeks, inForce, labelRef, studyRef,
  type CandidateResult, type StudyView,
} from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import {
  Banner, Collapsible, EmptyPanel, OutlineButton, PrimaryButton, ReasonInput, StateText, TableFrame, Th,
} from '../ui';

const NOT_ELIGIBLE_TEXT: Record<string, string> = {
  outcome_rejected: 'outcome judged a different construct',
  comparison_mismatch: 'a different comparison from the target',
  outside_window: 'timepoint outside the target window',
  human_exclude: 'excluded by a recorded decision',
};

const GRID = 'grid grid-cols-[140px_minmax(0,1fr)_130px_190px_150px] gap-3';

function eligText(s: StudyView) {
  if (s.eligibility === 'eligible') return <StateText tone="green">{s.deviation ? 'Eligible · deviation' : 'Eligible'}</StateText>;
  if (s.eligibility === 'needs_decision') return <StateText tone="indigo">Needs decision</StateText>;
  return <StateText tone="gray">Not eligible</StateText>;
}

function readinessText(s: StudyView) {
  switch (s.readiness) {
    case 'ready': return <StateText tone="green">Ready</StateText>;
    case 'needs_transformation': return <StateText tone="amber">Needs transformation</StateText>;
    case 'source_unreviewed': return <StateText tone="amber">{s.sourceReview === 'correction_requested' ? 'Correction requested' : 'Source unreviewed'}</StateText>;
    case 'missing_data': return <StateText tone="red">Missing required data</StateText>;
    case 'pending_mapping': return <StateText tone="gray">Pending mapping</StateText>;
    case 'excluded': return <StateText tone="gray">Rejected on review</StateText>;
    default: return <span className="text-[12.5px] text-gray-400">—</span>;
  }
}

export function EvidenceTab({ ws, openStudy }: { ws: WorkspaceState; openStudy: (documentId: string) => void }) {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const m = ws.model;
  const decisions = ws.bundle?.decisions ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pick, setPick] = useState<string>('');
  const [reversed, setReversed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [deviationFor, setDeviationFor] = useState<string | null>(null);

  if (!m.mappingReady) {
    return <EmptyPanel title="Pending mapping" action={<OutlineButton onClick={() => go({ screen: 'mapping', form: ws.sourceForm?.form_id ?? '' })}>Open mapping</OutlineButton>}>
      The source form’s column mapping is not confirmed, so no candidate results can be built yet.
    </EmptyPanel>;
  }
  if (!m.targetConfirmed) {
    return <EmptyPanel title="Derivation runs against the confirmed target" action={<OutlineButton onClick={() => go({ tab: 'target' })}>Go to Target</OutlineButton>}>
      Confirm the target first — the outcome labels, comparison and window decide which results are candidates.
    </EmptyPanel>;
  }

  const record = async (d: DecisionIn) => {
    setBusy(true); setError(null);
    try {
      await syn.addDecision(ws.group.id, d);
      setReason(''); setPick(''); setReversed(false); setOpen(null); setDeviationFor(null);
    } catch (e: any) { setError(e?.message ?? 'Could not record the decision.'); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError(null);
    try { await syn.revokeDecision(ws.group.id, id, reason.trim() || null); setReason(''); }
    catch (e: any) { setError(e?.message ?? 'Could not revoke.'); } finally { setBusy(false); }
  };

  const studies = m.studies;
  const eligible = studies.filter(s => s.eligibility === 'eligible').length;
  const pending = studies.filter(s => s.eligibility === 'needs_decision').length;
  const notEligible = studies.filter(s => s.eligibility === 'not_eligible').length;
  const ready = studies.filter(s => s.readiness === 'ready').length;
  const lastRefs = new Set(((ws.latestRun?.dataset ?? []) as Array<{ ref: string }>).map(r => r.ref));

  const outsideWindow = (s: StudyView): CandidateResult | null =>
    s.eligibility === 'not_eligible' ? s.candidates.find(c => c.reasonCode === 'outside_window') ?? null : null;

  const decisionPanel = (s: StudyView) => {
    const c = s.pendingCandidate;
    if (s.need === 'instrument' && c) {
      return (
        <div className="rounded-[12px] bg-[#f8f7ff] px-4 py-3.5 dark:bg-indigo-950/20">
          <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Does “{c.outcome}” measure {ws.group.target.outcome}?</div>
          <div className="mt-1 text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">
            The label is not one of the target’s outcome labels, so the selection rule cannot use it. The decision applies to every study reporting “{c.outcome}”.
            {m.transformations.some(t => t.documentId === s.documentId && t.kind === 'reverse_direction') && (
              <span className="mt-1 block text-[#92400e] dark:text-amber-300">Its scale runs the other way — the direction reversal stays blocked until this construct decision is made.</span>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px] text-[#374151] dark:text-zinc-300">
            <input type="checkbox" checked={reversed} onChange={e => setReversed(e.target.checked)} />
            Its scale runs the opposite way (higher = better) — propose a direction reversal
          </label>
          <div className="mt-2"><ReasonInput value={reason} onChange={setReason} placeholder="Reason (required) — e.g. what the source says the instrument measures" /></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <OutlineButton disabled={busy || !reason.trim()} onClick={() => record({ kind: 'instrument_match', target_ref: labelRef(c.outcome), value: { accepted: true, reversed, label: c.outcome, target: ws.group.target.outcome }, reason: reason.trim() })}>Accept as compatible</OutlineButton>
            <OutlineButton disabled={busy || !reason.trim()} onClick={() => record({ kind: 'instrument_match', target_ref: labelRef(c.outcome), value: { accepted: false, label: c.outcome, target: ws.group.target.outcome }, reason: reason.trim() })}>Exclude · different construct</OutlineButton>
          </div>
        </div>
      );
    }
    if (s.need === 'eligibility' && c) {
      return (
        <div className="rounded-[12px] bg-[#f8f7ff] px-4 py-3.5 dark:bg-indigo-950/20">
          <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">{c.reasonCode === 'timepoint_unknown' ? 'Timepoint unknown' : 'Orientation'} · {c.outcome}</div>
          <div className="mt-1 text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">{c.reason}.</div>
          <div className="mt-3"><ReasonInput value={reason} onChange={setReason} /></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <OutlineButton disabled={busy || !reason.trim()} onClick={() => record({ kind: 'eligibility', target_ref: c.ref, value: { include: true, why: c.reasonCode }, reason: reason.trim() })}>Include this result</OutlineButton>
            <OutlineButton disabled={busy || !reason.trim()} onClick={() => record({ kind: 'eligibility', target_ref: c.ref, value: { include: false, why: c.reasonCode }, reason: reason.trim() })}>Exclude this result</OutlineButton>
          </div>
        </div>
      );
    }
    if (s.need === 'tie') {
      const tied = s.candidates.filter(x => x.eligibility === 'eligible');
      return (
        <div className="rounded-[12px] bg-[#f8f7ff] px-4 py-3.5 dark:bg-indigo-950/20">
          <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Choose the result for {s.label}</div>
          <div className="mt-1 text-[12.5px] text-gray-600 dark:text-zinc-400">{s.eligibilityReason}. Choose by the protocol’s intent — never by the size or direction of the effect.</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {tied.map(x => (
              <label key={x.ref} className="flex items-center gap-2 text-[13px] text-[#374151] dark:text-zinc-300">
                <input type="radio" name={`pick-${s.documentId}`} checked={pick === x.ref} onChange={() => setPick(x.ref)} />
                {x.outcome} · {x.timepoint || 'timepoint NR'} · {x.comparison}
              </label>
            ))}
          </div>
          <div className="mt-3"><ReasonInput value={reason} onChange={setReason} /></div>
          <div className="mt-2">
            <OutlineButton disabled={busy || !reason.trim() || !pick} onClick={() => record({ kind: 'eligibility', target_ref: studyRef(s.documentId), value: { selected: pick }, reason: reason.trim() })}>Select this result</OutlineButton>
          </div>
        </div>
      );
    }
    return null;
  };

  const inForceFor = (s: StudyView) => {
    const out = [] as Array<{ id: string; text: string }>;
    const devs = s.candidates.filter(c => c.deviation);
    for (const c of devs) { const d = inForce(decisions, 'deviation', c.ref) ?? (c.legacyRef && c.legacyRef !== c.ref ? inForce(decisions, 'deviation', c.legacyRef) : null); if (d) out.push({ id: d.id, text: `Window deviation — “${d.reason ?? ''}”` }); }
    for (const c of s.candidates) {
      const d = inForce(decisions, 'eligibility', c.ref) ?? (c.legacyRef && c.legacyRef !== c.ref ? inForce(decisions, 'eligibility', c.legacyRef) : null); if (d) out.push({ id: d.id, text: `${d.value?.include ? 'Included' : 'Excluded'} ${c.outcome} — “${d.reason ?? ''}”` });
      const im = inForce(decisions, 'instrument_match', labelRef(c.outcome)); if (im && !out.some(o => o.id === im.id)) out.push({ id: im.id, text: `“${c.outcome}” ${im.value?.accepted ? 'accepted' : 'judged a different construct'} — “${im.reason ?? ''}”` });
    }
    const sel = inForce(decisions, 'eligibility', studyRef(s.documentId)); if (sel) out.push({ id: sel.id, text: `Result selected by decision — “${sel.reason ?? ''}”` });
    const sr = inForce(decisions, 'source_review', studyRef(s.documentId)); if (sr) out.push({ id: sr.id, text: `Source ${String(sr.value?.state ?? '').replace('_', ' ')}${sr.reason ? ` — “${sr.reason}”` : ''}` });
    return out;
  };

  // Ledger
  const excludedGroups = new Map<string, string[]>();
  const addEx = (why: string, label: string) => { if (!excludedGroups.has(why)) excludedGroups.set(why, []); excludedGroups.get(why)!.push(label); };
  for (const s of studies) {
    if (s.eligibility === 'not_eligible') addEx(NOT_ELIGIBLE_TEXT[s.candidates[0]?.reasonCode] ?? 'not eligible for this target', s.label);
    else if (s.readiness === 'missing_data') addEx(`missing required data — ${s.readinessReason}`, s.label);
    else if (s.readiness === 'excluded') addEx('source row rejected on review', s.label);
  }
  for (const e of m.structuralExclusions) addEx(EXCLUSION_TEXT[e.reason], e.label);

  return (
    <div className="flex flex-col gap-5">
      <Banner tone="indigo">
        Derived live from the current extractions of the source form against the confirmed target.
        {ws.latestRun && ws.diff.added.length > 0 && <> New since run {ws.latestRun.n}: {ws.diff.added.join(', ')}.</>}
      </Banner>
      {error && <Banner tone="red">{error}</Banner>}

      <div>
        <div className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white">
          {m.candidates.length} raw candidate result{m.candidates.length === 1 ? '' : 's'} · {studies.length} studies · {m.dataset.length} in current dataset
        </div>
        <div className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
          {eligible} eligible · {pending} need a decision · {notEligible} not eligible · {ready} ready
          {m.unrelatedRows > 0 && ` · ${m.unrelatedRows} rows about other outcomes not considered`}
        </div>
      </div>

      {studies.length === 0 ? (
        <EmptyPanel title="No candidate results">
          No row of the source form matches the target’s outcome labels or a related label. Check the outcome labels on Target.
        </EmptyPanel>
      ) : (
        <TableFrame>
          <div className="min-w-[800px]">
            <div className={`${GRID} bg-[#fafafa] px-3 py-2 dark:bg-[#141414]`}>
              <Th>Study</Th><Th>Selected result</Th><Th>Eligibility</Th><Th>Data readiness</Th><Th />
            </div>
            {studies.map(s => {
              const c = s.selected ?? s.pendingCandidate ?? s.candidates[0];
              const dev = outsideWindow(s);
              const isNew = !!ws.latestRun && !lastRefs.has(s.ref) && s.inDataset;
              const tint = s.eligibility === 'needs_decision' ? 'bg-[#f8f7ff] dark:bg-indigo-950/10'
                : (isNew || s.deviation) ? 'bg-[#fffdf5] dark:bg-amber-500/[0.03]' : '';
              const expanded = open === s.documentId;
              const action = s.eligibility === 'needs_decision' ? { label: expanded ? 'Close' : 'Decide', run: () => { setOpen(expanded ? null : s.documentId); setReason(''); setPick(''); } }
                : s.readiness === 'source_unreviewed' ? { label: 'Review source →', run: () => openStudy(s.documentId) }
                  : s.readiness === 'needs_transformation' ? { label: 'Harmonize →', run: () => go({ tab: 'harmonization' }) }
                    : dev && syn.canEdit ? { label: 'Deviation…', run: () => { setDeviationFor(deviationFor === s.documentId ? null : s.documentId); setReason(''); } }
                      : { label: expanded ? 'Hide' : 'Details', run: () => setOpen(expanded ? null : s.documentId) };
              return (
                <Fragment key={s.documentId}>
                  <div className={`${GRID} min-h-[52px] items-center border-t border-[#ececea] px-3 py-2 dark:border-[#1f1f1f] ${tint}`}>
                    <button type="button" onClick={() => openStudy(s.documentId)}
                      className="truncate text-left text-[13px] font-medium text-[#0a0a0a] hover:underline dark:text-zinc-100" title={s.label}>
                      {s.label}{s.derived ? ' †' : ''}
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-[#374151] dark:text-zinc-300">{c ? `${c.outcome}${c.timepoint ? ` · ${c.timepoint}` : ''}` : '—'}</div>
                      <div className="truncate text-[12.5px] text-gray-500 dark:text-zinc-500">
                        {s.selectedBy === 'engine_rule' ? s.eligibilityReason
                          : s.eligibility === 'eligible' ? `${c?.comparison ?? ''}${c?.weeks !== null && c?.weeks !== undefined ? ` · ${formatWeeks(c.weeks)}` : ''}`
                            : s.eligibilityReason}
                        {isNew && ' · new since last run'}
                      </div>
                    </div>
                    <div>{eligText(s)}</div>
                    <div className="min-w-0">
                      {readinessText(s)}
                      {s.readiness && s.readiness !== 'ready' && <div className="truncate text-[11.5px] text-gray-500" title={s.readinessReason}>{s.readinessReason}</div>}
                    </div>
                    <div className="text-right">
                      {syn.canEdit || action.label === 'Details' || action.label === 'Hide' || action.label === 'Review source →' ? (
                        <OutlineButton small onClick={action.run}>{action.label}</OutlineButton>
                      ) : null}
                    </div>
                  </div>
                  {deviationFor === s.documentId && dev && (
                    <div className="border-t border-[#fde68a] bg-[#fffdf5] px-4 py-3.5 dark:border-amber-900/60 dark:bg-amber-500/[0.03]">
                      <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Protocol deviation · include {s.label} ({dev.timepoint || formatWeeks(dev.weeks)}) outside the window</div>
                      <div className="mt-1 text-[12.5px] text-gray-600 dark:text-zinc-400">Logged as a deviation with your reason; the audit and the methods say so.</div>
                      <div className="mt-2"><ReasonInput value={reason} onChange={setReason} autoFocus /></div>
                      <div className="mt-2 flex gap-2">
                        <PrimaryButton disabled={busy || !reason.trim()} onClick={() => record({ kind: 'deviation', target_ref: dev.ref, value: { include: true, what: 'window', timepoint: dev.timepoint, weeks: dev.weeks }, reason: reason.trim() })}>Record deviation</PrimaryButton>
                        <OutlineButton onClick={() => setDeviationFor(null)}>Cancel</OutlineButton>
                      </div>
                    </div>
                  )}
                  {expanded && (
                    <div className="flex flex-col gap-3 border-t border-[#ececea] px-4 py-3.5 dark:border-[#1f1f1f]">
                      {syn.canEdit && decisionPanel(s)}
                      <div>
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Candidate results in this study</div>
                        {s.candidates.map(x => (
                          <div key={x.ref} className="flex flex-wrap items-baseline gap-x-3 py-0.5 text-[12.5px]">
                            <span className="text-[#374151] dark:text-zinc-300">{x.outcome} · {x.timepoint || 'NR'} · {x.comparison}</span>
                            <StateText tone={x.eligibility === 'eligible' ? 'green' : x.eligibility === 'needs_decision' ? 'indigo' : 'gray'}>{x.reason}</StateText>
                            {s.selected?.ref === x.ref && <span className="text-[11.5px] font-semibold text-[#0a0a0a] dark:text-white">selected</span>}
                          </div>
                        ))}
                      </div>
                      {inForceFor(s).length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Decisions in force</div>
                          {inForceFor(s).map(d => (
                            <div key={d.id} className="flex flex-wrap items-baseline gap-2 py-0.5 text-[12.5px] text-[#374151] dark:text-zinc-300">
                              {d.text}
                              {syn.canEdit && <button type="button" disabled={busy} onClick={() => revoke(d.id)} className="text-[12px] text-gray-500 underline hover:text-red-600">Revoke</button>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </TableFrame>
      )}

      <Collapsible title="Inclusion ledger" open={ledgerOpen} onToggle={() => setLedgerOpen(o => !o)}>
        <div className="flex flex-col gap-2 text-[13px] text-[#374151] dark:text-zinc-300">
          <div><span className="text-[20px] font-semibold text-[#0a0a0a] dark:text-white">{studies.length}</span> studies with a candidate result</div>
          <div className="text-[#047857] dark:text-emerald-400">✓ {m.dataset.length} in the current dataset</div>
          {pending > 0 && <div className="text-[#4338ca] dark:text-indigo-300">{pending} waiting for a decision</div>}
          {studies.filter(s => s.readiness === 'source_unreviewed').length > 0 && <div className="text-[#92400e] dark:text-amber-300">{studies.filter(s => s.readiness === 'source_unreviewed').length} waiting for source review</div>}
          {studies.filter(s => s.readiness === 'needs_transformation').length > 0 && <div className="text-[#92400e] dark:text-amber-300">{studies.filter(s => s.readiness === 'needs_transformation').length} waiting for a transformation</div>}
          {[...excludedGroups.entries()].map(([why, names]) => (
            <div key={why} className="border-t border-[#ececea] pt-2 dark:border-[#1f1f1f]">
              <span className="font-semibold text-[#b91c1c] dark:text-red-400">{names.length} excluded</span> — {why}
              <div className="mt-1 text-[12px] text-gray-500">{names.join(' · ')}</div>
            </div>
          ))}
          {m.unrelatedRows > 0 && <div className="border-t border-[#ececea] pt-2 text-[12.5px] text-gray-500 dark:border-[#1f1f1f]">{m.unrelatedRows} rows report other outcomes and are not candidates for this target.</div>}
        </div>
      </Collapsible>
      <Collapsible title="Rules" open={rulesOpen} onToggle={() => setRulesOpen(o => !o)}>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">
          <li>An outcome label counts directly when it is one of the target’s labels; a related free-text label needs your match decision.</li>
          <li>Comparison and orientation must match the target; a comparator-first contrast is asked, never flipped silently.</li>
          <li>A timepoint must fall inside the window. NR or unreadable timepoints are Needs decision — never matched automatically.</li>
          <li>Several eligible results in one study go through the structured selection rule; a remaining tie is your decision.</li>
          <li>AI-only rows enter the dataset only after their source row is reviewed. A rejected row is resolved and excluded.</li>
          <li>Outside the window only by a logged protocol deviation with a reason.</li>
        </ul>
      </Collapsible>
    </div>
  );
}
