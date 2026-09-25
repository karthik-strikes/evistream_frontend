'use client';

/**
 * Which extraction a study's rows come from — the line for OUTCOME scope.
 *
 * At result scope the choice sits on the Comparisons page, beside the rows.
 * At outcome scope that page is hidden (no result UI), but the study's
 * outcomes are still built from those rows, so the dashboard shows only the
 * source and the "Use:" choice — never rows, results or comparisons.
 * Same server rule as the builder (backend utils/rob_row_source). Managers only.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { robService } from '@/services';
import type { RobRowSourceOption } from '@/services/rob.service';

import { useRob } from '../_lib/useRobData';

export const shortDate = (at: string) => {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
};
export const optionLabel = (o: RobRowSourceOption) => [o.label, shortDate(o.at), `${o.row_count} row${o.row_count === 1 ? '' : 's'}`]
  .filter(Boolean).join(' · ');
/** "Consensus · 24 Sep (auto)" / "R1 · Reham Elkayal · 15 Sep (chosen)". */
export function sourceText(available: RobRowSourceOption[], chosen: string | null, choice: string): string {
  const o = available.find(x => x.key === chosen);
  if (!o) return 'nothing finished yet';
  return [o.label, shortDate(o.at)].filter(Boolean).join(' · ') + (choice === 'auto' ? ' (auto)' : ' (chosen)');
}

export function RowSourceLine({ studyId }: { studyId: string }) {
  const rob = useRob();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState('');
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ['rob-study-rows', studyId],
    enabled: !!studyId && rob.canManage,
    staleTime: 60_000,
    queryFn: async () => (await robService.studyRows(studyId)).forms.filter(f => f.mapping?.outcome_domain),
  });
  if (!rob.canManage || !q.data?.length) return null;

  const choose = async (formId: string, source: string) => {
    setSaving(formId);
    try {
      await rob.updateProtocol({ row_source: { document_id: studyId, form_id: formId, source } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-study-rows', studyId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', rob.projectId] }),
      ]);
      setChanged(prev => new Set(prev).add(formId));
    } catch (e) {
      toast({ title: 'Could not change the source', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSaving('');
    }
  };

  const many = q.data.length > 1;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {q.data.map(f => (
        <div key={f.form_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-600 dark:text-zinc-400">
          <span>
            Outcomes built from{many ? <> <span className="text-gray-400 dark:text-zinc-500">({f.form_name})</span></> : null}:{' '}
            <span className="font-medium text-gray-900 dark:text-zinc-100">{sourceText(f.available, f.chosen, f.choice)}</span>
          </span>
          {f.available.length > 0 && (
            <label className="flex items-center gap-1.5">
              <span className="text-gray-400 dark:text-zinc-500">— Use:</span>
              <select value={f.choice === 'auto' ? 'auto' : f.choice} disabled={saving === f.form_id}
                onChange={e => choose(f.form_id, e.target.value)}
                className="rounded-[6px] border border-[#e5e7eb] bg-white px-2 py-[2px] text-[12px] text-[#111827] outline-none disabled:cursor-not-allowed dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
                <option value="auto">Auto (consensus → R1 → R2 → AI)</option>
                {f.available.map(o => <option key={o.key} value={o.key}>{optionLabel(o)}</option>)}
              </select>
            </label>
          )}
          {f.fell_back && <span className="w-full text-[#475569] dark:text-slate-400">The chosen source is no longer available, so Auto is used.</span>}
          {changed.has(f.form_id) && (
            <span className="w-full text-[#475569] dark:text-slate-400">
              Outcomes already listed stay. New outcomes from this source appear after Create results on the Review protocol.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
