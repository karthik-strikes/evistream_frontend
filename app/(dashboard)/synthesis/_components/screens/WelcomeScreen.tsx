'use client';

/**
 * First visit — the five protocol sections a synthesis depends on, each with
 * its live state and its own way forward. Shown until the protocol is
 * confirmed; pooling against an unset protocol would stamp every run with
 * choices nobody made.
 */

import { useSynthesisNav } from '../../_lib/nav';
import { sourceFormReady } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import { OutlineButton, PrimaryButton, ScreenHeader } from '../ui';

export function WelcomeScreen() {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const p = syn.protocol;
  const sources = p.source_forms ?? [];
  const confirmedSources = sources.filter(sourceFormReady);
  const kinds = [...new Set(sources.map(s => s.kind))];
  const defaultsSet = kinds.length > 0 && kinds.every(k => (p.defaults ?? []).some(d => d.kind === k));
  const rolesSet = !!p.roles?.finalizer && (p.roles.second_approval !== 'required' || !!p.roles.approver);

  let docsWithData = 0;
  let rows = 0;
  const seen = new Set<string>();
  for (const sf of sources) {
    const fd = syn.formData(sf.form_id);
    if (!fd) continue;
    rows += fd.rows.length;
    for (const r of fd.chosen) if (!seen.has(r.document_id)) { seen.add(r.document_id); docsWithData++; }
  }

  const toProtocol = () => go({ screen: 'protocol' });
  const steps = [
    {
      title: 'Extracted results · shared',
      desc: `The rows extracted on this project's forms — the same values Results and Consensus show. ${syn.forms.length} active form${syn.forms.length === 1 ? '' : 's'}.`,
      done: syn.forms.length > 0,
      state: syn.forms.length > 0 ? 'Shared' : 'No active forms',
      action: { label: 'Open', go: toProtocol },
    },
    {
      title: 'Source forms and column mapping',
      desc: sources.length
        ? `${sources.length} source form${sources.length === 1 ? '' : 's'}; ${confirmedSources.length} with a confirmed column mapping.`
        : 'Choose which forms hold the outcome data, then confirm how their columns map to analysis roles.',
      done: sources.length > 0 && confirmedSources.length === sources.length,
      state: sources.length === 0 ? 'Not set' : confirmedSources.length === sources.length ? 'Confirmed' : `${sources.length - confirmedSources.length} to confirm`,
      action: { label: sources.length ? 'Open' : 'Choose', go: () => go({ screen: 'mapping', form: sources.find(s => !sourceFormReady(s))?.form_id ?? syn.forms[0]?.id ?? '' }) },
    },
    {
      title: 'Analysis defaults',
      desc: 'Per outcome type: the effect measure and one validated method preset (model · τ² estimator · CI method).',
      done: defaultsSet,
      state: defaultsSet ? 'Set' : 'Not set',
      action: { label: 'Set', go: toProtocol },
    },
    {
      title: 'Planned analyses',
      desc: 'The primary, subgroup and sensitivity analyses written down before any result is seen.',
      done: (p.planned_analyses ?? []).length > 0,
      state: (p.planned_analyses ?? []).length ? `${p.planned_analyses.length} planned` : 'Not set',
      action: { label: 'Add', go: toProtocol },
    },
    {
      title: 'Roles',
      desc: 'Who may finalize a synthesis version, and whether a second approval is required.',
      done: rolesSet,
      state: rolesSet ? 'Set' : 'Not set',
      action: { label: 'Assign', go: toProtocol },
    },
  ];

  return (
    <div className="mx-auto max-w-[720px] pb-16">
      <ScreenHeader active="protocol" />
      <h2 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">
        Set the synthesis protocol before pooling
      </h2>
      <p className="mt-2 text-[13.5px] leading-[21px] text-gray-600 dark:text-zinc-400">
        Every synthesis in this project inherits these decisions — where results come from, how columns
        map, which method is the default, what was planned in advance, and who signs off. Set them once;
        afterwards a change is an amendment with a reason.
      </p>

      <div className="mt-6 overflow-hidden rounded-[12px] border border-[#ececea] dark:border-[#1f1f1f]">
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-start gap-3.5 border-t border-[#ececea] px-4 py-4 first:border-t-0 dark:border-[#1f1f1f]">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${s.done ? 'bg-[#16a34a] text-white' : 'border border-[#e5e7eb] text-gray-500 dark:border-[#2a2a2a] dark:text-zinc-400'}`}>
              {s.done ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">{s.title}</div>
              <div className="mt-0.5 text-[12px] leading-[18px] text-gray-500 dark:text-zinc-400">{s.desc}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className={`text-[12px] ${s.done ? 'text-[#047857] dark:text-emerald-400' : 'text-gray-500 dark:text-zinc-400'}`}>{s.state}</span>
              <OutlineButton small onClick={s.action.go}>{s.action.label}</OutlineButton>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <PrimaryButton onClick={toProtocol}>Set up synthesis protocol ›</PrimaryButton>
      </div>

      <div className="mt-8 rounded-[10px] border border-dashed border-[#e5e7eb] px-4 py-3 text-[12.5px] text-gray-500 dark:border-[#2a2a2a] dark:text-zinc-400">
        {sources.length
          ? `${docsWithData} studies · ${rows} extracted rows on the source forms ready to synthesize`
          : `${syn.docs.length} documents in this project — choose source forms to see what is ready to synthesize`}
      </div>
    </div>
  );
}
