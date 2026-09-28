'use client';

/**
 * Form-level mapping: which columns of a form's table are which analysis
 * roles, how spreads convert, how timepoint synonyms merge. Done once per
 * form and saved on the protocol (`source_forms`) — not in the browser — so
 * every synthesis and every reviewer reads the same mapping.
 *
 * Wraps the existing MappingStep / SlotSelect / UnitsCard / HarmonizeCard.
 * Suggestions from the mapper stay amber and inert until confirmed; saving
 * requires every required slot confirmed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { synthesisService } from '@/services';
import type { SynthesisKind, SynthesisSourceForm } from '@/services/synthesis.service';
import {
  allConfirmed, columnCoverage, missingSlots, SLOT_LABEL,
  type EffectScale, type Mapping, type OutcomeKind, type SlotKey, type TableLayout,
} from '../../_lib/mapping';
import {
  detectCentralTendencyMeasureColumn, detectVariabilityMeasureColumn, isMedian,
  type CentralTendencyAction, type VariabilityAction,
} from '../../_lib/buildStudies';
import {
  KEEP, suggestHarmonization, tallyValues, type Confirmations, type Harmonization,
} from '../../_lib/reconcile';
import { useSynthesisNav } from '../../_lib/nav';
import { defaultFor, mappingOf, unitsOf } from '../../_lib/synthesisModel';
import { LoadError, useFormRows, useSynthesis } from '../../_lib/useSynthesisData';
import { MappingStep } from '../MappingStep';
import { NotPoolableExplainer } from '../NotPoolableExplainer';
import { UnitsCard, type MeasureTally } from '../UnitsCard';
import { HarmonizeCard } from '../ReconcileCards';
import {
  Banner, Hairline, Mono, OutlineButton, PrimaryButton, ReasonInput, ScreenHeader, StateText, TableFrame, Th,
} from '../ui';

const POOLABLE = ['dichotomous', 'continuous', 'effect', 'proportion', 'correlation'];

export function MappingScreen() {
  const syn = useSynthesis();
  const { get, go } = useSynthesisNav();
  // A `form` param from another project (the selector keeps the query string)
  // is not this project's form — fall back to the first one rather than "Choose a form".
  const requestedForm = get('form');
  const formId = (requestedForm && syn.formById.has(requestedForm) ? requestedForm : syn.forms[0]?.id) || '';
  const existing = (syn.protocol.source_forms ?? []).find(s => s.form_id === formId) ?? null;
  const confirmedProtocol = !!syn.protocol.confirmed_at;

  const [nonce, setNonce] = useState(0);
  const suggestionQ = useQuery({
    queryKey: ['synthesis-suggest', syn.projectId, formId, nonce],
    queryFn: () => synthesisService.suggestMapping(formId, { force: nonce > 0 }),
    enabled: !!formId,
    retry: false,
    staleTime: Infinity,
  });
  const suggestion = suggestionQ.data;
  // The table the mapping is made against drives the flattening: the saved one
  // (a stored mapping outranks a suggestion), else the suggested one — so the
  // columns offered and the rows extracted come from the same table.
  const mappedField = (existing && nonce === 0 ? existing.field_name : null) ?? suggestion?.field_name ?? existing?.field_name ?? null;
  const fd = useFormRows(formId, mappedField);

  const [kind, setKind] = useState<OutcomeKind>('continuous');
  const [layout, setLayout] = useState<TableLayout>('wide');
  const [effectScale, setEffectScale] = useState<EffectScale>('natural');
  const [mapping, setMapping] = useState<Mapping>({});
  const [comparatorValue, setComparatorValue] = useState('');
  const [variabilityActions, setVariabilityActions] = useState<Record<string, VariabilityAction>>({});
  const [centralActions, setCentralActions] = useState<Record<string, CentralTendencyAction>>({});
  const [harmonizeChoices, setHarmonizeChoices] = useState<Harmonization>({});
  const [harmonizeConfirmed, setHarmonizeConfirmed] = useState<Confirmations>({});
  const [forcedEffect, setForcedEffect] = useState(false);
  const [seededFor, setSeededFor] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Every per-form setting back to its default. A new form or a new suggestion
   * starts from this, so nothing from the previous form — effect scale, spread
   * or median actions, confirmed timepoint merges — leaks into it.
   */
  const resetPerForm = useCallback(() => {
    setKind('continuous');
    setLayout('wide');
    setEffectScale('natural');
    setMapping({});
    setComparatorValue('');
    setVariabilityActions({});
    setCentralActions({});
    setHarmonizeChoices({});
    setHarmonizeConfirmed({});
  }, []);

  // Seed from the stored mapping (the reviewer's own work outranks a suggestion),
  // otherwise from the suggestion once it arrives. Every seed starts from a full
  // reset, so a partial seed never inherits the previous form's settings.
  useEffect(() => {
    const key = `${formId}:${existing && nonce === 0 ? 'stored' : suggestion ? `s${nonce}:${suggestionQ.dataUpdatedAt}` : 'none'}`;
    if (!formId || seededFor === key) return;
    resetPerForm();
    if (existing && nonce === 0) {
      const u = unitsOf(existing);
      setKind(existing.kind);
      setLayout(existing.layout);
      setEffectScale(existing.effect_scale ?? 'natural');
      setMapping(mappingOf(existing));
      setComparatorValue(existing.comparator_value ?? '');
      setVariabilityActions(u.variabilityActions);
      setCentralActions(u.centralActions);
      setHarmonizeChoices(u.harmonizeChoices);
      setHarmonizeConfirmed(u.harmonizeConfirmed);
      setSeededFor(key);
      return;
    }
    if (suggestion && POOLABLE.includes(suggestion.verdict)) {
      const next: Mapping = {};
      for (const [role, col] of Object.entries(suggestion.slots)) {
        next[role as SlotKey] = { col, status: 'suggested', why: suggestion.per_slot_reasoning[role] };
      }
      const k = suggestion.verdict as OutcomeKind;
      setKind(k);
      setLayout(k === 'dichotomous' || k === 'continuous' ? suggestion.layout ?? 'wide' : 'wide');
      setMapping(next);
      setComparatorValue(suggestion.comparator_value ?? '');
      setSeededFor(key);
    } else {
      // No stored mapping and no (poolable) suggestion: the reset stands.
      setSeededFor(key);
    }
  }, [formId, existing, suggestion, nonce, seededFor, suggestionQ.dataUpdatedAt, resetPerForm]);

  useEffect(() => { setSaved(false); setError(null); setForcedEffect(false); setReason(''); setNonce(0); }, [formId]);

  const rows = useMemo(() => fd?.rows ?? [], [fd]);
  const columns = useMemo(() => fd?.columns ?? [], [fd]);
  const total = fd?.chosen.length ?? 0;
  const tableColumns = useMemo(() => (suggestion?.columns ?? []).map(c => c.name), [suggestion]);
  const tableCov = useMemo(() => columnCoverage(rows, (tableColumns.length ? tableColumns : fd?.tableColumns ?? []).filter(c => columns.includes(c)), total), [rows, tableColumns, fd, columns, total]);
  const flatCov = useMemo(() => columnCoverage(rows, (fd?.flatFields ?? []).filter(c => columns.includes(c)), total), [rows, fd, columns, total]);

  const armOptions = useMemo(() => {
    const col = mapping.arm?.col;
    if (!col) return [];
    return [...new Set(rows.map(r => String(r[col] ?? '').trim()).filter(Boolean))].sort();
  }, [mapping.arm?.col, rows]);

  const timepointColumn = mapping.timepoint?.col ?? null;
  const timepointValues = useMemo(() => tallyValues(rows, timepointColumn), [rows, timepointColumn]);
  const harmonizeSuggestion = useMemo(() => suggestHarmonization(timepointValues), [timepointValues]);
  const effectiveHarmonize = useMemo(() => ({ ...harmonizeSuggestion.choices, ...harmonizeChoices }), [harmonizeSuggestion.choices, harmonizeChoices]);
  const pendingMerges = Object.entries(effectiveHarmonize).filter(([raw, c]) => c !== KEEP && !harmonizeConfirmed[raw]).length;

  const variabilityColumn = suggestion?.variability_measure_column ?? detectVariabilityMeasureColumn(columns);
  const centralColumn = detectCentralTendencyMeasureColumn(columns);
  const tally = (col: string | null, filter?: (m: string) => boolean): MeasureTally[] => {
    if (!col) return [];
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const v = String(r[col] ?? '').trim();
      if (!v || (filter && !filter(v))) continue;
      if (!m.has(v)) m.set(v, new Set());
      m.get(v)!.add(r._documentId);
    }
    return [...m.entries()].map(([measure, d]) => ({ measure, documents: d.size })).sort((a, b) => b.documents - a.documents);
  };
  const variabilityTallies = kind === 'continuous' && layout === 'long' ? tally(variabilityColumn) : [];
  const centralTallies = kind === 'continuous' && layout === 'long' ? tally(centralColumn, v => isMedian(v) || /mean/i.test(v)) : [];

  const setSlot = useCallback((key: SlotKey, col: string) => {
    setMapping(m => {
      const next = { ...m };
      if (col) next[key] = { col, status: 'confirmed' };
      else delete next[key];
      return next;
    });
  }, []);
  const confirmSlot = useCallback((key: SlotKey) => {
    setMapping(m => (m[key] ? { ...m, [key]: { ...m[key]!, status: 'confirmed' } } : m));
  }, []);
  const confirmAll = useCallback(() => {
    setMapping(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v!, status: 'confirmed' as const }])) as Mapping);
  }, []);

  const ready = allConfirmed(mapping, kind, layout) && (layout === 'wide' || !!comparatorValue);
  const missing = missingSlots(mapping, kind, layout);

  // Warnings the reviewer should see before confirming.
  const nrTimepoints = timepointColumn ? rows.filter(r => /^(nr|not reported|n\/?a|)$/i.test(String(r[timepointColumn] ?? '').trim())).length : 0;
  const nCol = mapping.denominator?.col ?? mapping.n_treatment?.col ?? mapping.total_treatment?.col ?? mapping.prop_total?.col ?? mapping.corr_n?.col;
  const noDenominator = nCol ? rows.filter(r => !String(r[nCol] ?? '').trim() || /^nr$/i.test(String(r[nCol] ?? '').trim())).length : 0;

  const save = async () => {
    if (!ready || !fd) return;
    if (confirmedProtocol && !reason.trim()) { setError('The protocol is confirmed — a mapping change is an amendment and needs a reason.'); return; }
    setBusy(true); setError(null);
    const entry: SynthesisSourceForm = {
      form_id: formId,
      // The table actually flattened for this screen — the one the columns came from.
      field_name: fd.tableField,
      kind: kind as SynthesisKind,
      layout,
      effect_scale: effectScale,
      mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v?.status === 'confirmed').map(([k, v]) => [k, v!.col])),
      comparator_value: layout === 'long' ? comparatorValue : null,
      units: {
        variabilityActions, centralActions,
        harmonizeChoices, harmonizeConfirmed,
        variabilityMeasureColumn: variabilityColumn, centralMeasureColumn: centralColumn,
      },
      confirmed_by: syn.currentUserId || null,
      confirmed_at: new Date().toISOString(),
    };
    try {
      const storedDefaults = syn.protocol.defaults ?? [];
      await syn.updateProtocol({
        source_forms: [...(syn.protocol.source_forms ?? []).filter(s => s.form_id !== formId), entry],
        // A source of a new outcome type writes that type's default down in the
        // same change, so the protocol never runs on a default it doesn't record.
        ...(storedDefaults.some(d => d.kind === entry.kind) ? {} : { defaults: [...storedDefaults, defaultFor(storedDefaults, entry.kind)] }),
        ...(confirmedProtocol ? { reason: reason.trim() } : {}),
      });
      setSaved(true);
      setReason('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the mapping.');
    } finally {
      setBusy(false);
    }
  };

  const verdictPoolable = !suggestion || POOLABLE.includes(suggestion.verdict);
  const showExplainer = !!suggestion && !verdictPoolable && !existing && !forcedEffect;

  // Mapped-role preview (README: Role · Column · Sample values · Filled).
  const preview = Object.entries(mapping).map(([slot, st]) => {
    const col = st!.col;
    const values = [...new Set(rows.map(r => String(r[col] ?? '').trim()).filter(Boolean))].slice(0, 3);
    const filled = new Set(rows.filter(r => String(r[col] ?? '').trim() && !/^nr$/i.test(String(r[col] ?? '').trim())).map(r => r._documentId)).size;
    return { slot: slot as SlotKey, col, values, filled, status: st!.status };
  });

  return (
    <div className="mx-auto max-w-[1040px] pb-16">
      <ScreenHeader active="protocol" />
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">Column mapping</h1>
        <span className="text-[13px] text-gray-500 dark:text-zinc-400">
          {existing?.confirmed_at ? `Confirmed by ${syn.nameOf(existing.confirmed_by)}` : 'Form-level — done once, used by every synthesis'}
        </span>
      </div>
      {!syn.canManage && <Banner tone="gray" className="mb-4">Only project managers can change the mapping. You are viewing it read-only.</Banner>}

      {!fd ? (
        <div className="text-[13px] text-gray-500">Choose a form.</div>
      ) : fd.error ? (
        <LoadError error={fd.error} onRetry={fd.retry} what={`the extractions for ${fd.form.form_name}`} />
      ) : fd.loading ? (
        <div className="py-10 text-center text-[13px] text-gray-500 dark:text-zinc-400">Loading extractions…</div>
      ) : showExplainer ? (
        <>
          <div className="mb-4 max-w-[640px]">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Source form</label>
            <select value={formId} onChange={e => go({ form: e.target.value })}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-[13px] text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white">
              {syn.forms.map(f => <option key={f.id} value={f.id}>{f.form_name}</option>)}
            </select>
          </div>
          <NotPoolableExplainer suggestion={suggestion!} formName={fd.form.form_name}
            onUseReportedEffect={() => { setForcedEffect(true); setKind('effect'); setLayout('wide'); setMapping({}); }} />
        </>
      ) : (
        <div className={syn.canManage ? '' : 'pointer-events-none opacity-90'}>
          <MappingStep
            forms={syn.forms}
            formId={formId}
            onFormChange={id => go({ form: id })}
            sourceField={fd.tableField}
            scalarCoverage={flatCov}
            columnCoverage={tableCov}
            columnNames={columns}
            kind={kind}
            layout={layout}
            onKind={k => { setKind(k); if (k !== 'dichotomous' && k !== 'continuous') setLayout('wide'); }}
            onLayout={setLayout}
            effectScale={effectScale}
            onEffectScale={setEffectScale}
            mapping={mapping}
            onSelect={setSlot}
            onConfirm={confirmSlot}
            onConfirmAll={confirmAll}
            onSuggest={() => { setNonce(n => n + 1); }}
            suggesting={suggestionQ.isFetching}
            suggestionSource={suggestion?.source ?? null}
            suggestionWarnings={suggestion?.warnings ?? []}
            armOptions={armOptions}
            comparatorValue={comparatorValue}
            onComparatorValue={setComparatorValue}
            armColumn={mapping.arm?.col ?? null}
          >
            {timepointColumn && (
              <HarmonizeCard
                column={timepointColumn}
                values={timepointValues}
                choices={effectiveHarmonize}
                reasons={harmonizeSuggestion.reasons}
                confirmed={harmonizeConfirmed}
                onChoice={(raw, choice) => {
                  setHarmonizeChoices(c => ({ ...c, [raw]: choice }));
                  setHarmonizeConfirmed(c => ({ ...c, [raw]: choice !== KEEP }));
                }}
                onConfirm={raw => setHarmonizeConfirmed(c => ({ ...c, [raw]: true }))}
                mergedCount={pendingMerges}
              />
            )}
            {variabilityTallies.length > 0 && (
              <UnitsCard
                measures={variabilityTallies}
                actions={variabilityActions}
                onAction={(m, a) => setVariabilityActions(p => ({ ...p, [m]: a }))}
                centralTendencies={centralTallies}
                centralActions={centralActions}
                onCentralAction={(m, a) => setCentralActions(p => ({ ...p, [m]: a }))}
                variabilityColumn={mapping.variability?.col ?? null}
                excludedCount={0}
                excludedStudies={[]}
              />
            )}
          </MappingStep>

          {preview.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[14px] font-semibold text-[#0a0a0a] dark:text-white">Mapping preview</div>
              <TableFrame>
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[170px_190px_1fr_90px_110px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                    <Th>Role</Th><Th>Column</Th><Th>Sample values</Th><Th>Filled</Th><Th>State</Th>
                  </div>
                  {preview.map(r => (
                    <div key={r.slot} className="grid min-h-[52px] grid-cols-[170px_190px_1fr_90px_110px] items-center gap-3 border-t border-[#ececea] px-3 dark:border-[#1f1f1f]">
                      <span className="text-[13px] text-[#0a0a0a] dark:text-zinc-100">{SLOT_LABEL[r.slot] ?? r.slot}</span>
                      <Mono className="truncate text-[12.5px]">{r.col}</Mono>
                      <span className="truncate text-[12.5px] text-gray-500 dark:text-zinc-400">{r.values.join(' · ') || '—'}</span>
                      <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">{r.filled}/{total}</span>
                      <StateText tone={r.status === 'confirmed' ? 'green' : 'amber'}>{r.status === 'confirmed' ? 'Confirmed' : 'Suggested'}</StateText>
                    </div>
                  ))}
                </div>
              </TableFrame>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {nrTimepoints > 0 && (
              <Banner tone="slate">{nrTimepoints} row{nrTimepoints === 1 ? '' : 's'} with an NR or blank timepoint — they enter every synthesis as <Mono>timepoint = unknown</Mono> and are never matched to a window automatically.</Banner>
            )}
            {noDenominator > 0 && (
              <Banner tone="slate">{noDenominator} row{noDenominator === 1 ? '' : 's'} without a denominator — they will be listed as missing required data, not dropped.</Banner>
            )}
            {layout === 'long' && ready && (
              <Banner tone="slate">Identity preview: <strong>paired contrast built from two arm rows</strong> — rows are grouped by study, outcome and timepoint; the row whose <Mono>{mapping.arm?.col}</Mono> is “{comparatorValue}” is the comparator for every other row in its group.</Banner>
            )}
          </div>

          <Hairline className="my-6" />
          {syn.canManage && (
            <div className="flex flex-col gap-3">
              {confirmedProtocol && (
                <div className="max-w-[560px]">
                  <div className="mb-1.5 text-[12.5px] font-medium text-gray-700 dark:text-zinc-300">Reason (the protocol is confirmed — this is an amendment)</div>
                  <ReasonInput value={reason} onChange={setReason} />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton disabled={!ready || busy || (confirmedProtocol && !reason.trim())} onClick={save}>✓ Confirm mapping</PrimaryButton>
                <OutlineButton onClick={() => go({ screen: syn.protocolConfirmed ? 'protocol' : 'welcome', form: null })}>Back to protocol</OutlineButton>
                {!ready && (
                  <span className="text-[12.5px] text-gray-500 dark:text-zinc-400">
                    {missing.length ? `Map ${missing.map(m => SLOT_LABEL[m]).join(', ')}` : layout === 'long' && !comparatorValue ? 'Choose which arm is the comparator' : 'Confirm every suggested slot'}
                  </span>
                )}
                {saved && <StateText tone="green">Mapping saved on the protocol.</StateText>}
                {error && <StateText tone="red">{error}</StateText>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
