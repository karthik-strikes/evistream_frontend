'use client';

/**
 * Say what each column of an outcome form means.
 *
 * **A fixed layout, and mappings that were written down.** Both used to be
 * decided by matching column NAMES with regexes: which roles appeared, in what
 * order, and which column filled each one. That is gone. The four fields below
 * are always the same four, in the same order, and the columns they start with
 * come from the form's stored mapping or from the entry for that exact table
 * shape in `rob_mapping.KNOWN_TABLE_SHAPES`. A table nobody has mapped arrives
 * empty and is asked about — never filled in with a plausible guess.
 *
 * What that guessing cost, on live data: the Periodontitis outcomes table has
 * no arm column at all, so matching "arm" as a substring made the arm of every
 * result a MEAN (`mean_arm1`). The Dental Implants tables put a Yes/No flag
 * called `outcome_reported` before `outcome_name`, so first-match named every
 * result "Yes". Neither was visible on this screen.
 *
 * **Claims about a column come from `column_stats`, never from `samples`.**
 * `samples` stops at 12 values from 200 rows — right for showing a person what
 * a column holds, useless for saying how many rows hold it.
 *
 * **A mapped column that the form no longer has is shown, not replaced.** A
 * regenerated form can drop or rename a column while the confirmed mapping
 * still names the old one. Substituting the nearest match would re-point live
 * results with nothing on screen to say so.
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';

import type { RobFormMapping } from '@/services/rob.service';

import { mappingProblems } from '../_lib/mappingProblems';

interface Field {
  id: string;
  label: string;
  /** One line. If it needs two, the field is doing two jobs. */
  help: string;
  required?: boolean;
}

/** Always shown, always in this order. */
const MAIN_FIELDS: Field[] = [
  { id: 'outcome_domain', label: 'Outcome', required: true,
    help: 'What was measured — pain relief, nausea. Not the category it belongs to.' },
  { id: 'timepoint', label: 'Timepoint',
    help: 'When it was measured. Kept exactly as written.' },
  { id: 'measurement', label: 'Measurement',
    help: 'How it was measured. Two results can share an outcome and differ only here.' },
  { id: 'arm', label: 'Arm', required: true,
    help: 'The intervention this row is about. Comparisons are built from these.' },
];

/** Collapsed. Rarely set, and none of them changes what the four above mean. */
const EXTRA_FIELDS: Field[] = [
  { id: 'population', label: 'Population',
    help: 'Which participants. Unset, every result is recorded as the overall population.' },
  { id: 'outcome_fallback', label: 'Outcome fallback',
    help: 'Read instead of the outcome column on rows where that column says “Other”.' },
  { id: 'outcome_qualifier', label: 'Outcome qualifier',
    help: 'Appended to the outcome — which adverse effect, which subscale.' },
  { id: 'arm_fallback', label: 'Arm fallback',
    help: 'Read instead of the arm column on rows where that column says “Other”.' },
  { id: 'analysis_population', label: 'Analysis population',
    help: 'Intention-to-treat, per-protocol, complete case. Questions 2.6 and 2.7 turn on it.' },
  { id: 'analysis', label: 'Analysis',
    help: 'Which analysis produced the estimate — adjusted or unadjusted, or the model.' },
];

const ALL_FIELDS = [...MAIN_FIELDS, ...EXTRA_FIELDS];

interface Props {
  forms: RobFormMapping[];
  activeFormId: string;
  onSelectForm: (formId: string) => void;
  onSave: (formId: string, mapping: Record<string, string>) => void | Promise<void>;
  onBack: () => void;
  saving: boolean;
}

const CARD =
  'border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]';
const SELECT =
  'h-8 w-full text-[12px] font-mono border border-gray-200 dark:border-[#2a2a2a] rounded-lg '
  + 'px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none';
const SELECT_BAD =
  'h-8 w-full text-[12px] font-mono border border-red-300 dark:border-red-900 rounded-lg '
  + 'px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none';

