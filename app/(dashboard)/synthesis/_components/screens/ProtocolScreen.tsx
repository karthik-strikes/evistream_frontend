'use client';

/**
 * The synthesis protocol — five sections, each a 200px label column and its
 * content. Before confirmation edits save as a draft; after it, every change
 * is an amendment and needs a typed reason (the server refuses otherwise).
 * Only managers edit; everyone else reads.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { EFFECT_LABEL, type EffectMeasure } from '@/lib/metaAnalysis';
import type {
  PlannedAnalysis, SynthesisDefault, SynthesisKind, SynthesisPreset, SynthesisRoles,
} from '@/services/synthesis.service';
import { effectOptions, SLOT_LABEL, type SlotKey } from '../../_lib/mapping';
import { useSynthesisNav } from '../../_lib/nav';
import { SENSITIVITY_RULES, defaultFor, sourceFormReady, validateDefault } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import {
  Banner, Hairline, Mono, OutlineButton, PrimaryButton, ReasonInput, ScreenHeader, Segmented, Select,
  StateText, TableFrame, TextInput, Th, day,
} from '../ui';

const KIND_LABEL: Record<SynthesisKind, string> = {
  dichotomous: 'Dichotomous',
  continuous: 'Continuous',
  effect: 'Reported effect',
  proportion: 'Proportion',
  correlation: 'Correlation',
};

const ALL_KINDS: SynthesisKind[] = ['continuous', 'dichotomous', 'effect', 'proportion', 'correlation'];

function Section({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-3 py-10 md:grid-cols-[200px_1fr] md:gap-8">
      <div>
        <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">{label}</div>
        {sub && <div className="mt-1 text-[12px] leading-[18px] text-gray-500 dark:text-zinc-400">{sub}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

let idSeq = 0;
const newId = () => `pa_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

export function ProtocolScreen() {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const p = syn.protocol;
  const confirmed = !!p.confirmed_at;
  const editable = syn.canManage;

  const [defaults, setDefaults] = useState<SynthesisDefault[]>(p.defaults ?? []);
  const [planned, setPlanned] = useState<PlannedAnalysis[]>(p.planned_analyses ?? []);
  const [roles, setRoles] = useState<SynthesisRoles>(p.roles ?? { finalizer: null, approver: null, second_approval: 'optional' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Re-seed when the stored protocol changes (another tab, a save).
  useEffect(() => {
    setDefaults(p.defaults ?? []);
    setPlanned(p.planned_analyses ?? []);
    setRoles(p.roles ?? { finalizer: null, approver: null, second_approval: 'optional' });
  }, [p.version, p.confirmed_at, p.defaults, p.planned_analyses, p.roles]);

  const sources = useMemo(() => p.source_forms ?? [], [p.source_forms]);
  const kinds = useMemo(() => {
    const k = new Set<SynthesisKind>(sources.map(s => s.kind));
    for (const d of defaults) k.add(d.kind);
    return ALL_KINDS.filter(x => k.has(x));
  }, [sources, defaults]);

  const defaultRows = kinds.map(k => defaults.find(d => d.kind === k) ?? defaultFor([], k));
  const setDefault = (next: SynthesisDefault) => {
    setDefaults(ds => [...ds.filter(d => d.kind !== next.kind), next]);
  };

  const sourcesSet = sources.length > 0 && sources.every(sourceFormReady);
  // What is on screen is what gets saved: a kind whose default the reviewer
  // left as shown is set to that default, not "still to set" with no way to
  // accept it short of changing a dropdown and changing it back.
  const defaultsSet = kinds.length > 0 && defaultRows.every(d => validateDefault(d).ok);
  const plannedSet = planned.length > 0 && planned.every(a => a.description.trim() || a.field);
  const rolesSet = !!roles.finalizer
    && (roles.second_approval !== 'required' || (!!roles.approver && roles.approver !== roles.finalizer));
  const allSet = sourcesSet && defaultsSet && plannedSet && rolesSet;

  const dirty = JSON.stringify(defaultRows) !== JSON.stringify(p.defaults ?? [])
    || JSON.stringify(planned) !== JSON.stringify(p.planned_analyses ?? [])
    || JSON.stringify(roles) !== JSON.stringify(p.roles ?? {});

  const save = async (confirm: boolean) => {
    setBusy(true); setError(null); setSaved(null);
    try {
      await syn.updateProtocol({
        defaults: defaultRows, planned_analyses: planned, roles,
        ...(confirm ? { confirm: true } : {}),
        ...(confirmed ? { reason: reason.trim() } : {}),
      });
      setReason('');
      setSaved(confirm ? 'Protocol confirmed.' : confirmed ? 'Amendment recorded.' : 'Saved.');
      if (confirm) go({ screen: 'dashboard' });
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the protocol.');
    } finally {
      setBusy(false);
    }
  };

  const removeSource = async (formId: string) => {
    if (confirmed && !reason.trim()) { setError('Removing a source form is an amendment — type a reason below first.'); return; }
    setBusy(true); setError(null);
    try {
      await syn.updateProtocol({ source_forms: sources.filter(s => s.form_id !== formId), ...(confirmed ? { reason: reason.trim() } : {}) });
      setReason('');
    } catch (e: any) { setError(e?.message ?? 'Could not remove the source form.'); } finally { setBusy(false); }
  };

  const memberOptions = [{ value: '', label: 'Not assigned' }, ...syn.members.map(m => ({ value: m.user_id, label: m.full_name || m.email }))];

  // Registry counts across source forms.
  let rowsTotal = 0; let aiOnly = 0;
  const studies = new Set<string>();
  for (const sf of sources) {
    const fd = syn.formData(sf.form_id);
    if (!fd) continue;
    rowsTotal += fd.rows.length;
    aiOnly += fd.provenance.aiOnly;
    for (const r of fd.chosen) studies.add(r.document_id);
  }

  const columnChoices = useMemo(() => {
    const out = new Set<string>();
    for (const sf of sources) for (const c of syn.formData(sf.form_id)?.selectColumns ?? []) out.add(c);
    return [...out];
  }, [sources, syn]);

  return (
    <div className="mx-auto max-w-[880px] pb-16">
      <ScreenHeader active="protocol" />
      <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">Synthesis protocol</h1>
      <div className="mt-1 text-[13.5px] text-gray-500 dark:text-zinc-400">
        {confirmed ? `Version ${p.version} · confirmed by ${syn.nameOf(p.confirmed_by)} · ${day(p.confirmed_at)}` : 'Draft — nothing here applies until the protocol is confirmed.'}
      </div>

      {confirmed && (
        <Banner tone="green" icon="lock" className="mt-5">
          Protocol confirmed and locked. A change becomes an amendment with a reason, and syntheses record the protocol version they ran under.
        </Banner>
      )}
      {!editable && (
        <Banner tone="gray" className="mt-3">Only project managers can edit the protocol. You are viewing it read-only.</Banner>
      )}

      <Section label="Result registry" sub="Where synthesis evidence comes from — the project's extracted results.">
        <TableFrame>
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[1.4fr_1fr_110px_120px_130px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
              <Th>Form</Th><Th>Table</Th><Th>Studies / rows</Th><Th>Mapping</Th><Th />
            </div>
            {syn.forms.map(f => {
              const sf = sources.find(s => s.form_id === f.id);
              const fd = syn.formData(f.id);
              const state = !sf ? 'Not a source' : sourceFormReady(sf) ? 'Confirmed' : 'To confirm';
              return (
                <div key={f.id} className="grid min-h-[48px] grid-cols-[1.4fr_1fr_110px_120px_130px] items-center gap-3 border-t border-[#ececea] px-3 py-2 dark:border-[#1f1f1f]">
                  <span className="truncate text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100" title={f.form_name}>{f.form_name}</span>
                  <Mono className="truncate">{sf?.field_name ?? fd?.tableField ?? '—'}</Mono>
                  <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">{fd ? `${fd.chosen.length} / ${fd.rows.length}` : sf ? '…' : '—'}</span>
                  <StateText tone={state === 'Confirmed' ? 'green' : state === 'To confirm' ? 'amber' : 'gray'}>{state}</StateText>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => go({ screen: 'mapping', form: f.id })}
                      className="text-[12.5px] font-medium text-[#0a0a0a] hover:underline dark:text-zinc-100">Open mapping →</button>
                    {sf && editable && (
                      <button type="button" onClick={() => removeSource(f.id)} title="Remove as a source form" disabled={busy}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>
              );
            })}
            {syn.forms.length === 0 && <div className="border-t border-[#ececea] px-3 py-4 text-[13px] text-gray-500 dark:border-[#1f1f1f]">No active forms in this project.</div>}
          </div>
        </TableFrame>
        <div className="mt-2.5 text-[12.5px] text-gray-500 dark:text-zinc-400">
          {sources.length} source form{sources.length === 1 ? '' : 's'} · {studies.size} studies · {rowsTotal} records · {aiOnly} AI-only
        </div>
      </Section>
      <Hairline />

      <Section label="Source forms and column mapping" sub="Form-level, done once; a synthesis records only overrides, as deviations.">
        {sources.length === 0 ? (
          <div className="text-[13px] text-gray-500 dark:text-zinc-400">No source form yet — open a form’s mapping above and confirm it.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {sources.map(sf => (
              <div key={sf.form_id} className="rounded-[10px] bg-[#fafafa] px-4 py-3 dark:bg-[#141414]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">{syn.formById.get(sf.form_id)?.form_name ?? sf.form_id}</span>
                  <span className="text-[12px] text-gray-500 dark:text-zinc-400">{KIND_LABEL[sf.kind]} · {sf.layout === 'wide' ? 'one row per comparison' : 'one row per arm'}{sf.comparator_value ? ` · comparator = “${sf.comparator_value}”` : ''}</span>
                  <span className="ml-auto">{sourceFormReady(sf)
                    ? <StateText tone="green">✓ {syn.nameOf(sf.confirmed_by)} · {day(sf.confirmed_at)}</StateText>
                    : <StateText tone="amber">Not confirmed</StateText>}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(sf.mapping ?? {}).map(([slot, col]) => (
                    <span key={slot} className="text-[12px] text-gray-600 dark:text-zinc-400">
                      {SLOT_LABEL[slot as SlotKey] ?? slot} → <Mono>{col}</Mono>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Hairline />

      <Section label="Analysis defaults" sub="One validated tuple per outcome type. A synthesis that departs from it logs a deviation.">
        {kinds.length === 0 ? (
          <div className="text-[13px] text-gray-500 dark:text-zinc-400">Defaults are set per outcome type — confirm a source form first.</div>
        ) : (
          <TableFrame>
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[120px_150px_1fr] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Outcome type</Th><Th>Preferred measure</Th><Th>Method preset</Th>
              </div>
              {defaultRows.map(d => {
                const v = validateDefault(d);
                const setPreset = (patch: Partial<SynthesisPreset>) => {
                  const preset = { ...d.preset, ...patch };
                  if (preset.model !== 'random') preset.ci = 'z';
                  setDefault({ ...d, preset });
                };
                return (
                  <div key={d.kind} className="grid grid-cols-[120px_150px_1fr] items-start gap-3 border-t border-[#ececea] px-3 py-3 dark:border-[#1f1f1f]">
                    <span className="pt-2 text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{KIND_LABEL[d.kind]}</span>
                    <Select<string> value={d.measure} disabled={!editable} ariaLabel="Measure"
                      onChange={m => setDefault({ ...d, measure: m })}
                      options={effectOptions(d.kind).map(m => ({ value: m, label: `${m} · ${EFFECT_LABEL[m as EffectMeasure]}` }))} />
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap gap-2">
                        <Select<SynthesisPreset['model']> value={d.preset.model} disabled={!editable} ariaLabel="Model"
                          onChange={m => setPreset({ model: m })}
                          options={[
                            { value: 'random', label: 'Random effects' },
                            { value: 'fixed', label: 'Common-effect (IV)' },
                            { value: 'mh', label: 'Common-effect (M–H)' },
                            { value: 'peto', label: 'Common-effect (Peto)' },
                          ]} />
                        {d.preset.model === 'random' && (
                          <>
                            <Select<SynthesisPreset['tau2']> value={d.preset.tau2} disabled={!editable} ariaLabel="tau² estimator"
                              onChange={t => setPreset({ tau2: t })}
                              options={[{ value: 'reml', label: 'REML τ²' }, { value: 'dl', label: 'DL τ²' }, { value: 'pm', label: 'PM τ²' }]} />
                            <Select<SynthesisPreset['ci']> value={d.preset.ci} disabled={!editable} ariaLabel="CI method"
                              onChange={c => setPreset({ ci: c })}
                              options={[{ value: 'hk', label: 'Hartung–Knapp CI' }, { value: 'z', label: 'z (Wald) CI' }]} />
                          </>
                        )}
                      </div>
                      <StateText tone={v.ok ? 'muted' : 'red'}>{v.ok ? `✓ ${v.note}` : `× ${v.note}`}</StateText>
                    </div>
                  </div>
                );
              })}
            </div>
          </TableFrame>
        )}
      </Section>
      <Hairline />

      <Section label="Planned analyses" sub="Written before any result is seen. Each must be run, or recorded as not run with a reason, before a version can be finalized.">
        <div className="flex flex-col gap-2">
          {planned.map((a, i) => (
            <div key={a.id} className="grid grid-cols-1 gap-2 rounded-[10px] bg-[#fafafa] p-3 sm:grid-cols-[150px_1fr_180px_28px] dark:bg-[#141414]">
              <Select<PlannedAnalysis['analysis_type']> value={a.analysis_type} disabled={!editable} ariaLabel="Analysis type"
                onChange={t => setPlanned(ps => ps.map((x, j) => j === i ? { ...x, analysis_type: t, field: null } : x))}
                options={[
                  { value: 'Primary', label: 'Primary' }, { value: 'Subgroup', label: 'Subgroup' },
                  { value: 'Sensitivity', label: 'Sensitivity' }, { value: 'MetaRegression', label: 'Meta-regression' },
                ]} />
              <TextInput value={a.description} placeholder="Description, e.g. by baseline severity"
                onChange={v => setPlanned(ps => ps.map((x, j) => j === i ? { ...x, description: v } : x))} />
              {a.analysis_type === 'Sensitivity' ? (
                <Select<string> value={a.field ?? ''} disabled={!editable} ariaLabel="Sensitivity rule"
                  onChange={f => setPlanned(ps => ps.map((x, j) => j === i ? { ...x, field: f || null } : x))}
                  options={[{ value: '', label: 'Rule…' }, ...Object.entries(SENSITIVITY_RULES).map(([k, r]) => ({ value: k, label: r.label }))]} />
              ) : a.analysis_type === 'Subgroup' || a.analysis_type === 'MetaRegression' ? (
                <Select<string> value={a.field ?? ''} disabled={!editable} ariaLabel="Field"
                  onChange={f => setPlanned(ps => ps.map((x, j) => j === i ? { ...x, field: f || null } : x))}
                  options={[{ value: '', label: 'Field…' }, ...columnChoices.map(c => ({ value: c, label: c })),
                    ...(a.field && !columnChoices.includes(a.field) ? [{ value: a.field, label: a.field }] : [])]} />
              ) : <span className="self-center text-[12px] text-gray-400">—</span>}
              {editable ? (
                <button type="button" aria-label="Remove analysis" onClick={() => setPlanned(ps => ps.filter((_, j) => j !== i))}
                  className="self-center text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              ) : <span />}
            </div>
          ))}
          {editable && (
            <div>
              <OutlineButton small onClick={() => setPlanned(ps => [...ps, {
                id: newId(), analysis_type: ps.some(x => x.analysis_type === 'Primary') ? 'Subgroup' : 'Primary', description: '', field: null,
              }])}><Plus className="h-3.5 w-3.5" />Add analysis</OutlineButton>
            </div>
          )}
          {planned.length === 0 && <div className="text-[12.5px] text-gray-500 dark:text-zinc-400">None yet. A primary analysis is the minimum.</div>}
        </div>
      </Section>
      <Hairline />

      <Section label="Roles" sub="Finalization is role-gated and enforced server-side.">
        <TableFrame>
          <div className="min-w-[480px]">
            {([
              ['finalizer', 'Finalizer', 'Finalizes a synthesis version'],
              ['approver', 'Approver', 'Gives the second approval'],
            ] as const).map(([key, label, desc]) => (
              <div key={key} className="grid grid-cols-[140px_1fr_220px] items-center gap-3 border-t border-[#ececea] px-3 py-2.5 first:border-t-0 dark:border-[#1f1f1f]">
                <span className="text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{label}</span>
                <span className="text-[12px] text-gray-500 dark:text-zinc-400">{desc}</span>
                <Select<string> value={roles[key] ?? ''} disabled={!editable} ariaLabel={label}
                  onChange={v => setRoles(r => ({ ...r, [key]: v || null }))} options={memberOptions} />
              </div>
            ))}
          </div>
        </TableFrame>
        {roles.second_approval === 'required' && roles.approver && roles.approver === roles.finalizer && (
          <div className="mt-2"><StateText tone="red">With second approval required, the approver must be a different person from the finalizer.</StateText></div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">Second approval</span>
          <Segmented value={roles.second_approval} disabled={!editable}
            onChange={v => setRoles(r => ({ ...r, second_approval: v }))}
            options={[{ value: 'required', label: 'Required' }, { value: 'optional', label: 'Optional' }]}
            className="[&>button]:min-w-[96px] [&>button]:py-1.5" />
        </div>
      </Section>

      {editable && (
        <>
          <Hairline />
          <div className="flex flex-col gap-3 py-8">
            {confirmed && (
              <div className="max-w-[560px]">
                <div className="mb-1.5 text-[12.5px] font-medium text-gray-700 dark:text-zinc-300">Reason for this amendment</div>
                <ReasonInput value={reason} onChange={setReason} placeholder="Required — what changed and why" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {!confirmed && (
                <PrimaryButton disabled={!allSet || busy} onClick={() => save(true)}>Confirm protocol ›</PrimaryButton>
              )}
              <OutlineButton disabled={busy || !dirty || (confirmed && !reason.trim())} onClick={() => save(false)}>
                {confirmed ? 'Save amendment' : 'Save draft'}
              </OutlineButton>
              {!confirmed && !allSet && (
                <span className="text-[12.5px] text-gray-500 dark:text-zinc-400">
                  Still to set: {[!sourcesSet && 'source mappings', !defaultsSet && 'analysis defaults', !plannedSet && 'planned analyses', !rolesSet && 'roles'].filter(Boolean).join(', ')}
                </span>
              )}
              {saved && <StateText tone="green">{saved}</StateText>}
              {error && <StateText tone="red">{error}</StateText>}
            </div>
          </div>
        </>
      )}

      {(p.history ?? []).length > 0 && (
        <>
          <Hairline />
          <Section label="Amendment history">
            <div className="flex flex-col gap-2.5">
              {[...p.history].reverse().map((h, i) => (
                <div key={`${h.at}-${i}`} className="text-[13px] leading-[20px] text-[#374151] dark:text-zinc-300">
                  <span className="text-gray-400">{day(h.at)} · </span>
                  {h.what} <span className="text-gray-500">· {h.by_name ?? syn.nameOf(h.by)}</span>
                  {h.why && <span className="text-gray-500"> · “{h.why}”</span>}
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
