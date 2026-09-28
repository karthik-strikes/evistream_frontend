'use client';

/**
 * The synthesis workspace: picker header, tabs with pending dots, the AI
 * strip slot, the active tab and the source drawer.
 *
 * The AI layer is deferred (phase 7): the strip is built but has no items, so
 * it renders nothing. When items exist it sits between the tabs and the body.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Spinner } from '@/components/ui';
import { EFFECT_LABEL } from '@/lib/metaAnalysis';
import { MA_TABS, SWIM_TABS, TAB_LABEL, useSynthesisNav, type WorkspaceTab } from '../../_lib/nav';
import { poolingOf, runBranchOf } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import { useWorkspace, type WorkspaceState } from '../../_lib/useWorkspace';
import { EmptyPanel, OutlineButton, ScreenHeader, StatusBadge } from '../ui';
import { AnalysisTab } from './AnalysisTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { EvidenceTab } from './EvidenceTab';
import { HarmonizationTab } from './HarmonizationTab';
import { HistoryTab } from './HistoryTab';
import { PoolingTab } from './PoolingTab';
import { ResultsTab } from './ResultsTab';
import { SourceDrawer } from './SourceDrawer';
import { SwimTab } from './SwimTab';
import { TargetTab } from './TargetTab';

export interface AiItem { id: string; kind: 'decision' | 'detect' | 'explain' | 'audit'; text: string }

/** Reserved for the AI layer. Renders nothing while there are no items. */
export function AiStrip({ items }: { items: AiItem[] }) {
  if (items.length === 0) return null;
  const n = (k: AiItem['kind']) => items.filter(i => i.kind === k).length;
  const parts = [
    n('decision') && `${n('decision')} AI suggestion${n('decision') === 1 ? '' : 's'}`,
    n('detect') && `${n('detect')} decision${n('detect') === 1 ? '' : 's'} only you can make`,
    n('audit') && `${n('audit')} open audit finding${n('audit') === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-full border border-[#ececea] px-3.5 py-1.5 text-[12.5px] text-[#374151] dark:border-[#1f1f1f] dark:text-zinc-300">
      {parts.join(' · ')}
      <span className="ml-auto text-[11.5px] text-gray-500">Suggestions live on the rows they concern</span>
    </div>
  );
}

function dotFor(tab: WorkspaceTab, ws: WorkspaceState): string | null {
  const b = ws.model.blocking;
  if (tab === 'target' && !ws.model.targetConfirmed) return '#4338ca';
  if (tab === 'evidence' && b.some(x => x.kind === 'eligibility' || x.kind === 'instrument' || x.kind === 'source_review')) return '#4338ca';
  if (tab === 'harmonization' && ws.model.transformations.some(t => t.state === 'open')) return '#f59e0b';
  if (tab === 'pooling' && ws.model.targetConfirmed) {
    const want = ws.group.branch === 'ma' ? 'pool' : 'do_not_pool';
    if (poolingOf(ws.bundle?.decisions ?? []).choice !== want) return '#f59e0b';
  }
  if ((tab === 'analysis' || tab === 'swim') && ws.latestRun && ws.diff.stale) return '#f59e0b';
  return null;
}

export function Workspace() {
  const syn = useSynthesis();
  const { get, go } = useSynthesisNav();
  const id = get('id') || syn.groups[0]?.id || '';
  const { state: ws, loading, error, retry, wrongProject } = useWorkspace(id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  useEffect(() => { setDrawer(null); }, [id]);

  if (!id) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <ScreenHeader active="workspace" />
        <EmptyPanel title="No synthesis yet" action={<OutlineButton onClick={() => go({ screen: 'new' })}>New synthesis</OutlineButton>} />
      </div>
    );
  }
  if (!ws) {
    return loading
      ? <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>
      : (
        <div className="mx-auto max-w-[1040px]">
          <ScreenHeader active="workspace" />
          <EmptyPanel title="Synthesis not found" action={<div className="flex gap-2">{error && !wrongProject && retry ? <OutlineButton onClick={() => retry()}>Retry</OutlineButton> : null}<OutlineButton onClick={() => go({ screen: 'dashboard', id: null })}>Back to dashboard</OutlineButton></div>}>
            {error instanceof Error ? error.message : 'It may have been removed, or you may not have access.'}
          </EmptyPanel>
        </div>
      );
  }

  const requested = get('tab') as WorkspaceTab;
  // A saved run of the OTHER branch (from History, after a branch change) is
  // shown on its own branch's tab, added to the strip while it is viewed.
  const runParam = Number(get('run'));
  const viewedRun = get('run') && Number.isFinite(runParam) ? ws.runs.find(r => r.n === runParam) ?? null : null;
  const baseTabs = ws.group.branch === 'swim' ? SWIM_TABS : MA_TABS;
  const crossTab: WorkspaceTab | null = viewedRun && !baseTabs.includes(requested)
    && ((requested === 'swim' && runBranchOf(viewedRun) === 'swim') || (requested === 'analysis' && runBranchOf(viewedRun) === 'ma'))
    ? requested : null;
  const tabs = crossTab ? [...baseTabs.slice(0, -2), crossTab, ...baseTabs.slice(-2)] : baseTabs;
  const tab: WorkspaceTab = tabs.includes(requested) ? requested : 'target';
  const setTab = (t: WorkspaceTab) => go({ tab: t, run: null });
  const g = ws.group;
  const fd = ws.formData;

  return (
    <div className="mx-auto max-w-[1040px] pb-16">
      <ScreenHeader active="workspace" />

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="relative min-w-0 flex-1" ref={pickerRef}>
          <button type="button" onClick={() => setPickerOpen(o => !o)} aria-expanded={pickerOpen}
            className="flex max-w-full items-center gap-2 text-left">
            <span className="truncate text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">{g.title}</span>
            <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />
          </button>
          <div className="mt-0.5 truncate text-[13px] text-gray-500 dark:text-zinc-400">
            {[g.target.population || null, ws.sourceForm ? { dichotomous: 'Dichotomous', continuous: 'Continuous', effect: 'Reported effect', proportion: 'Proportion', correlation: 'Correlation' }[ws.sourceForm.kind] : null,
              `${ws.model.measure} · ${EFFECT_LABEL[ws.model.measure]}`, g.branch === 'swim' ? 'Structured synthesis' : 'Meta-analysis'].filter(Boolean).join(' · ')}
          </div>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-xl dark:border-[#2a2a2a] dark:bg-[#111111]">
              {syn.groups.map(x => (
                <button key={x.id} type="button" onClick={() => { setPickerOpen(false); go({ screen: 'workspace', id: x.id, tab: null, run: null }); }}
                  className={`flex w-full flex-col items-start border-t border-[#ececea] px-4 py-2.5 text-left first:border-t-0 hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:hover:bg-[#161616] ${x.id === g.id ? 'bg-[#fafafa] dark:bg-[#161616]' : ''}`}>
                  <span className="truncate text-[13.5px] font-medium text-[#0a0a0a] dark:text-white">{x.title}</span>
                  <span className="text-[12px] text-gray-500">{x.branch === 'swim' ? 'Structured synthesis' : 'Meta-analysis'}{x.latest_version ? ` · v${x.latest_version.n} ${x.latest_version.status}` : x.latest_run ? ` · ${x.latest_run.n} runs` : ''}</span>
                </button>
              ))}
              {syn.canEdit && (
                <button type="button" onClick={() => { setPickerOpen(false); go({ screen: 'new' }); }}
                  className="w-full border-t border-[#ececea] px-4 py-2.5 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:text-white dark:hover:bg-[#161616]">
                  + New synthesis
                </button>
              )}
            </div>
          )}
        </div>
        <StatusBadge status={ws.status} />
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max gap-7 border-b border-[#ececea] dark:border-[#1f1f1f]">
          {tabs.map(t => {
            const dot = dotFor(t, ws);
            const on = t === tab;
            return (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-[14px] font-medium ${on ? 'border-[#0a0a0a] text-[#0a0a0a] dark:border-white dark:text-white' : 'border-transparent text-[#6b7280] hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-white'}`}>
                {TAB_LABEL[t]}
                {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
              </button>
            );
          })}
        </div>
      </div>

      <AiStrip items={[]} />

      {fd?.loading && <div className="mb-4 flex items-center gap-2 text-[12.5px] text-gray-500"><Spinner className="h-3.5 w-3.5" />Loading extracted rows…</div>}

      {/* Keyed by synthesis: a tab's local drafts (target edits, reasons,
          pending presets, grouping) must never carry into another synthesis. */}
      <Fragment key={g.id}>
        {tab === 'target' && <TargetTab ws={ws} onNext={() => setTab('evidence')} />}
        {tab === 'evidence' && <EvidenceTab ws={ws} openStudy={setDrawer} />}
        {tab === 'harmonization' && <HarmonizationTab ws={ws} openStudy={setDrawer} />}
        {tab === 'pooling' && <PoolingTab ws={ws} />}
        {tab === 'analysis' && <AnalysisTab ws={ws} openStudy={setDrawer} />}
        {tab === 'diagnostics' && <DiagnosticsTab ws={ws} />}
        {tab === 'swim' && <SwimTab ws={ws} openStudy={setDrawer} />}
        {tab === 'results' && <ResultsTab ws={ws} />}
        {tab === 'history' && <HistoryTab ws={ws} />}
      </Fragment>

      <SourceDrawer ws={ws} documentId={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
