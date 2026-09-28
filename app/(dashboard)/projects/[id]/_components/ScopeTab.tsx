'use client';

import { useState } from 'react';
import type { Project } from '@/types/api';
import { ReviewScopeSection } from '@/components/project/sections/ReviewScopeSection';
import { btnOutline, SettingsCard } from './settingsUi';

const FIELDS: { key: 'populations' | 'interventions' | 'comparators' | 'outcomes' | 'timepoints'; label: string }[] = [
  { key: 'populations', label: 'Population' },
  { key: 'interventions', label: 'Intervention' },
  { key: 'comparators', label: 'Comparators' },
  { key: 'outcomes', label: 'Outcomes' },
  { key: 'timepoints', label: 'Timepoints' },
];

export function ScopeTab({ project, canEdit, onScopeChange }: {
  project: Project; canEdit: boolean; onScopeChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const scope = (project.review_scope ?? '').trim();
  const structured = project.review_scope_structured ?? null;
  const groups = FIELDS
    .map(f => ({ ...f, chips: (structured?.[f.key] ?? []).filter(Boolean) }))
    .filter(g => g.chips.length > 0);

  if (editing && canEdit) {
    // The existing editor (chips, suggestions, save) mounts unchanged.
    return (
      <div className="flex flex-col gap-3">
        <div>
          <button type="button" onClick={() => setEditing(false)}
            className="border-0 bg-transparent p-0 text-[12px] font-medium text-gray-500 hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">
            ← Back to scope summary
          </button>
        </div>
        <ReviewScopeSection
          projectId={project.id}
          reviewScope={project.review_scope}
          reviewScopeStructured={project.review_scope_structured}
          onScopeChange={onScopeChange}
          editable
        />
      </div>
    );
  }

  return (
    <SettingsCard id="s1" title="Review scope"
      sub="Describes the extraction context every form is read against. It is not an inclusion ledger."
      action={canEdit ? <button type="button" onClick={() => setEditing(true)} className={btnOutline}>Edit scope</button> : undefined}>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {scope ? (
          <p className="m-0 max-w-[720px] whitespace-pre-line text-[13px] leading-5 text-[#0a0a0a] [text-wrap:pretty] dark:text-zinc-100">{scope}</p>
        ) : (
          <p className="m-0 text-[13px] text-gray-500 dark:text-zinc-400">
            Review scope not set.{canEdit ? ' Use Edit scope to describe the population, interventions and outcomes this review extracts.' : ''}
          </p>
        )}
        {groups.length > 0 && (
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 gap-y-3">
            {groups.map(g => (
              <div key={g.key}>
                <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-gray-500 dark:text-zinc-500">{g.label}</dt>
                <dd className="m-0 mt-1 flex flex-wrap gap-1.5">
                  {g.chips.map(c => (
                    <span key={c} className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[12px] text-gray-700 dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-300">{c}</span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </SettingsCard>
  );
}
