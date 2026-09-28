'use client';

/**
 * History — every version, and every run, decision, deviation, finalization
 * and protocol amendment, newest first. Server-written: each write endpoint
 * appends one entry, so nothing here can be edited from the page.
 */

import { shortHash } from '../../_lib/datasetHash';
import { useSynthesisNav } from '../../_lib/nav';
import { runBranchOf } from '../../_lib/synthesisModel';
import { useGroupHistory, useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { Chip, EmptyPanel, Mono, StatusBadge, when } from '../ui';

const KIND: Record<string, { label: string; tone: 'indigo' | 'amber' | 'gray' | 'green' | 'teal' }> = {
  human_decision: { label: 'Decision', tone: 'indigo' },
  deviation: { label: 'Deviation', tone: 'amber' },
  run: { label: 'Run', tone: 'gray' },
  finalization: { label: 'Version', tone: 'green' },
  amendment: { label: 'Protocol', tone: 'teal' },
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * The server logs a decision as "<kind> · <target_ref>", and a ref is an id
 * ("study:<uuid>", "result:<uuid>|outcome|timepoint|comparison"). Read the ids
 * back as the study labels every other screen shows.
 */
export function readableWhat(
  what: string, labelOf: (documentId: string) => string,
  analyses: Array<{ id: string; analysis_type: string; description?: string; field?: string | null }>,
): string {
  return what
    .replace(new RegExp(`result:(${UUID})\\|(.*)$`), (_, id: string, rest: string) =>
      `${labelOf(id)} (${rest.split('|').filter(Boolean).join(' · ')})`)
    .replace(new RegExp(`study:(${UUID}):transform:([a-z_]+)`, 'g'), (_, id: string, k: string) => `${labelOf(id)} · ${k.replace(/_/g, ' ')}`)
    .replace(new RegExp(`study:(${UUID})`, 'g'), (_, id: string) => labelOf(id))
    .replace(/analysis:preset$/, 'method preset')
    .replace(/analysis:([\w-]+)$/, (m: string, id: string) => {
      const a = analyses.find(x => x.id === id);
      return a ? `${a.analysis_type} · ${a.description || a.field || id}` : m;
    })
    .replace(/label:(.+)$/, '“$1”')
    .replace(/ · group$/, '');
}

export function HistoryTab({ ws }: { ws: WorkspaceState }) {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const q = useGroupHistory(ws.group.id);
  const entries = [...(q.data ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const versions = [...(ws.bundle?.versions ?? [])].sort((a, b) => b.n - a.n);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
      <div>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">Versions</div>
        <div className="flex flex-col gap-3">
          <div className="rounded-[10px] border border-[#ececea] px-3.5 py-3 dark:border-[#1f1f1f]">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">Working copy</span>
              <span className="ml-auto"><StatusBadge status={ws.status} /></span>
            </div>
            <div className="mt-1 text-[12px] text-gray-500">dataset <Mono>{shortHash(ws.hash)}</Mono> · {ws.runs.length} run{ws.runs.length === 1 ? '' : 's'}</div>
          </div>
          {versions.map(v => (
            <div key={v.id} className="rounded-[10px] bg-[#fafafa] px-3.5 py-3 dark:bg-[#141414]">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-[#0a0a0a] dark:text-white">v{v.n}</span>
                <Chip tone={v.status === 'finalized' ? 'green' : 'indigo'}>{v.status === 'finalized' ? 'Finalized' : 'Awaiting approval'}</Chip>
                {v.superseded_by && <Chip>superseded</Chip>}
              </div>
              <div className="mt-1 text-[12px] leading-[18px] text-gray-500">
                {when(v.at)} · {v.finalized_by_name ?? syn.nameOf(v.finalized_by)}{v.approved_by ? ` · approved by ${v.approved_by_name ?? syn.nameOf(v.approved_by)}` : ''}
                <br />dataset <Mono>{shortHash(v.dataset_hash)}</Mono>
              </div>
            </div>
          ))}
          {versions.length === 0 && <div className="text-[12.5px] text-gray-500">No finalized version yet.</div>}
        </div>
        {ws.runs.length > 0 && (
          <>
            <div className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">Runs</div>
            <div className="flex flex-col">
              {[...ws.runs].reverse().map(r => (
                <button key={r.id} type="button" onClick={() => go({ tab: runBranchOf(r) === 'swim' ? 'swim' : 'analysis', run: r.n })}
                  className="flex items-center gap-2 border-t border-[#ececea] py-2 text-left text-[12.5px] hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:hover:bg-[#141414]">
                  <span className="font-medium text-[#0a0a0a] dark:text-zinc-100">Run {r.n}</span>
                  <span className="text-gray-500">{when(r.at)}</span>
                  {runBranchOf(r) !== ws.group.branch && <Chip>{runBranchOf(r) === 'swim' ? 'structured' : 'meta-analysis'}</Chip>}
                  <Mono className="ml-auto">{shortHash(r.dataset_hash)}</Mono>
                  {r.partial && <Chip tone="amber">partial</Chip>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">Runs, decisions and deviations</div>
        {q.isLoading ? <div className="text-[13px] text-gray-500">Loading…</div>
          : entries.length === 0 ? <EmptyPanel title="Nothing recorded yet" />
            : (
              <div className="flex flex-col">
                {entries.map(e => {
                  const k = KIND[e.kind] ?? { label: e.kind, tone: 'gray' as const };
                  return (
                    <div key={e.id} className="grid grid-cols-1 gap-1 border-t border-[#ececea] py-3 sm:grid-cols-[100px_1fr] sm:gap-3 dark:border-[#1f1f1f]">
                      <div className="text-[12px] text-gray-500">{when(e.at)}</div>
                      <div className="min-w-0 text-[13px] leading-[20px] text-[#374151] dark:text-zinc-300">
                        <Chip tone={k.tone} className="mr-2">{k.label}</Chip>
                        {readableWhat(e.what, syn.labelOf, syn.protocol.planned_analyses ?? [])} <span className="text-gray-500">· {e.by_name ?? syn.nameOf(e.by)}</span>
                        {e.reason && <span className="text-gray-600 dark:text-zinc-400"> · “{e.reason}”</span>}
                        {e.provenance && Object.keys(e.provenance).length > 0 && (
                          <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                            {Object.entries(e.provenance).slice(0, 4).map(([pk, pv]) => `${pk}: ${typeof pv === 'object' ? JSON.stringify(pv) : String(pv)}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
      </div>
    </div>
  );
}
