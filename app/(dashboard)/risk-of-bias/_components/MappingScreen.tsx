'use client';

/**
 * Column mapping for one outcome form — columns first.
 *
 * Iteration-2 layout: one row per column of the form (name · what it holds ·
 * which RoB role it feeds), a sticky rail with the role checklist, a live
 * "one result, as a reviewer will see it" preview and what the mapping will
 * produce under the protocol's scope. Rules carried over from the Sep 22
 * `ColumnMapper`:
 *
 *  - **Written-down mappings, never guessed.** A table nobody has mapped
 *    arrives empty and is asked about.
 *  - **Claims about a column come from `column_stats`,** never from `samples`,
 *    which stops at 12 values from 200 rows.
 *  - **A mapped column the form no longer has is reported, not replaced.**
 *    Substituting the nearest match would silently re-point live results.
 *  - **The preview is built from ONE real row**, because the first value of two
 *    columns need not come from the same extraction.
 *
 * Picking a role for a column releases it from any other column. Editing any
 * role un-confirms the form until it is confirmed again.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { mappingProblems } from '../_lib/mappingProblems';
import { useRob } from '../_lib/useRobData';
import { useRobBuild } from './ProtocolScreen';
import { Pill, useRobNav } from './robUi';

interface Field {
  id: string;
  label: string;
  required?: boolean;
}

const MAIN_FIELDS: Field[] = [
  { id: 'outcome_domain', label: 'Outcome', required: true },
  { id: 'timepoint', label: 'Timepoint' },
  { id: 'measurement', label: 'Measurement' },
  { id: 'arm', label: 'Arm', required: true },
  { id: 'analysis_population', label: 'Analysis population' },
];

const EXTRA_FIELDS: Field[] = [
  { id: 'population', label: 'Population' },
  { id: 'outcome_fallback', label: 'Outcome fallback' },
  { id: 'outcome_qualifier', label: 'Outcome qualifier' },
  { id: 'arm_fallback', label: 'Arm fallback' },
  { id: 'analysis', label: 'Analysis' },
];

const ALL_FIELDS = [...MAIN_FIELDS, ...EXTRA_FIELDS];

/**
 * The rows the mapping table always shows, in this order, whatever the form
 * contains. Extra roles (population, fallbacks, qualifier, analysis) are not
 * listed; a mapping already stored for them is kept untouched on save.
 */
const ROW_FIELDS: Field[] = ['outcome_domain', 'measurement', 'timepoint', 'arm', 'analysis_population']
  .map(id => ALL_FIELDS.find(f => f.id === id)!);

/** The population-blank answer, stored in the mapping beside the role columns. */
const POP_KEYS = ['population_blank', 'population_blank_value'];
const ABSENT_POP = /^(nr|na|n\/a|not reported|not applicable|-|—)$/i;

const ROLE_GRID = 'grid grid-cols-[190px_220px_minmax(0,1fr)] items-center gap-x-4';

/** Roles whose columns split one outcome into several results. */
const SPLITTERS = ['timepoint', 'measurement', 'analysis_population'];

/** A value column: every recorded value is a number (n, mean, sd, events, p). */
const NUMERIC = /^[<>]?\s*-?[\d.,]+%?$/;

const EYEBROW = 'text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500';
const CARD = 'overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]';

