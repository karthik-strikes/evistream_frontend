'use client';

import { useMemo, useState } from 'react';

import { EFFECT_LABEL, type EffectMeasure } from '@/lib/metaAnalysis';
import type { SynthesisTarget } from '@/services/synthesis.service';
import { effectOptions, SLOT_LABEL, type SlotKey } from '../../_lib/mapping';
import { presetLabel, sourceFacets, validateDefault } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import {
  Banner, Chip, DefList, Mono, OutlineButton, PrimaryButton, ReasonInput, SectionTitle, Select, StateText,
  TableFrame, TextInput, Th, day,
} from '../ui';

export function TargetTab({ ws, onNext }: { ws: WorkspaceState; onNext: () => void }) {
  const syn = useSynthesis();
  const g = ws.group;
  const t = g.target;
  const m = ws.model;
  const confirmed = !!g.target_confirmed_at;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SynthesisTarget>(t);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facets = useMemo(() => sourceFacets(ws.sourceForm, ws.formData?.rows ?? [], ws.formData?.columns ?? []), [ws.sourceForm, ws.formData]);
  const def = syn.protocol.defaults.find(d => d.kind === m.kind);

  const confirm = async () => {
    setBusy(true); setError(null);
    try { await syn.patchGroup(g.id, { confirm_target: true }); } catch (e: any) { setError(e?.message ?? 'Could not confirm the target.'); } finally { setBusy(false); }
  };
  /**
   * The window's rule text and the selection rule's target week are derived
   * from the bounds when the target is created; an edit must re-derive them,
   * or "0–1 weeks" keeps reading "any timepoint" and "closest to" keeps
   * aiming at no week at all (every candidate ties).
   */
  const normalized = (): SynthesisTarget | string => {
    const clean = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v);
    const lo = clean(draft.window.lo);
    const hi = clean(draft.window.hi);
    if ((lo === null) !== (hi === null)) return 'Give both window bounds, or leave both empty for any timepoint.';
    if (lo !== null && hi !== null && lo > hi) return 'The window starts after it ends.';
    const centre = (a: number | null, b: number | null) => (a !== null && b !== null ? (a + b) / 2 : null);
    const tw = draft.selection_rule.timepoint_target_weeks;
    const followsWindow = tw === null || tw === undefined || tw === centre(t.window.lo, t.window.hi);
    return {
      ...draft,
      window: { ...draft.window, lo, hi, rule: lo === null ? 'any timepoint' : `${lo}–${hi} weeks inclusive` },
      selection_rule: { ...draft.selection_rule, timepoint_target_weeks: followsWindow ? centre(lo, hi) : tw },
    };
  };
  const saveEdit = async () => {
    const next = normalized();
    if (typeof next === 'string') { setError(next); return; }
    setBusy(true); setError(null);
    try {
      await syn.patchGroup(g.id, { target: next, ...(confirmed ? { reason: reason.trim() } : {}) });
      setEditing(false); setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not save the target.'); } finally { setBusy(false); }
  };

  const windowText = t.window?.lo === null && t.window?.hi === null
    ? 'Any timepoint'
    : `${t.window.lo ?? '…'}–${t.window.hi ?? '…'} weeks`;
  const rule = t.selection_rule;
  const measureNote = validateDefault({ kind: m.kind, measure: m.measure, preset: m.protocolPreset });

  // Coverage among candidate results (SPEC §4), not across the whole form.
  const cands = m.candidates;
  const coverage = Object.entries(ws.sourceForm?.mapping ?? {}).map(([slot, col]) => {
    const docs = new Set(cands.map(c => c.documentId));
    const filled = new Set(cands.filter(c => {
      const v = String(c.pairing.treatmentRow[col] ?? '').trim();
      return v && !/^(nr|not reported)$/i.test(v);
    }).map(c => c.documentId));
    return { slot: slot as SlotKey, col, filled: filled.size, total: docs.size };
  });

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0">
        {!confirmed && (
          <div className="mb-6 rounded-[12px] border border-[#c7d2fe] bg-[#f8f7ff] px-4 py-3.5 dark:border-indigo-900 dark:bg-indigo-950/20">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="indigo">Needs your decision</Chip>
              <span className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Confirm the target to derive evidence</span>
            </div>
            <div className="mt-1 text-[12.5px] leading-[19px] text-gray-600 dark:text-zinc-400">
              Candidate results are derived against a confirmed target only. Review each field below; confirming is recorded in History.
            </div>
            {syn.canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <PrimaryButton disabled={busy} onClick={confirm}>Confirm all fields and derive evidence</PrimaryButton>
                <OutlineButton onClick={() => { setDraft(t); setEditing(true); }}>Edit fields</OutlineButton>
              </div>
            )}
          </div>
        )}
        {confirmed && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <StateText tone="green">✓ Confirmed by {syn.nameOf(g.target_confirmed_by)} · {day(g.target_confirmed_at)}</StateText>
            {syn.canEdit && !editing && <OutlineButton small onClick={() => { setDraft(t); setEditing(true); }}>Edit target</OutlineButton>}
          </div>
        )}
        {error && <Banner tone="red" className="mb-4">{error}</Banner>}

        {editing ? (
          <div className="mb-8 flex flex-col gap-4 rounded-[12px] bg-[#fafafa] p-4 dark:bg-[#141414]">
            <label className="flex flex-col gap-1 text-[12.5px] text-gray-600 dark:text-zinc-400">Outcome
              <TextInput value={draft.outcome} onChange={v => setDraft(d => ({ ...d, outcome: v }))} />
            </label>
            <div className="text-[12.5px] text-gray-600 dark:text-zinc-400">Outcome labels that count without a decision
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(facets?.outcomes ?? []).map(o => {
                  const on = draft.outcome_labels.includes(o.value);
                  return (
                    <button key={o.value} type="button"
                      onClick={() => setDraft(d => ({ ...d, outcome_labels: on ? d.outcome_labels.filter(x => x !== o.value) : [...d.outcome_labels, o.value] }))}
                      className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900' : 'border-[#e5e7eb] text-gray-700 dark:border-[#2a2a2a] dark:text-zinc-300'}`}>
                      {o.value}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-[12.5px] text-gray-600 dark:text-zinc-400">Definition
              <TextInput value={draft.definition} onChange={v => setDraft(d => ({ ...d, definition: v }))} placeholder="What counts as this outcome" />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-gray-600 dark:text-zinc-400">Population
              <TextInput value={draft.population} onChange={v => setDraft(d => ({ ...d, population: v }))} />
            </label>
            <div className="flex flex-wrap items-end gap-2 text-[12.5px] text-gray-600 dark:text-zinc-400">
              <label className="flex flex-col gap-1">Window from (wk)
                <TextInput className="w-[100px]" value={draft.window.lo === null ? '' : String(draft.window.lo)}
                  onChange={v => setDraft(d => ({ ...d, window: { ...d.window, lo: v.trim() === '' ? null : Number(v) } }))} />
              </label>
              <label className="flex flex-col gap-1">to (wk)
                <TextInput className="w-[100px]" value={draft.window.hi === null ? '' : String(draft.window.hi)}
                  onChange={v => setDraft(d => ({ ...d, window: { ...d.window, hi: v.trim() === '' ? null : Number(v) } }))} />
              </label>
              <label className="flex flex-col gap-1">MID
                <TextInput className="w-[100px]" value={draft.mid.value === null ? '' : String(draft.mid.value)}
                  onChange={v => setDraft(d => ({ ...d, mid: { ...d.mid, value: v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v) } }))} />
              </label>
              <label className="flex flex-col gap-1">Effect measure
                <Select<string> value={draft.measure_preference ?? ''} onChange={v => setDraft(d => ({ ...d, measure_preference: v || null }))}
                  options={[{ value: '', label: `Protocol default (${def?.measure ?? effectOptions(m.kind)[0]})` }, ...effectOptions(m.kind).map(x => ({ value: x, label: `${x} · ${EFFECT_LABEL[x]}` }))]} />
              </label>
            </div>
            {confirmed && (
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-gray-700 dark:text-zinc-300">Reason — the target is confirmed, so this change is recorded</div>
                <ReasonInput value={reason} onChange={setReason} />
              </div>
            )}
            <div className="flex gap-2">
              <PrimaryButton disabled={busy || (confirmed && !reason.trim()) || !draft.outcome.trim()} onClick={saveEdit}>Save target</PrimaryButton>
              <OutlineButton onClick={() => setEditing(false)}>Cancel</OutlineButton>
            </div>
          </div>
        ) : (
          <DefList rows={[
            { label: 'Outcome', value: <><span className="font-medium text-[#0a0a0a] dark:text-white">{t.outcome}</span>
              {t.outcome_labels.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.outcome_labels.map(l => <Chip key={l}>{l}</Chip>)}</div>}</> },
            { label: 'Definition', value: t.definition || <span className="text-gray-400">Not written</span> },
            { label: 'Comparison', value: <>{t.comparison.intervention || t.comparison.comparator ? `${t.comparison.intervention || 'Any'} vs ${t.comparison.comparator || 'any'}` : 'Any comparison in the form'}
              <div className="text-[12px] text-gray-500">Intervention minus comparator · {t.comparison.sign_convention === 'negative_favours_intervention' ? 'lower favours intervention' : 'higher favours intervention'}</div></> },
            { label: 'Population', value: t.population || <span className="text-gray-400">No restriction</span> },
            { label: 'Time window', value: <>{windowText}<div className="text-[12px] text-gray-500">{t.window?.lo === null && t.window?.hi === null ? 'any timepoint' : 'bounds inclusive'} · NR timepoints are Needs decision</div></> },
            { label: 'Result selection', value: <>
              {rule.prefer_instrument.length ? `Prefer ${rule.prefer_instrument.join(' > ')}; then ` : ''}
              {rule.timepoint_rule === 'closest_to' ? `timepoint closest to ${rule.timepoint_target_weeks ?? '—'} wk` : rule.timepoint_rule === 'latest' ? 'latest timepoint' : 'earliest timepoint'}; remaining tie → your decision
              <div className="mt-1"><Chip tone="green">Applied from protocol by engine</Chip></div></> },
            { label: 'MID (this target)', value: t.mid.value !== null ? `${t.mid.value}${t.mid.scale ? ` · ${t.mid.scale}` : ''}` : <span className="text-gray-400">Not set</span> },
            { label: 'Effect measure', value: <>{m.measure} · {EFFECT_LABEL[m.measure as EffectMeasure]}
              <div className="text-[12px] text-gray-500">{t.measure_preference ? 'Chosen for this target' : 'Protocol default'} · {measureNote.ok ? 'validated against the data type' : measureNote.note}</div></> },
          ]} />
        )}

        <div className="mt-10">
          <SectionTitle>Source data · inherited</SectionTitle>
          <TableFrame>
            <div className="min-w-[440px]">
              <div className="grid grid-cols-[180px_1fr_160px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Role</Th><Th>Column</Th><Th>Coverage among candidates</Th>
              </div>
              {coverage.map(c => (
                <div key={c.slot} className="grid min-h-[40px] grid-cols-[180px_1fr_160px] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f]">
                  <span className="text-[13px] text-[#374151] dark:text-zinc-300">{SLOT_LABEL[c.slot] ?? c.slot}</span>
                  <Mono className="truncate">{c.col}</Mono>
                  <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">{confirmed ? `${c.filled} of ${c.total} studies` : '—'}</span>
                </div>
              ))}
            </div>
          </TableFrame>
          <div className="mt-6"><PrimaryButton onClick={onNext}>Evidence →</PrimaryButton></div>
        </div>
      </div>

      <aside className="min-w-0">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">Inherited from protocol</div>
        <div className="flex flex-col gap-3 text-[12.5px] leading-[18px] text-[#374151] dark:text-zinc-300">
          <div><div className="text-gray-500">Source form</div>{ws.sourceForm ? syn.formById.get(ws.sourceForm.form_id)?.form_name : '—'}</div>
          <div><div className="text-gray-500">Method preset</div>{presetLabel(m.protocolPreset)}</div>
          <div><div className="text-gray-500">Planned analyses</div>{syn.protocol.planned_analyses.length} ({syn.protocol.planned_analyses.map(a => a.analysis_type).join(', ') || 'none'})</div>
          <div><div className="text-gray-500">Finalizer</div>{syn.nameOf(syn.protocol.roles.finalizer)}{syn.protocol.roles.second_approval === 'required' ? ` · approver ${syn.nameOf(syn.protocol.roles.approver)}` : ''}</div>
          <div><div className="text-gray-500">Protocol version</div>v{g.protocol_version}{g.protocol_version !== syn.protocol.version ? ` (current v${syn.protocol.version})` : ''}</div>
        </div>
      </aside>
    </div>
  );
}
