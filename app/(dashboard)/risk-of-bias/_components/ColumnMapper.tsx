'use client';

/**
 * Say what each column of an outcome form means.
 *
 * The heuristic proposes; a person confirms. The reason it is confirmed rather
 * than trusted is on this screen: every role shows **real values from the
 * project's own extractions** beside the column it picked. On the live data that
 * is what reveals the mistakes — `outcome_type` holding "Adverse effects", a
 * category rather than an outcome; `intervention` holding "Other (specify
 * below)" with the real arm name in a sibling column; a column called
 * `adverse_effect` holding "Nausea", which reads as an effect size to anything
 * matching on names alone.
 *
 * A confirmed mapping is stored on the form, so it stops being re-guessed on
 * every page load.
 */

import { useEffect, useState } from 'react';

import type { RobFormMapping } from '@/services/rob.service';

/** The slots a result identity has, in the order a person reads them. */
const ROLES: Array<{ id: string; label: string; help: string; required?: boolean }> = [
  { id: 'outcome_domain', label: 'Outcome', required: true,
    help: 'What was measured — pain relief, nausea. Not the category it belongs to.' },
  { id: 'outcome_fallback', label: 'Outcome, when the column above is a placeholder',
    help: 'Where the real name goes when the outcome column says "Other (specify below)".' },
  { id: 'outcome_qualifier', label: 'Outcome qualifier',
    help: 'Appended to the outcome — which adverse effect, which subscale.' },
  { id: 'measurement', label: 'Measurement',
    help: 'How it was measured. Two results can share an outcome and differ only here.' },
  { id: 'population', label: 'Population',
    help: 'Which participants. Absent, every result is recorded as the overall population.' },
  { id: 'timepoint', label: 'Timepoint',
    help: 'Stored verbatim — "6 h" and "6 hours" stay different until somebody says otherwise.' },
  { id: 'analysis_population', label: 'Analysis population',
    help: 'Intention-to-treat, per-protocol, complete case. Questions 2.6 and 2.7 turn on it.' },
  { id: 'arm', label: 'Arm', required: true,
    help: 'The intervention this row is about. One row per arm is the normal shape.' },
  { id: 'arm_fallback', label: 'Arm, when the column above is a placeholder',
    help: 'Where the real arm name goes when the arm column says "Other".' },
  { id: 'effect', label: 'Effect estimate',
    help: 'Used to tell a proportion from a mean — never to split one outcome into two results.' },
];

interface Props {
  forms: RobFormMapping[];
  activeFormId: string;
  onSelectForm: (formId: string) => void;
  onSave: (formId: string, mapping: Record<string, string>) => void;
  onBack: () => void;
  saving: boolean;
}

export function ColumnMapper({ forms, activeFormId, onSelectForm, onSave, onBack, saving }: Props) {
  const form = forms.find(f => f.form_id === activeFormId) ?? forms[0] ?? null;
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraft({ ...(form?.mapping ?? {}) });
  }, [form?.form_id, form?.mapping]);

  if (!form) {
    return (
      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-8 text-[13px] text-gray-500 dark:text-zinc-500">
        No outcome form to map in this project.
      </div>
    );
  }

  const dirty = ROLES.some(r => (draft[r.id] ?? '') !== (form.mapping[r.id] ?? ''));

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">
              Map this form&rsquo;s columns
            </h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed max-w-[70ch]">
              Each role shows real values from this project&rsquo;s extractions. Confirm against the
              values, not the column names — a column called <code>adverse_effect</code> holding
              &ldquo;Nausea&rdquo; is an outcome, not an effect size.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-none text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ← Back to setup
          </button>
        </div>

        {forms.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {forms.map(f => (
              <button
                key={f.form_id}
                type="button"
                onClick={() => onSelectForm(f.form_id)}
                className={[
                  'text-[12px] font-semibold rounded-lg border px-2.5 py-1',
                  f.form_id === form.form_id
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
                ].join(' ')}
              >
                {f.form_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-2">
        {ROLES.map(role => {
          const column = draft[role.id] ?? '';
          const samples = column ? (form.samples[column] ?? []) : [];
          return (
            <div
              key={role.id}
              className="grid gap-3 items-start border-t border-gray-100 dark:border-[#1a1a1a] py-3 first:border-t-0 [grid-template-columns:minmax(0,1fr)] sm:[grid-template-columns:minmax(190px,230px)_minmax(180px,220px)_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold dark:text-white">
                  {role.label}
                  {role.required && <span className="text-red-500 ml-0.5">*</span>}
                </div>
                <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
                  {role.help}
                </div>
              </div>

              <select
                value={column}
                onChange={e => setDraft(d => ({ ...d, [role.id]: e.target.value }))}
                className="h-8 w-full text-[12px] font-mono border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
              >
                <option value="">— not in this form —</option>
                {form.columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <div className="min-w-0 text-[11.5px] leading-relaxed">
                <div className="text-gray-500 dark:text-zinc-500">
                  {column
                    ? samples.length
                      ? <>Values: <span className="text-gray-700 dark:text-zinc-300">{samples.slice(0, 6).join(' · ')}</span></>
                      : 'This column is empty in every extraction.'
                    : <span className="text-gray-400 dark:text-zinc-600">Nothing mapped.</span>}
                </div>
                {/* The warnings live HERE, beside the column each one is about,
                    rather than piled on the setup screen where nothing can be
                    done about them. */}
                {(form.warnings ?? [])
                  .filter(w => w.role === role.id)
                  .map(w => (
                    <div
                      key={w.message}
                      className={[
                        'mt-1.5',
                        w.severity === 'blocking'
                          ? 'text-red-700 dark:text-red-400'
                          : w.severity === 'needs_review'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-gray-500 dark:text-zinc-500',
                      ].join(' ')}
                    >
                      {w.message}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 flex-wrap border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-3">
        <span className="text-[11px] font-mono text-gray-500 dark:text-zinc-500">
          {form.stored
            ? dirty ? 'Changed — not saved yet' : 'Confirmed mapping'
            : 'Proposed — nobody has confirmed this yet'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setDraft({ ...form.mapping })}
          disabled={!dirty}
          className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
        >
          Reset to proposal
        </button>
        <button
          type="button"
          onClick={() => onSave(form.form_id, draft)}
          disabled={saving}
          className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save mapping'}
        </button>
      </div>
    </div>
  );
}