export function MappingScreen() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const src = useRobBuild();
  const editable = rob.canManage;
  const outcomeScope = rob.protocol.scope === 'outcome';

  const forms = src.forms;
  const formId = get('form');
  const index = Math.max(0, forms.findIndex(f => f.form_id === formId));
  const form = forms[index] ?? null;
  const nextForm = form ? forms[index + 1] ?? null : null;

  // One draft per form, so moving to the next form and back keeps what was picked.
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    if (!form) return;
    setDrafts(d => (form.form_id in d ? d : { ...d, [form.form_id]: { ...(form.mapping ?? {}) } }));
  }, [form]);

  const draft = useMemo(
    () => (form ? drafts[form.form_id] ?? { ...(form.mapping ?? {}) } : {}),
    [form, drafts]);
  const setDraft = (next: Record<string, string>) => {
    if (form) setDrafts(d => ({ ...d, [form.form_id]: next }));
  };

  const back = () => go({ screen: 'protocol', form: null });

  if (src.loading) {
    return (
      <div className="flex max-w-[1120px] items-center gap-2 py-16 text-[13px] text-[#6b7280]">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the outcome forms…
      </div>
    );
  }

  const backLink = (
    <button type="button" onClick={back}
      className="flex items-center gap-[6px] self-start border-none bg-transparent p-0 text-[12px] text-[#6b7280] hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">
      <ChevronLeft className="h-[14px] w-[14px]" strokeWidth={2} />Review protocol · Result sources
    </button>
  );

  if (!form) {
    return (
      <div className="flex max-w-[1120px] flex-col gap-4">
        {backLink}
        <div className={cn(CARD, 'px-5 py-8 text-[13px] text-[#6b7280] dark:text-zinc-500')}>
          No ticked outcome form to map. Tick a form under Result sources first.
        </div>
      </div>
    );
  }

  const columns = form.columns ?? [];
  const stats = form.column_stats ?? {};

  const samplesOf = (column: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of (form.samples?.[column] ?? [])) {
      const text = String(value).trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  };
  const statOf = (column: string) => {
    const s = stats[column];
    const shown = samplesOf(column);
    return { distinct: s?.distinct ?? shown.length, rows: s?.rows ?? (form.samples?.[column] ?? []).length };
  };

  // A number column (n, events, %, mean, sd, p) is hidden. Absence markers
  // (NR, NA, blank) are ignored: real extractions write "NR" into number
  // columns, and counting it as text is what let events_n / events_pct show.
  const ABSENT = /^(nr|na|n\/a|not reported|not applicable|-|—|)$/i;
  const isValueCol = (column: string) => {
    const values = (form.samples?.[column] ?? samplesOf(column)).map(v => String(v).trim())
      .filter(v => !ABSENT.test(v));
    return values.length > 0 && values.every(v => NUMERIC.test(v));
  };

  /** Point a role at a column; the column stops feeding any other role. */
  const pickRole = (role: string, column: string) => {
    const next = { ...draft };
    if (column) for (const key of Object.keys(next)) if (next[key] === column) delete next[key];
    if (column) next[role] = column; else delete next[role];
    setDraft(next);
  };

  const saved = form.mapping ?? {};
  const dirty = [...ALL_FIELDS.map(f => f.id), ...POP_KEYS]
    .some(id => (draft[id] ?? '') !== (saved[id] ?? ''));

  // ── What a blank Population cell means ────────────────────────────────────
  // Only asked when a Population column is mapped and some of its rows are
  // blank (or NR/NA). Unmapped population = the whole trial ("Overall"), which
  // needs no question. A mapped-but-blank cell is missing data: it is asked,
  // never silently called "Overall" (utils/rob_mapping.population_of).
  const popCol = draft.population ?? '';
  const popStat = popCol ? stats[popCol] : undefined;
  const popBlank = popStat ? Math.max(0, popStat.rows - popStat.usable) : 0;
  const popValues = popCol ? samplesOf(popCol).filter(v => !ABSENT_POP.test(v)) : [];
  const popOnly = popStat?.distinct === 1 && popValues.length === 1 ? popValues[0] : '';
  const popRule = draft.population_blank ?? '';
  const popAnswered = popRule === 'overall' || popRule === 'not_reported'
    || (popRule === 'same' && !!(draft.population_blank_value ?? '').trim());
  const needsPopAnswer = !!popCol && popBlank > 0 && !popAnswered;
  const setPopRule = (rule: string) => {
    const next: Record<string, string> = { ...draft, population_blank: rule };
    if (rule === 'same') next.population_blank_value = popOnly; else delete next.population_blank_value;
    setDraft(next);
  };
  const missing = MAIN_FIELDS.filter(f => f.required && !(draft[f.id] ?? '').trim());
  const gone = ALL_FIELDS.filter(f => (draft[f.id] ?? '') && !columns.includes(draft[f.id]));
  const serverProblems = dirty ? [] : (form.warnings ?? [])
    .filter(w => w.severity === 'blocking').map(w => w.message);
  const blocked = missing.length + gone.length + serverProblems.length > 0 || needsPopAnswer;
  const confirmed = form.confirmed && !dirty && !blocked;
  const hasAny = ALL_FIELDS.some(f => (draft[f.id] ?? '').trim());

  // One list of what stops this form being confirmed: a required role with no
  // column, a role mapped to a column the form no longer has, and the server's
  // blocking warnings. Shown as the prototype's "{n} things to fix" box.
  const problems = [
    ...mappingProblems(ALL_FIELDS, draft, columns).map(p => p.message),
    ...serverProblems,
    ...(needsPopAnswer ? [`Population: ${popBlank} of ${popStat?.rows ?? 0} rows have no population. Say what a blank means.`] : []),
  ];
  const goneLines = [
    ...gone.map(f => `${draft[f.id]} is mapped as ${f.label.toLowerCase()}, but this form no longer has that column. Choose another; it is not swapped automatically.`),
    ...serverProblems,
  ];

  // ── Status ────────────────────────────────────────────────────────────────
  const status = blocked ? 'Not ready'
    : confirmed ? 'Confirmed'
      : form.stored && !dirty ? 'Saved, not confirmed'
        : hasAny ? 'Not confirmed' : 'Not mapped yet';
  const statusCls = blocked
    ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
    : confirmed
      ? 'border-[#e5e7eb] bg-transparent text-[#4b5563] dark:border-[#2a2a2a] dark:text-zinc-400'
      : 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300';

  // ── Preview, from one real row ────────────────────────────────────────────
  const row = form.sample_row && Object.keys(form.sample_row).length ? form.sample_row : null;
  const val = (fieldId: string): string => {
    const column = draft[fieldId] ?? '';
    if (!column || !columns.includes(column)) return '';
    if (row) return String(row[column] ?? '').trim();
    return samplesOf(column)[0] ?? '';
  };
  const armVal = val('arm') || val('arm_fallback');
  const otherArm = (() => {
    const col = draft.arm ?? '';
    if (!col || !armVal) return '';
    return samplesOf(col).find(v => v.toLowerCase() !== armVal.toLowerCase()) ?? '';
  })();
  const estimate = (() => {
    if (!row) return '';
    const cell = (re: RegExp) => {
      const key = Object.keys(row).find(k => re.test(k) && !Object.values(draft).includes(k));
      return key ? String(row[key] ?? '').trim() : '';
    };
    const mean = cell(/^mean/i); const sd = cell(/^sd$/i); const n = cell(/^n$/i);
    if (mean) return `mean ${mean}${sd ? ` (SD ${sd})` : ''}${n ? `, n=${n}` : ''}`;
    const events = cell(/^events?$/i); const total = cell(/^total$/i);
    if (events) return `${events}/${total} events`;
    return cell(/^(result_text|estimate|effect)/i);
  })();
  const pv = (k: string, v: string, dflt?: string) => ({ k, v: v || dflt || 'not recorded', empty: !v });
  const preview = [
    pv('Contrast', armVal ? `${armVal} → ${otherArm || 'other arm'}` : '', 'not resolved'),
    pv('Population', val('population') || (!popCol ? 'Overall (no population column)'
      : popRule === 'same' ? (draft.population_blank_value ?? '')
        : popRule === 'overall' ? 'Overall' : popRule === 'not_reported' ? 'Not reported' : ''),
      'not answered · see the population question'),
    pv('Outcome', [val('outcome_domain') || val('outcome_fallback'), val('outcome_qualifier')].filter(Boolean).join(' — ')),
    pv('Measurement', val('measurement')),
    pv('Timepoint', val('timepoint')),
    pv('Analysis population', val('analysis_population')),
    pv('Analysis', val('analysis')),
    pv('Effect estimate', estimate),
  ].filter(p => !outcomeScope || ['Outcome', 'Measurement', 'Population'].includes(p.k));

  // ── What this mapping will produce ────────────────────────────────────────
  const firstRows = columns.length ? statOf(columns[0]).rows : 0;
  const arms = draft.arm && columns.includes(draft.arm) ? Math.max(1, statOf(draft.arm).distinct) : 1;
  const outcomes = draft.outcome_domain && columns.includes(draft.outcome_domain) ? statOf(draft.outcome_domain).distinct : 0;
  const produced = Math.max(0, Math.round(firstRows / Math.max(1, arms)));
  const exampleOutcome = (draft.outcome_domain && samplesOf(draft.outcome_domain)[0]) || 'Pain';
  const exampleTimes = draft.timepoint && columns.includes(draft.timepoint) ? samplesOf(draft.timepoint).slice(0, 3) : [];
  const timepointUnmapped = !draft.timepoint && columns.includes('timepoint');

  const rolesBlocked = missing.length + gone.length + serverProblems.length > 0;
  const impactTitle = rolesBlocked ? (outcomeScope ? 'No assessments until required roles are mapped' : 'No results until required roles are mapped')
    : outcomeScope
      ? `${outcomes} outcome-level assessment${outcomes === 1 ? '' : 's'}`
      : `About ${produced} results from ${firstRows} rows (${arms} arm${arms === 1 ? '' : 's'} per result)`;
  const impactNote = rolesBlocked ? 'Outcome and Arm are needed to name a result and build its comparison.'
    : needsPopAnswer ? 'Answer the population question on the left first: it decides which result the rows with no population belong to.'
    : outcomeScope
      ? `Protocol scope is Outcome, so the reviewer answers one set of questions per outcome. Example: “${exampleOutcome}” is one assessment.`
      : timepointUnmapped ? 'Timepoint is not mapped: results measured at different times will collapse into one result each.'
        : !draft.analysis_population ? 'Analysis population not mapped: questions 2.6/2.7 will have no ITT / per-protocol context.'
          : `Protocol scope is Result, so each outcome × time point × analysis is its own assessment. Example: “${exampleOutcome}” becomes ${exampleTimes.length || 1} assessment${exampleTimes.length === 1 ? '' : 's'}${exampleTimes.length ? ` (${exampleTimes.join(', ')})` : ''}.`;
  const impactCls = rolesBlocked ? 'text-[#b91c1c] dark:text-red-400'
    : needsPopAnswer ? 'text-[#475569] dark:text-slate-400'
    : !outcomeScope && (timepointUnmapped || !draft.analysis_population) ? 'text-[#475569] dark:text-slate-400'
      : 'text-[#6b7280] dark:text-zinc-400';

  // ── Footer ────────────────────────────────────────────────────────────────
  const footLine = !editable ? 'Read-only. Only a project owner or manager can confirm column mappings.'
    : blocked
      ? goneLines[0] || (missing.length ? `${missing.map(f => f.label).join(' and ')} still need${missing.length === 1 ? 's' : ''} a column.` : 'Say what a blank population means, then confirm.')
      : confirmed ? 'Confirmed. Edit any role to re-open.'
        : 'Check the preview on the right, then confirm. Applies to this form only.';
  const canConfirm = editable && !blocked && !confirmed && !src.savingMapping;
  const confirmLabel = confirmed ? 'Confirmed' : nextForm ? `Confirm & next: ${nextForm.form_name}` : 'Confirm this form';

  const confirm = async () => {
    if (!canConfirm) return;
    const ok = await src.saveMapping(form.form_id, draft);
    if (!ok) return;
    setDrafts(d => { const next = { ...d }; delete next[form.form_id]; return next; });
    if (nextForm) go({ form: nextForm.form_id }, { replace: true });
    else back();
  };

  return (
    <div className="flex max-w-[1120px] flex-col gap-4">
      {backLink}

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <span className={EYEBROW}>Column mapping · form {index + 1} of {forms.length}</span>
          <div className="flex items-center gap-[10px]">
            <h2 className="m-0 text-[20px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">{form.form_name}</h2>
            <span className={cn('rounded-full border px-2 text-[11px] font-medium leading-[20px]', statusCls)}>{status}</span>
          </div>
          <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
            Say which RoB role each column feeds. Judge by the values, not the name. This form only.
          </span>
        </div>
        {nextForm && (
          <button type="button" onClick={() => go({ form: nextForm.form_id }, { replace: true })}
            className="flex h-[34px] items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
            Next: {nextForm.form_name}<ChevronRight className="h-[14px] w-[14px]" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-3">
          {problems.length > 0 && hasAny && (
            <div className="flex flex-col gap-1 rounded-[10px] border border-[#cbd5e1] bg-[#f8fafc] px-[14px] py-[10px] dark:border-slate-700 dark:bg-slate-800/20">
              <span className="text-[12px] font-semibold text-[#334155] dark:text-slate-200">
                {problems.length === 1 ? '1 thing to fix' : `${problems.length} things to fix`}
              </span>
              {problems.map(line => (
                <span key={line} className="text-[12px] leading-[17px] text-[#475569] dark:text-slate-300">{line}</span>
              ))}
            </div>
          )}
          <div className={CARD}>
            <div className={cn(ROLE_GRID, 'border-b border-[#e5e7eb] bg-[#f9fafb] px-5 py-[10px] text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-500')}>
              <span>Role</span><span>Column in form</span><span>What it holds</span>
            </div>
            {ROW_FIELDS.map(f => {
              const column = draft[f.id] ?? '';
              const values = column ? samplesOf(column) : [];
              const st = column ? statOf(column) : null;
              const shown = values.slice(0, 3);
              const options = columns.filter(c => c === column || !isValueCol(c));
              return (
                <div key={f.id}
                  className={cn(ROLE_GRID, 'border-b border-[#f3f4f6] px-5 py-[11px] last:border-b-0 dark:border-[#1a1a1a]',
                    column ? 'bg-white dark:bg-[#111111]' : 'bg-[#fafafa] dark:bg-[#0d0d0d]')}>
                  <span className="text-[13px] font-semibold text-[#111827] dark:text-zinc-100">
                    {f.label}{f.required && <span className="font-normal text-[#9ca3af] dark:text-zinc-500"> (required)</span>}
                  </span>
                  <select value={column} disabled={!editable} onChange={e => pickRole(f.id, e.target.value)}
                    className={cn('min-w-0 rounded-[8px] border bg-white px-[10px] py-[6px] font-mono text-[12px] outline-none disabled:cursor-not-allowed dark:bg-[#0d0d0d]',
                      column ? 'border-[#0a0a0a] font-semibold text-[#111827] dark:border-zinc-300 dark:text-zinc-100'
                        : f.required ? 'border-[#fca5a5] font-normal text-[#9ca3af] dark:border-red-900 dark:text-zinc-500'
                          : 'border-[#e5e7eb] font-normal text-[#9ca3af] dark:border-[#2a2a2a] dark:text-zinc-500')}>
                    <option value="">{f.required ? '— choose a column —' : '— not used —'}</option>
                    {options.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    {column ? (
                      <>
                        <span className="truncate text-[12px] text-[#374151] dark:text-zinc-300">
                          {shown.join(' · ')}{st && st.distinct > shown.length ? ' …' : ''}
                        </span>
                        <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{st?.distinct ?? 0} distinct across {st?.rows ?? 0} rows</span>
                      </>
                    ) : (
                      <span className="text-[12px] italic text-[#9ca3af] dark:text-zinc-500">
                        {f.required ? 'Needs a column' : 'Not recorded in this form'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>


          {popCol && popBlank > 0 && (
            <div className={cn('flex flex-col gap-2 rounded-[12px] border px-4 py-3',
              needsPopAnswer ? 'border-[#cbd5e1] bg-[#f8fafc] dark:border-slate-700 dark:bg-slate-800/30'
                : 'border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]')}>
              <div className="text-[13px] font-semibold text-[#111827] dark:text-zinc-100">
                Population · <span className="font-mono text-[12px]">{popCol}</span>
              </div>
              <div className="text-[12px] leading-[17px] text-[#475569] dark:text-slate-300">
                {popBlank} of {popStat?.rows ?? 0} rows have no population. A blank is missing data, so say what it
                means here. It decides which result those rows belong to.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {popOnly && (
                  <Pill on={popRule === 'same'} disabled={!editable} onClick={() => setPopRule('same')} className="text-[12px]">
                    Same as the other rows: {popOnly}
                  </Pill>
                )}
                <Pill on={popRule === 'overall'} disabled={!editable} onClick={() => setPopRule('overall')} className="text-[12px]">
                  Whole trial (Overall)
                </Pill>
                <Pill on={popRule === 'not_reported'} disabled={!editable} onClick={() => setPopRule('not_reported')} className="text-[12px]">
                  Not reported (kept separate)
                </Pill>
              </div>
            </div>
          )}

          <div className="px-1 text-[11px] leading-4 text-[#9ca3af] dark:text-zinc-500">
            Pick the form column that feeds each role. Outcome and Arm are required. Map Timepoint, Measurement or
            Analysis population when two rows that differ only in it should be two separate assessments; Analysis
            population (ITT / per-protocol) drives questions 2.6 and 2.7.
          </div>
        </div>

        <div className="sticky top-4 flex flex-col gap-3">
          <div className={CARD}>
            <div className="flex flex-col gap-[2px] border-b border-[#f3f4f6] px-4 py-3 dark:border-[#1a1a1a]">
              <span className={EYEBROW}>Roles</span>
              <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">Protocol scope: {outcomeScope ? 'Outcome' : 'Result'}</span>
            </div>
            <div className="flex flex-col gap-[6px] px-4 pb-3 pt-2">
              {ROW_FIELDS.map(f => {
                const col = draft[f.id] ?? '';
                const isGone = !!col && !columns.includes(col);
                const cls = isGone ? 'text-[#b91c1c] dark:text-red-400'
                  : col ? 'text-[#111827] dark:text-zinc-100'
                    : f.required ? 'text-[#475569] dark:text-slate-400' : 'text-[#9ca3af] dark:text-zinc-500';
                return (
                  <div key={f.id} className="flex items-center justify-between gap-[10px] text-[12px]">
                    <span className="text-[#374151] dark:text-zinc-300">
                      {f.label}<span className="text-[#9ca3af] dark:text-zinc-500"> {f.required ? '· required' : ''}</span>
                    </span>
                    <span className={cn('font-mono text-[11px]', cls)}>
                      {isGone ? `${col} (missing)` : col || (f.required ? 'choose a column'
                        : 'not used')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={CARD}>
            <div className="flex flex-col gap-[2px] border-b border-[#f3f4f6] px-4 py-3 dark:border-[#1a1a1a]">
              <span className={EYEBROW}>{outcomeScope ? 'One outcome, as a reviewer will see it' : 'One result, as a reviewer will see it'}</span>
              <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">
                {row ? 'Live · from one real row of this form' : 'Live · no extracted rows yet, first value of each column'}
              </span>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-[6px] px-4 pb-3 pt-[10px] text-[12px]">
              {preview.map(p => (
                <div key={p.k} className="contents">
                  <span className="text-[#9ca3af] dark:text-zinc-500">{p.k}</span>
                  <span className={cn('min-w-0 break-words font-medium',
                    p.empty ? 'italic text-[#9ca3af] dark:text-zinc-500' : 'not-italic text-[#111827] dark:text-zinc-100')}>{p.v}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-t border-[#f3f4f6] px-4 py-[10px] dark:border-[#1a1a1a]">
              <span className="text-[12px] font-semibold text-[#111827] dark:text-zinc-100">{impactTitle}</span>
              <span className={cn('text-[11px] leading-4', impactCls)}>{impactNote}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-3 flex items-center gap-3 rounded-[12px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,.04)] dark:border-[#1f1f1f] dark:bg-[#111111]">
        <span className={cn('flex-1 text-[12px]', blocked && editable ? 'text-[#b91c1c] dark:text-red-400' : 'text-[#6b7280] dark:text-zinc-400')}>{footLine}</span>
        {editable && (
          <>
            <button type="button" onClick={() => setDraft({})}
              className="h-9 rounded-[7px] border border-[#e5e7eb] bg-white px-[14px] text-[13px] font-semibold text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
              Reset
            </button>
            <button type="button" onClick={confirm} disabled={!canConfirm}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-[7px] border-none px-4 text-[13px] font-semibold text-white',
                canConfirm ? 'cursor-pointer bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900' : 'cursor-not-allowed bg-[#d4d4d8] dark:bg-zinc-700 dark:text-zinc-400')}>
              {src.savingMapping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
