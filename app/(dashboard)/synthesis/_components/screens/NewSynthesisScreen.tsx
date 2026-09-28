'use client';

/**
 * Define a synthesis target. Facets come from what the source form actually
 * holds, so a reviewer picks "Pain VAS" from the extracted labels rather than
 * typing a string that matches nothing. Creates a Draft and opens Target,
 * where the target is confirmed — nothing is derived before that.
 */

import { useMemo, useState } from 'react';

import type { SynthesisBranch, SynthesisTarget } from '@/services/synthesis.service';
import { ALL_COMPARISONS } from '../../_lib/buildStudies';
import { useSynthesisNav } from '../../_lib/nav';
import { sourceFacets, sourceFormReady } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import { OutlineButton, PrimaryButton, ScreenHeader, Segmented, Select, StateText, TextInput } from '../ui';

function Row({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 border-t border-[#ececea] py-4 first:border-t-0 sm:grid-cols-[170px_1fr] sm:gap-4 dark:border-[#1f1f1f]">
      <div className="pt-2 text-[13px] font-medium text-[#374151] dark:text-zinc-300">{label}{required && <span className="text-[#b91c1c]">*</span>}</div>
      <div className="min-w-0">
        {children}
        {hint && <div className="mt-1 text-[12px] leading-[18px] text-gray-500 dark:text-zinc-500">{hint}</div>}
      </div>
    </div>
  );
}

export function NewSynthesisScreen() {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const sources = (syn.protocol.source_forms ?? []).filter(sourceFormReady);

  const [formId, setFormId] = useState(sources[0]?.form_id ?? '');
  const [outcome, setOutcome] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [comparison, setComparison] = useState('');
  const [population, setPopulation] = useState('');
  const [anyTime, setAnyTime] = useState(false);
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');
  const [timeRule, setTimeRule] = useState<'closest_to' | 'latest' | 'earliest'>('closest_to');
  const [timeTarget, setTimeTarget] = useState('');
  const [prefer, setPrefer] = useState('');
  const [mid, setMid] = useState('');
  const [midScale, setMidScale] = useState('');
  const [sign, setSign] = useState<'negative_favours_intervention' | 'positive_favours_intervention'>('negative_favours_intervention');
  const [branch, setBranch] = useState<SynthesisBranch>('ma');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sf = sources.find(s => s.form_id === formId) ?? null;
  const fd = syn.formData(formId);
  const facets = useMemo(() => sourceFacets(sf, fd?.rows ?? [], fd?.columns ?? []), [sf, fd]);

  const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
  const windowOk = anyTime || (num(lo) !== null && num(hi) !== null && Number(lo) <= Number(hi));
  const canCreate = !!sf && outcome.trim() !== '' && windowOk && !busy;

  const toggleLabel = (v: string) => setLabels(ls => (ls.includes(v) ? ls.filter(x => x !== v) : [...ls, v]));

  const create = async () => {
    if (!canCreate || !sf) return;
    setBusy(true); setError(null);
    const [iv, cp] = comparison && comparison !== ALL_COMPARISONS ? comparison.split(/\s+vs\.?\s+/i) : ['', ''];
    const outcomeLabels = labels.length ? labels : (facets?.outcomes.some(o => o.value === outcome.trim()) ? [outcome.trim()] : []);
    const w = anyTime ? { lo: null, hi: null } : { lo: num(lo), hi: num(hi) };
    const target: SynthesisTarget = {
      outcome: outcome.trim(),
      outcome_labels: outcomeLabels,
      definition: '',
      comparison: {
        intervention: (iv ?? '').trim(),
        comparator: (cp ?? '').trim(),
        orientation: 'intervention_minus_comparator',
        sign_convention: sign,
      },
      population: population.trim(),
      window: { ...w, unit: 'weeks', rule: anyTime ? 'any timepoint' : `${w.lo}–${w.hi} weeks inclusive` },
      selection_rule: {
        prefer_instrument: prefer.split(',').map(s => s.trim()).filter(Boolean),
        timepoint_rule: timeRule,
        timepoint_target_weeks: num(timeTarget) ?? (w.lo !== null && w.hi !== null ? (w.lo + w.hi) / 2 : null),
        population_rule: null,
        tie_break: 'needs_decision',
      },
      mid: { value: num(mid), scale: midScale.trim() || null, source: null },
      measure_preference: null,
      source_form_id: sf.form_id,
    };
    const title = [outcome.trim(), comparison && comparison !== ALL_COMPARISONS ? comparison : null,
      anyTime ? null : `${w.lo}–${w.hi} wk`].filter(Boolean).join(' · ');
    try {
      const g = await syn.createGroup({ title, branch, target });
      go({ screen: 'workspace', id: g.id, tab: 'target' });
    } catch (e: any) {
      setError(e?.message ?? 'Could not create the synthesis.');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[860px] pb-16">
      <ScreenHeader active="dashboard" />
      <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">New synthesis</h1>
      <div className="mt-1 mb-6 text-[13.5px] text-gray-500 dark:text-zinc-400">
        One target — outcome, comparison, population, time window. Created as a Draft; you confirm the target before any evidence is derived.
      </div>

      {sources.length === 0 ? (
        <div className="text-[13px] text-gray-500">No source form has a confirmed mapping yet — confirm one on the Protocol screen first.</div>
      ) : (
        <>
          <Row label="Source form" required>
            <Select<string> value={formId} onChange={v => { setFormId(v); setLabels([]); setComparison(''); }}
              options={sources.map(s => ({ value: s.form_id, label: syn.formById.get(s.form_id)?.form_name ?? s.form_id }))} className="w-full sm:w-auto" />
          </Row>
          <Row label="Outcome" required hint="The target's name. Tick the extracted labels that count as this outcome without a decision; related labels become Needs decision.">
            <TextInput value={outcome} onChange={setOutcome} placeholder="e.g. Pain intensity" />
            {facets && facets.outcomes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {facets.outcomes.slice(0, 30).map(o => {
                  const on = labels.includes(o.value);
                  return (
                    <button key={o.value} type="button" onClick={() => { toggleLabel(o.value); if (!outcome.trim()) setOutcome(o.value); }}
                      className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900' : 'border-[#e5e7eb] text-gray-700 hover:border-gray-300 dark:border-[#2a2a2a] dark:text-zinc-300'}`}>
                      {o.value} <span className="opacity-60">· {o.documents}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Row>
          <Row label="Comparison" hint="Orientation is intervention minus comparator.">
            <Select<string> value={comparison} onChange={setComparison} className="w-full sm:w-auto"
              options={[{ value: '', label: 'Any comparison in the form' }, ...(facets?.comparisons ?? [])
                .filter(c => c.value !== ALL_COMPARISONS).map(c => ({ value: c.value, label: `${c.value} · ${c.documents}` }))]} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-gray-500 dark:text-zinc-400">Sign convention</span>
              <Segmented value={sign} onChange={setSign}
                options={[{ value: 'negative_favours_intervention', label: 'Lower favours intervention' }, { value: 'positive_favours_intervention', label: 'Higher favours intervention' }]}
                className="[&>button]:min-w-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px]" />
            </div>
          </Row>
          <Row label="Population">
            <TextInput value={population} onChange={setPopulation} placeholder="e.g. Adults with chronic non-cancer pain" />
          </Row>
          <Row label="Time window" required hint="Inclusive, in weeks. A result whose timepoint is NR or unreadable is Needs decision, never matched automatically.">
            <div className="flex flex-wrap items-center gap-2">
              <TextInput value={lo} onChange={setLo} placeholder="from" className="w-[90px]" ariaLabel="Window from (weeks)" />
              <span className="text-gray-400">–</span>
              <TextInput value={hi} onChange={setHi} placeholder="to" className="w-[90px]" ariaLabel="Window to (weeks)" />
              <span className="text-[12.5px] text-gray-500">weeks</span>
              <label className="ml-2 flex items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
                <input type="checkbox" checked={anyTime} onChange={e => setAnyTime(e.target.checked)} /> Any timepoint
              </label>
            </div>
          </Row>
          <Row label="Result-selection rule" hint="Structured, never free text. A tie that remains is a decision for you.">
            <div className="flex flex-wrap items-center gap-2">
              <Select<'closest_to' | 'latest' | 'earliest'> value={timeRule} onChange={setTimeRule}
                options={[{ value: 'closest_to', label: 'Timepoint closest to' }, { value: 'latest', label: 'Latest timepoint' }, { value: 'earliest', label: 'Earliest timepoint' }]} />
              {timeRule === 'closest_to' && <TextInput value={timeTarget} onChange={setTimeTarget} placeholder="weeks (default: window centre)" className="w-[210px]" />}
            </div>
            <TextInput value={prefer} onChange={setPrefer} className="mt-2" placeholder="Preferred instruments, in order, comma-separated — e.g. VAS, NRS" />
          </Row>
          <Row label="MID for this target">
            <div className="flex flex-wrap gap-2">
              <TextInput value={mid} onChange={setMid} placeholder="e.g. 1" className="w-[110px]" ariaLabel="MID value" />
              <TextInput value={midScale} onChange={setMidScale} placeholder="scale, e.g. 0–10 VAS" className="w-[220px]" ariaLabel="MID scale" />
            </div>
          </Row>
          <Row label="Intended branch">
            <Segmented value={branch} onChange={setBranch}
              options={[{ value: 'ma', label: 'Meta-analysis' }, { value: 'swim', label: 'Structured synthesis' }]}
              className="[&>button]:min-w-[140px]" />
          </Row>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <PrimaryButton disabled={!canCreate} onClick={create}>Create synthesis</PrimaryButton>
            <OutlineButton onClick={() => go({ screen: 'dashboard' })}>Cancel</OutlineButton>
            {!canCreate && !busy && <span className="text-[12.5px] text-gray-500">Outcome and time window are required.</span>}
            {error && <StateText tone="red">{error}</StateText>}
          </div>
        </>
      )}
    </div>
  );
}
