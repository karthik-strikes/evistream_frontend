'use client';

/**
 * Comparisons — per study (`?screen=comparisons&study=`).
 *
 * The column mapping maps an ARM column, not a comparison. A 2-arm trial's
 * comparison is derived automatically; a 3+-arm trial cannot say which pairs
 * the review compares, so its rows are held until a review manager defines the
 * comparisons here. Each comparison then turns every held outcome × time-point
 * row into one result to assess (`POST /rob/studies/{id}/results-from-comparisons`).
 *
 * Arms come from the extraction: the study's unresolved placeholder
 * comparison carries the arm list the build found; settled comparisons add
 * their own two sides. They are fixed in extraction, never here.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { robService } from '@/services';
import type { RobRowSourceOption } from '@/services/rob.service';

import { cellValue, rowsOf, type Row } from '../_lib/robForm';
import { useRob } from '../_lib/useRobData';
import { studyComparisons } from './dashboardModel';
import { useRobNav } from './robUi';
import { optionLabel, sourceText } from './RowSourceLine';

const ROW_KEY = ['population', 'outcome_domain', 'measurement', 'timepoint', 'analysis_population', 'analysis'] as const;

/** "Drug A 10 mg" and "Drug A 20 mg" share an intervention: dose and units stripped. */
function stem(arm: string): string {
  return arm.toLowerCase().replace(/\d+([.,]\d+)?\s*(mg|g|ml|mcg|µg|%)?/g, ' ')
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ABSENT = /^(nr|na|n\/a|not reported|not applicable|-|—|)$/i;
const NUMBER = /^[<>]?\s*-?[\d.,]+%?$/;
/** A column that holds per-arm sample sizes (n, total, n_randomised …). */
const SAMPLE_SIZE = /^(n|total|n_?(rand\w*|analy\w*|total|arm|per_arm)?|sample_size|participants|.*_n)$/i;

interface SourceTable {
  formId: string;
  formName: string;
  table: string;
  columns: string[];
  armColumn: string;
  armFallback: string;
  rows: Row[];
  choice: string;
  chosen: string | null;
  fellBack: boolean;
  available: RobRowSourceOption[];
}

/** "Consensus · 24 Sep" / "R1 · Reham Elkayal · 15 Sep" / "AI extraction · not reviewed · 18 Aug". */
const sourceLine = (t: SourceTable) => sourceText(t.available, t.chosen, t.choice);

export function ComparisonsScreen() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const studyId = get('study') || rob.studies[0]?.id || '';
  const label = rob.labelOf(studyId);

  const { arms, settled } = studyComparisons(rob, studyId);
  const placeholder = rob.contrasts.find(c => c.document_id === studyId && !c.intervention);

  // ── Extracted rows for this study, from each mapped source form ─────────────
  // From the server, by the same rule the results builder uses
  // (backend utils/rob_row_source): consensus → R1 → R2 → AI, or the source a
  // manager chose here. Managers only — it can show R1 and R2 side by side.
  const rowsQ = useQuery({
    queryKey: ['rob-study-rows', studyId],
    enabled: !!studyId && rob.canManage,
    staleTime: 60_000,
    queryFn: async (): Promise<SourceTable[]> => {
      const res = await robService.studyRows(studyId);
      return res.forms.filter(f => f.mapping?.outcome_domain && f.mapping?.arm).map(f => {
        const m = f.mapping;
        const rows = f.rows as Row[];
        const isNumberCol = (c: string) => {
          const vals = rows.map(r => cellValue(r, c)).filter(v => !ABSENT.test(v));
          return vals.length > 0 && vals.every(v => NUMBER.test(v));
        };
        const lead = ['outcome_domain', 'outcome_qualifier', 'measurement', 'timepoint']
          .map(k => m[k]).filter((c): c is string => !!c && f.columns.includes(c));
        const tail = ['analysis_population', 'analysis'].map(k => m[k]).filter((c): c is string => !!c && f.columns.includes(c));
        const numbers = f.columns.filter(c => !lead.includes(c) && !tail.includes(c) && c !== m.arm && isNumberCol(c));
        return {
          formId: f.form_id, formName: f.form_name, table: f.table,
          columns: [...lead, '__arm__', ...numbers, ...tail],
          armColumn: m.arm, armFallback: m.arm_fallback ?? '', rows,
          choice: f.choice, chosen: f.chosen, fellBack: f.fell_back, available: f.available,
        };
      });
    },
  });
  const [savingSource, setSavingSource] = useState('');
  const [changedSource, setChangedSource] = useState<Set<string>>(new Set());
  const chooseSource = async (formId: string, source: string) => {
    setSavingSource(formId);
    try {
      await rob.updateProtocol({ row_source: { document_id: studyId, form_id: formId, source } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-study-rows', studyId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', rob.projectId] }),
      ]);
      setChangedSource(prev => new Set(prev).add(formId));
    } catch (e) {
      toast({ title: 'Could not change the source', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSavingSource('');
    }
  };
  const tables = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const armOf = (t: SourceTable, r: Row) => {
    const v = cellValue(r, t.armColumn);
    return (!v || ABSENT.test(v) || /^other/i.test(v)) && t.armFallback ? cellValue(r, t.armFallback) || v : v;
  };
  /** n per arm, from the rows' sample-size column when the form has one. */
  const armN = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of tables) {
      const nCol = t.columns.find(c => c !== '__arm__' && SAMPLE_SIZE.test(c));
      if (!nCol) continue;
      for (const r of t.rows) {
        const arm = armOf(t, r); const n = Number(cellValue(r, nCol).replace(/,/g, ''));
        if (arm && Number.isFinite(n) && n > 0) out.set(arm, Math.max(out.get(arm) ?? 0, n));
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]);

  const studyResults = rob.resultsOf(studyId);
  /** Distinct outcome × time-point rows, whatever their comparison. */
  const baseRows = useMemo(() => {
    const keys = new Set(studyResults.map(r => ROW_KEY.map(f => String((r as any)[f] ?? '')).join('|')));
    return keys.size;
  }, [studyResults]);

  const role = (arm: string) => {
    const isExp = settled.some(c => c.intervention.split(' + ').includes(arm));
    const isComp = settled.some(c => c.comparator === arm);
    return isExp && isComp ? 'both' : isExp ? 'experimental' : isComp ? 'comparator' : 'unused';
  };

  // Pooling is offered when two or more arms share an intervention (dose arms).
  const poolOpts = useMemo(() => {
    if (arms.length <= 2) return [] as string[];
    const groups = new Map<string, string[]>();
    for (const a of arms) groups.set(stem(a), [...(groups.get(stem(a)) ?? []), a]);
    return [...groups.values()].filter(g => g.length > 1).map(g => g.join(' + '));
  }, [arms]);

  const [draft, setDraft] = useState({ exp: '', comp: '' });
  const [busy, setBusy] = useState<'' | 'add' | 'remove' | 'create'>('');
  /** Click an arm: first fills Experimental, then Comparator. */
  const place = (arm: string) => {
    if (!editable || !arm) return;
    setDraft(d => (!d.exp || (d.exp && d.comp) ? { exp: arm, comp: '' }
      : arm === d.exp ? d : { ...d, comp: arm }));
  };
  const draftOk = !!draft.exp && !!draft.comp && draft.exp !== draft.comp
    && !draft.exp.split(' + ').includes(draft.comp);
  // Comparisons are a review-manager decision about the study (README §1).
  const editable = rob.canManage;

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rob-registry', rob.projectId] }),
    queryClient.invalidateQueries({ queryKey: ['rob-build', rob.projectId] }),
  ]);

  const add = async () => {
    if (!draftOk || !editable) return;
    setBusy('add');
    try {
      await robService.commitResults(rob.projectId, [], [{
        id: '', project_id: rob.projectId, document_id: studyId,
        intervention: draft.exp, comparator: draft.comp, state: 'confirmed', source: 'manual',
        canonical_key: null, arms: placeholder?.arms ?? [],
      } as any]);
      setDraft({ exp: '', comp: '' });
      await refresh();
    } catch (e) {
      toast({ title: 'Could not add the comparison', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy('');
    }
  };

  /** Results that point at each comparison right now. */
  const resultsOn = (contrastId: string) =>
    rob.results.filter(r => r.contrast?.id === contrastId && r.state !== 'merged').length;

  /** A comparison with results asks once, inline, before its results are released. */
  const [confirmRemove, setConfirmRemove] = useState('');

  const remove = async (id: string) => {
    const withResults = resultsOn(id) > 0;
    if (withResults && confirmRemove !== id) { setConfirmRemove(id); return; }
    setBusy('remove');
    try {
      await robService.deleteContrast(id, { releaseResults: withResults });
      setConfirmRemove('');
      await refresh();
      toast({ title: 'Comparison removed', description: withResults ? 'Its results are waiting for a comparison again.' : undefined, variant: 'success' });
    } catch (e) {
      toast({ title: 'Could not remove it', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy('');
    }
  };

  /** Wrong way round: flip experimental and comparator. Results and assessments stay. */
  const swap = async (id: string, intervention: string, comparator: string) => {
    setBusy('remove');
    try {
      await robService.patchContrast(id, { intervention: comparator, comparator: intervention });
      await refresh();
      toast({ title: 'Direction swapped', description: `Now ${comparator} vs ${intervention}.`, variant: 'success' });
    } catch (e) {
      toast({ title: 'Could not swap it', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy('');
    }
  };

  const create = async () => {
    if (!settled.length || !editable) return;
    setBusy('create');
    try {
      const out = await robService.resultsFromComparisons(studyId);
      await refresh();
      toast({
        title: out.created ? `${out.created} result${out.created === 1 ? '' : 's'} created` : 'Results are up to date',
        variant: 'success',
      });
      go({ screen: 'dashboard', study: studyId });
    } catch (e) {
      toast({ title: 'Could not create results', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy('');
    }
  };

  const intro = arms.length > 2
    ? `${arms.length} arms found. The system cannot know which pairs the review needs; define each comparison below.`
    : 'Two arms found; the comparison is proposed automatically.';
  const impact = settled.length
    ? `${settled.length} comparison${settled.length === 1 ? '' : 's'} × ${baseRows} outcome/time-point row${baseRows === 1 ? '' : 's'} = ${settled.length * baseRows} results to assess`
    : 'Nothing can be assessed for this study until at least one comparison exists. Domain 2 and Domain 4 answers depend on which arms are compared, at either scope.';

  const EYEBROW = 'text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500';
  const CARD = 'overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]';
  const SELECT = 'rounded-[8px] border border-[#e5e7eb] bg-white px-[10px] py-[6px] text-[12px] text-[#111827] outline-none disabled:cursor-not-allowed dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100';

  return (
    <div className="flex max-w-[1240px] flex-col gap-4">
      <button type="button" onClick={() => go({ screen: 'dashboard', study: studyId })}
        className="flex items-center gap-1.5 self-start border-none bg-transparent p-0 text-[12px] text-[#6b7280] hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        {label} · Risk of Bias
      </button>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">Comparisons · {label}</h2>
        <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
          A comparison is a fact about the study, set once, at either assessment scope. It defines which arms every judgment for this study is about.
        </span>
        {!editable && (
          <span className="text-[12px] text-[#475569] dark:text-slate-400">Read-only. Only a project owner or manager can define comparisons.</span>
        )}
      </div>

      <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-5">
        <div className="flex flex-col gap-2">
          <div className={EYEBROW}>Arms found in extraction</div>
          <div className={CARD}>
            {arms.length === 0 && (
              <div className="border-b border-[#f3f4f6] px-4 py-3 text-[12px] text-[#9ca3af] dark:border-[#1a1a1a]">No arms extracted for this study yet.</div>
            )}
            {arms.map(a => {
              const r = role(a);
              return (
                <div key={a} role={editable ? 'button' : undefined} onClick={() => place(a)}
                  className={`flex items-center justify-between gap-2.5 border-b border-[#f3f4f6] px-4 py-3 dark:border-[#1a1a1a] ${editable ? 'cursor-pointer hover:bg-[#fafafa] dark:hover:bg-[#141414]' : ''}`}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{a}</span>
                    {armN.get(a) ? <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">n = {armN.get(a)}</span> : null}
                  </div>
                  <span className={r === 'unused'
                    ? 'whitespace-nowrap rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-2 text-[11px] font-medium leading-5 text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300'
                    : 'whitespace-nowrap rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-2 text-[11px] font-medium leading-5 text-[#4b5563] dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400'}>
                    {r === 'unused' ? 'not in any comparison' : r}
                  </span>
                </div>
              );
            })}
            <div className="px-4 py-2.5 text-[11px] leading-4 text-[#9ca3af] dark:text-zinc-500">
              From the Arm column of the mapped forms. Click an arm to place it in the comparison. Fix arm names in extraction, not here.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className={EYEBROW}>Comparisons</div>
          <div className={CARD}>
            <div className="border-b border-[#f3f4f6] px-4 py-2.5 text-[12px] leading-[17px] text-[#6b7280] dark:border-[#1a1a1a] dark:text-zinc-400">{intro}</div>
            {settled.map(c => {
              const auto = c.source === 'two_arm_auto';
              const n = resultsOn(c.id);
              const SMALL = 'rounded-[6px] border border-[#e5e7eb] bg-transparent px-2 py-[3px] text-[11px] font-medium text-[#6b7280] disabled:cursor-not-allowed dark:border-[#2a2a2a] dark:text-zinc-400';
              return (
                <div key={c.id} className="border-b border-[#f3f4f6] px-4 py-3 dark:border-[#1a1a1a]">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{c.intervention} vs {c.comparator}</span>
                      <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">
                        {auto ? 'Proposed automatically (2-arm trial)' : 'Defined by review manager'} · {n
                          ? `${n} result${n === 1 ? '' : 's'}`
                          : `${baseRows} result${baseRows === 1 ? '' : 's'} once created`}
                      </span>
                    </div>
                    {editable && (
                      <>
                        <button type="button" disabled={!!busy} onClick={() => swap(c.id, c.intervention, c.comparator)}
                          title="Flip experimental and comparator. Results and assessments are kept." className={SMALL}>
                          Swap
                        </button>
                        <button type="button" disabled={!!busy} onClick={() => remove(c.id)} className={SMALL}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                  {confirmRemove === c.id && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-[8px] border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300">
                      <span className="flex-1">
                        Remove this comparison? Its {n} result{n === 1 ? '' : 's'} go back to waiting for a comparison.
                        Not possible if any of them is already assessed; swap the direction instead if it is only the wrong way round.
                      </span>
                      <button type="button" onClick={() => setConfirmRemove('')} className={SMALL}>Cancel</button>
                      <button type="button" disabled={!!busy} onClick={() => remove(c.id)}
                        className="rounded-[6px] border border-[#dc2626] bg-white px-2 py-[3px] text-[11px] font-semibold text-[#b91c1c] disabled:cursor-not-allowed dark:bg-transparent">
                        Remove comparison &amp; results
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {editable && (
              <div className="flex flex-col gap-2 bg-[#fafafa] px-4 py-3 dark:bg-[#0d0d0d]">
                <span className="text-[11px] font-semibold text-[#374151] dark:text-zinc-300">Add comparison</span>
                <div className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_auto] items-center gap-2">
                  <select value={draft.exp} onChange={e => setDraft(d => ({ ...d, exp: e.target.value }))} className={SELECT}>
                    <option value="">Experimental arm…</option>
                    {[...arms, ...poolOpts].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <span className="text-center text-[12px] text-[#9ca3af]">vs</span>
                  <select value={draft.comp} onChange={e => setDraft(d => ({ ...d, comp: e.target.value }))} className={SELECT}>
                    <option value="">Comparator arm…</option>
                    {arms.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button type="button" onClick={add} disabled={!draftOk || !!busy}
                    className={`h-8 rounded-[7px] border-none px-3 text-[12px] font-semibold text-white ${draftOk ? 'cursor-pointer bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900' : 'cursor-not-allowed bg-[#d4d4d8] dark:bg-zinc-700'}`}>
                    {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                  </button>
                </div>
                {poolOpts.length > 0 && (
                  <span className="text-[11px] leading-4 text-[#9ca3af] dark:text-zinc-500">
                    Pooling dose arms into one experimental group is offered when arms share an intervention; the assessment then covers the pooled comparison.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className={EYEBROW}>Extracted rows for this study</div>
          <span className="text-[12px] text-[#9ca3af] dark:text-zinc-500">From the mapped source forms · click an arm to place it in the comparison</span>
        </div>
        {rowsQ.isLoading && (
          <div className={`${CARD} flex items-center gap-2 px-5 py-4 text-[12px] text-[#6b7280]`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading extracted rows…</div>
        )}
        {!rob.canManage && (
          <div className={`${CARD} px-5 py-4 text-[12px] text-[#6b7280] dark:text-zinc-400`}>Only a project owner or manager can see every extraction of a study.</div>
        )}
        {rob.canManage && !rowsQ.isLoading && tables.length === 0 && (
          <div className={`${CARD} px-5 py-4 text-[12px] text-[#6b7280] dark:text-zinc-400`}>No mapped source form yet. Tick and map an outcome form on the Review protocol.</div>
        )}
        {tables.map(t => (
          <div key={t.formId} className={CARD}>
            <div className="flex items-baseline justify-between gap-3 border-b border-[#f3f4f6] px-5 py-3 dark:border-[#1a1a1a]">
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{t.formName}</span>
                <span className="font-mono text-[11px] text-[#9ca3af] dark:text-zinc-500">table {t.table}</span>
              </div>
              <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{t.rows.length} row{t.rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#f3f4f6] bg-[#fafafa] px-5 py-2 text-[12px] dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
              <span className="text-[#6b7280] dark:text-zinc-400">
                From: <span className="font-medium text-[#111827] dark:text-zinc-100">{sourceLine(t)}</span>
              </span>
              {t.available.length > 0 && (
                <label className="ml-auto flex items-center gap-1.5 text-[#6b7280] dark:text-zinc-400">
                  Use:
                  <select value={t.choice === 'auto' ? 'auto' : t.choice} disabled={!editable || savingSource === t.formId}
                    onChange={e => chooseSource(t.formId, e.target.value)}
                    className="rounded-[6px] border border-[#e5e7eb] bg-white px-2 py-[3px] text-[12px] text-[#111827] outline-none disabled:cursor-not-allowed dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
                    <option value="auto">Auto (consensus → R1 → R2 → AI)</option>
                    {t.available.map(o => <option key={o.key} value={o.key}>{optionLabel(o)}</option>)}
                  </select>
                </label>
              )}
              {t.fellBack && (
                <span className="w-full text-[#475569] dark:text-slate-400">The chosen source is no longer available, so Auto is used.</span>
              )}
              {changedSource.has(t.formId) && (
                <span className="w-full text-[#475569] dark:text-slate-400">Results already created keep their rows; press Create results to add rows from this source.</span>
              )}
            </div>
            {t.rows.length === 0 ? (
              <div className="px-5 py-3 text-[12px] text-[#9ca3af] dark:text-zinc-500">No finished extraction of this study in this form yet. Drafts are not used.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#f3f4f6] bg-[#f9fafb] dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
                      {t.columns.map(c => (
                        <th key={c} className="whitespace-nowrap px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">
                          {c === '__arm__' ? `${t.armColumn} ↓ role` : c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, i) => (
                      <tr key={i} className="border-b border-[#f3f4f6] last:border-b-0 dark:border-[#1a1a1a]">
                        {t.columns.map(c => {
                          if (c === '__arm__') {
                            const arm = armOf(t, r);
                            const picked = arm && (arm === draft.exp || arm === draft.comp);
                            return (
                              <td key={c} className="px-5 py-2">
                                {arm ? (
                                  <button type="button" disabled={!editable} onClick={() => place(arm)}
                                    className={`whitespace-nowrap rounded-[6px] border px-2 py-0.5 text-[12px] font-medium disabled:cursor-default ${picked
                                      ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                                      : 'border-[#e5e7eb] bg-white text-[#111827] hover:border-[#9ca3af] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100'}`}>
                                    {arm}
                                  </button>
                                ) : <span className="text-[12px] italic text-[#9ca3af]">not recorded</span>}
                              </td>
                            );
                          }
                          const v = cellValue(r, c);
                          const numeric = NUMBER.test(v);
                          return (
                            <td key={c} className={`max-w-[260px] truncate px-5 py-2 text-[13px] text-[#111827] dark:text-zinc-200 ${numeric ? 'text-right tabular-nums' : ''}`} title={v}>
                              {v || <span className="text-[#d4d4d8]">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-3 flex items-center gap-3 rounded-[12px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,.04)] dark:border-[#1f1f1f] dark:bg-[#111111]">
        <span className="flex-1 text-[12px] text-[#374151] dark:text-zinc-300">{impact}</span>
        <button type="button" onClick={create} disabled={!settled.length || !editable || !!busy}
          className={`inline-flex h-9 items-center gap-1.5 rounded-[7px] border-none px-4 text-[13px] font-semibold text-white ${settled.length && editable ? 'cursor-pointer bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900' : 'cursor-not-allowed bg-[#d4d4d8] dark:bg-zinc-700'}`}>
          {busy === 'create' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create results &amp; back to study
        </button>
      </div>
    </div>
  );
}
