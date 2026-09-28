'use client';

/**
 * Every synthesis in the project, each with its DERIVED status — the same
 * `computeWorkspace` the workspace header uses, so the two cannot disagree.
 */

import { Plus } from 'lucide-react';

import { CorpusBar } from '../CorpusBar';
import { useSynthesisNav } from '../../_lib/nav';
import { useAllWorkspaces } from '../../_lib/useWorkspace';
import { useSynthesis } from '../../_lib/useSynthesisData';
import { EmptyPanel, PrimaryButton, ScreenHeader, StatusBadge, day } from '../ui';

export function DashboardScreen() {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const states = useAllWorkspaces();

  // Provenance across the source forms, one contributing extraction per document.
  const byDoc = new Map<string, string>();
  for (const sf of syn.protocol.source_forms ?? []) {
    for (const r of syn.formData(sf.form_id)?.chosen ?? []) {
      const rank = { consensus: 3, manual: 2, ai: 1 }[r.extraction_type] ?? 0;
      const cur = byDoc.get(r.document_id);
      const curRank = cur ? ({ consensus: 3, manual: 2, ai: 1 } as Record<string, number>)[cur] ?? 0 : -1;
      if (rank > curRank) byDoc.set(r.document_id, r.extraction_type);
    }
  }
  const consensus = [...byDoc.values()].filter(t => t === 'consensus').length;
  const manual = [...byDoc.values()].filter(t => t === 'manual').length;
  const aiOnly = byDoc.size - consensus - manual;
  const total = Math.max(syn.docs.length, byDoc.size);

  return (
    <div className="mx-auto max-w-[1040px] pb-16">
      <ScreenHeader active="dashboard" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">
            Syntheses <span className="text-gray-400 dark:text-zinc-600">{syn.groups.length}</span>
          </h1>
          <div className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
            {syn.groups.length} in this project · protocol v{syn.protocol.version} confirmed by {syn.nameOf(syn.protocol.confirmed_by)} · {day(syn.protocol.confirmed_at)}
          </div>
        </div>
        {syn.canEdit && (
          <PrimaryButton onClick={() => go({ screen: 'new' })}><Plus className="h-4 w-4" />New synthesis</PrimaryButton>
        )}
      </div>

      {byDoc.size > 0 && (
        <CorpusBar consensus={consensus} manual={manual} aiOnly={aiOnly} missing={Math.max(0, total - byDoc.size)} total={total}
          href={`/consensus${syn.protocol.source_forms?.[0] ? `?form=${encodeURIComponent(syn.protocol.source_forms[0].form_id)}` : ''}`} />
      )}

      {states.length === 0 ? (
        <EmptyPanel title="No syntheses yet"
          action={syn.canEdit ? <PrimaryButton onClick={() => go({ screen: 'new' })}>New synthesis</PrimaryButton> : undefined}>
          A synthesis is one target — an outcome, a comparison and a time window — pooled or synthesized from the source forms.
        </EmptyPanel>
      ) : (
        <div className="border-t border-[#ececea] dark:border-[#1f1f1f]">
          {states.map(s => {
            const g = s.group;
            const form = s.sourceForm ? syn.formById.get(s.sourceForm.form_id)?.form_name : null;
            const lv = g.latest_version;
            const meta = s.status.key === 'needs_review' && lv
              ? `v${lv.n} finalized ${day(lv.at)} · dependencies changed since`
              : lv ? `v${lv.n} ${lv.status === 'awaiting' ? 'awaiting approval' : 'finalized'} ${day(lv.at)}`
                : s.runs.length || g.latest_run ? `${s.runs.length || g.latest_run?.n || 0} run${(s.runs.length || g.latest_run?.n) === 1 ? '' : 's'} · last ${day(s.latestRun?.at ?? g.latest_run?.at)}`
                  : !s.model.targetConfirmed ? 'Target unconfirmed'
                    : s.model.blocking.length ? `${s.model.blocking.length} open item${s.model.blocking.length === 1 ? '' : 's'}` : 'No runs yet';
            return (
              <button key={g.id} type="button" onClick={() => go({ screen: 'workspace', id: g.id, tab: null })}
                className="flex w-full flex-col gap-2 border-b border-[#ececea] px-2 py-4 text-left hover:bg-[#fafafa] sm:flex-row sm:items-center sm:gap-4 dark:border-[#1f1f1f] dark:hover:bg-[#141414]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-semibold text-[#0a0a0a] dark:text-white">{g.title}</div>
                  <div className="mt-0.5 truncate text-[13px] text-[#6b7280] dark:text-zinc-400">
                    {g.branch === 'swim' ? 'Structured synthesis' : 'Meta-analysis'}
                    {form ? ` · ${form}` : ''}
                    {s.model.targetConfirmed ? ` · ${s.model.dataset.length} of ${s.model.studies.length} studies in dataset` : ''}
                  </div>
                </div>
                <StatusBadge status={s.status} />
                <div className="shrink-0 text-[12.5px] text-gray-500 sm:w-[240px] sm:text-right dark:text-zinc-400">{meta}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