export function ColumnMapper({ forms, activeFormId, onSelectForm, onSave, onBack, saving }: Props) {
  const form = forms.find(f => f.form_id === activeFormId) ?? forms[0] ?? null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showExtra, setShowExtra] = useState(false);

  useEffect(() => {
    setDraft({ ...(form?.mapping ?? {}) });
    setShowExtra(false);
  }, [form?.form_id, form?.mapping]);

  const columns = useMemo(() => form?.columns ?? [], [form?.columns]);
  const stats = form?.column_stats ?? {};

  /**
   * Up to three values the column actually holds, deduplicated the way the
   * count is. `column_stats` counts distinct case-insensitively while `samples`
   * keeps every spelling, so listing "Placebo" and "placebo" beside "6
   * distinct" reads as an arithmetic error rather than as two spellings.
   */
  const examplesFor = (column: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of (form?.samples?.[column] ?? [])) {
      const key = String(value).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(String(value));
      if (out.length === 3) break;
    }
    return out;
  };

  if (!form) {
    return (
      <div className={`${CARD} px-4 py-8 text-[13px] text-gray-500 dark:text-zinc-500`}>
        No outcome form to map in this project.
      </div>
    );
  }

  const dirty = ALL_FIELDS.some(f => (draft[f.id] ?? '') !== (form.mapping[f.id] ?? ''));
  const missingRequired = MAIN_FIELDS.filter(f => f.required && !(draft[f.id] ?? '').trim());
  /** Mapped columns this form no longer has. Named, never swapped for another. */
  const goneColumns = ALL_FIELDS
    .map(f => ({ field: f, column: (draft[f.id] ?? '').trim() }))
    .filter(x => x.column && !columns.includes(x.column));

  const activeExtras = EXTRA_FIELDS.filter(f => (draft[f.id] ?? '').trim());
  const blocked = missingRequired.length > 0 || goneColumns.length > 0;

  /**
   * What identity this mapping would produce, from ONE real extraction row.
   *
   * Values per column cannot answer this: the first value of `outcome` and the
   * first of `timepoint` need not come from the same extraction, so a preview
   * built from them can show an identity no row actually has. When the form has
   * no rows yet there is nothing else to show, and it is labelled as made up.
   */
  const exampleRow = form.sample_row && Object.keys(form.sample_row).length
    ? form.sample_row : null;
  const valueOf = (fieldId: string): string => {
    const column = draft[fieldId] ?? '';
    if (!column) return '';
    if (exampleRow) return exampleRow[column] ?? '';
    return (form.samples[column] ?? [])[0] ?? '';
  };
  const previewOutcome = valueOf('outcome_domain') || valueOf('outcome_fallback');
  const previewParts: Array<[string, string]> = [
    ['Outcome', [previewOutcome, valueOf('outcome_qualifier')].filter(Boolean).join(' — ')],
    ['Timepoint', valueOf('timepoint')],
    ['Measurement', valueOf('measurement') || form.measurement_standin || ''],
    ['Arm', valueOf('arm') || valueOf('arm_fallback')],
    ['Population', valueOf('population') || 'Overall'],
    ['Analysis population', valueOf('analysis_population')],
    ['Analysis', valueOf('analysis')],
  ];

  /**
   * Problems with the mapping on screen right now.
   *
   * The two structural ones are computed here because they are about the draft
   * and must stay true as it is edited. Everything that needs a pass over the
   * rows stays on the server and is shown only while the draft still matches
   * what the server judged — a count of affected rows for a mapping the user
   * has since changed is worse than no count.
   */
  const problems: string[] = mappingProblems(ALL_FIELDS, draft, columns).map(p => p.message);
  if (!dirty) {
    for (const w of form.warnings ?? []) {
      if (w.severity === 'needs_review') problems.push(w.message);
    }
  }

  const status = blocked ? 'Not ready'
    : dirty ? 'Changes need confirmation'
      : form.confirmed ? 'Confirmed'
        : form.stored ? 'Saved, not confirmed'
          : form.known_shape ? 'Proposed' : 'Not mapped yet';

  /** One field: label, help, selector, and what the chosen column holds. */
  const FieldRow = ({ field }: { field: Field }) => {
    const column = draft[field.id] ?? '';
    const gone = !!column && !columns.includes(column);
    const stat = column && !gone ? stats[column] : undefined;
    const examples = gone ? [] : examplesFor(column);

    return (
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 items-start border-t border-gray-100 dark:border-[#1a1a1a] py-3 first:border-t-0">
        <div className="min-w-0">
          <label
            htmlFor={`map-${field.id}`}
            className="text-[12.5px] font-semibold dark:text-white block"
          >
            {field.label}
            {field.required && <span className="text-gray-400 dark:text-zinc-600"> · required</span>}
          </label>
          <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
            {field.help}
          </p>
        </div>

        <div className="min-w-0">
          <select
            id={`map-${field.id}`}
            value={gone ? '' : column}
            onChange={e => setDraft(d => ({ ...d, [field.id]: e.target.value }))}
            className={gone ? SELECT_BAD : SELECT}
          >
            <option value="">
              {field.required ? '— choose a column —' : 'Not recorded in this form'}
            </option>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="text-[11.5px] leading-relaxed mt-1.5">
            {gone ? (
              <span className="text-red-700 dark:text-red-400">
                Was mapped to <span className="font-mono">{column}</span>, which this form no
                longer has.
              </span>
            ) : !column ? (
              <span className="text-gray-400 dark:text-zinc-600">
                {field.required ? 'Nothing mapped yet.' : 'Nothing mapped.'}
              </span>
            ) : (
              <span className="text-gray-500 dark:text-zinc-500">
                {stat
                  ? <>{stat.distinct} distinct across {stat.rows} rows: </>
                  : <>Values: </>}
                <span className="text-gray-700 dark:text-zinc-300">{examples.join(' · ')}</span>
                {stat && stat.distinct > examples.length && <> …</>}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={`${CARD} px-4 py-4`}>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
              Setup / form mapping
            </div>
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white mt-0.5">
              {form.form_name}
            </h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed max-w-[70ch]">
              Check each column against the values beside it, not against its name. This
              confirmation applies to <strong>this form only</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-none text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            Back to setup
          </button>
        </div>

        {forms.length > 1 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {forms.map(f => (
              <button
                key={f.form_id}
                type="button"
                onClick={() => onSelectForm(f.form_id)}
                className={[
                  'text-[12px] font-semibold rounded-full border px-3 py-1',
                  f.form_id === form.form_id
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
                ].join(' ')}
              >
                {f.form_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Only actual problems with the mapping on screen. */}
      {problems.length > 0 && (
        <div
          role="alert"
          className="border border-gray-200 dark:border-[#2a2a2a] rounded-xl bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3"
        >
          <div className="text-[12.5px] font-semibold dark:text-white">
            {problems.length === 1 ? '1 thing to fix' : `${problems.length} things to fix`}
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {problems.map(p => (
              <li key={p} className="text-[11.5px] text-gray-700 dark:text-zinc-300 leading-relaxed">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A table nobody has mapped says so, rather than presenting an empty
          form as though it were a proposal. */}
      {!form.known_shape && !form.stored && (
        <div className={`${CARD} px-4 py-3`}>
          <p className="text-[12px] text-gray-600 dark:text-zinc-400 leading-relaxed">
            This form&rsquo;s table is not one of the shapes with a mapping on file, so nothing has
            been filled in. Choose the columns below.
          </p>
        </div>
      )}

      <div className={`${CARD} px-4 py-3`}>
        {MAIN_FIELDS.map(field => <FieldRow key={field.id} field={field} />)}
      </div>

      <div className={`${CARD} px-4 py-3`}>
        <button
          type="button"
          onClick={() => setShowExtra(v => !v)}
          aria-expanded={showExtra}
          className="w-full flex items-center gap-2 text-left"
        >
          <span className="text-[13px] font-semibold dark:text-white">Additional mappings</span>
          <span className="flex-1" />
          <span className="text-[11.5px] text-gray-500 dark:text-zinc-500">
            {showExtra ? 'Hide' : 'Show'}
          </span>
        </button>
        <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed">
          {activeExtras.length === 0
            ? 'None set. Six optional roles — population, fallbacks, qualifier, analysis.'
            : (
              <>
                {activeExtras.length} set:{' '}
                {activeExtras.map(f => (
                  <span key={f.id}>
                    {f.label.toLowerCase()} → <span className="font-mono text-gray-700 dark:text-zinc-300">{draft[f.id]}</span>
                    {f === activeExtras[activeExtras.length - 1] ? '' : ', '}
                  </span>
                ))}
              </>
            )}
        </p>
        {showExtra && (
          <div className="mt-2 border-t border-gray-100 dark:border-[#1a1a1a]">
            {EXTRA_FIELDS.map(field => <FieldRow key={field.id} field={field} />)}
          </div>
        )}
      </div>

      <div className={`${CARD} px-4 py-3`}>
        <div className="text-[12.5px] font-semibold dark:text-white">Result identity preview</div>
        <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
          {exampleRow
            ? 'From one real extraction row of this form, shown in full below.'
            : 'An illustration — this form has no extracted rows yet, so each value is the first '
              + 'recorded value of its column and no single row looks like this.'}
        </p>
        <div className="grid gap-x-4 gap-y-1.5 mt-2.5 [grid-template-columns:minmax(0,1fr)] sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
          {previewParts.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2 min-w-0">
              <span className="flex-none text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600 w-[8.5rem]">
                {label}
              </span>
              <span className={`text-[12.5px] min-w-0 break-words ${value
                ? 'dark:text-zinc-200' : 'text-gray-400 dark:text-zinc-600 italic'}`}>
                {value || 'not recorded'}
              </span>
            </div>
          ))}
        </div>

        {exampleRow && (
          <details className="mt-2.5 border-t border-gray-100 dark:border-[#1a1a1a] pt-2.5">
            <summary className="text-[11.5px] font-semibold text-gray-600 dark:text-zinc-400 cursor-pointer select-none">
              The row it came from
            </summary>
            <p className="font-mono text-[10.5px] text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed break-words">
              {Object.entries(exampleRow).map(([k, v]) => `${k} = ${v}`).join('  ·  ')}
            </p>
          </details>
        )}

        <div className="flex items-center gap-2.5 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] pt-3 mt-3">
          <span className={`text-[11px] font-mono ${blocked
            ? 'text-red-700 dark:text-red-400' : 'text-gray-500 dark:text-zinc-500'}`}>
            {status}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setDraft({ ...form.mapping })}
            disabled={!dirty}
            className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={async () => { await onSave(form.form_id, draft); onBack(); }}
            // Confirmed and unchanged is the only state with nothing to do. A
            // mapping that was saved but never confirmed still needs a person.
            disabled={saving || blocked || (form.confirmed && !dirty)}
            className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Confirm this form'}
          </button>
        </div>
      </div>
    </div>
  );
}
