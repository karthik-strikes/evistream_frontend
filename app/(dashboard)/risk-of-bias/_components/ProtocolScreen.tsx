'use client';

/**
 * Review protocol — every decision made once for the whole review.
 *
 * Scope, effect of interest, the reviewers, the tool, the result sources and
 * each study's design all live on this one screen, so every assessment is judged
 * against the same rules and the choices can be quoted in the methods section.
 * Controls save the moment they change; after the first assessment exists a
 * change to scope, effect or deviation types is a protocol deviation and goes
 * through the impact dialog, which demands a reason and says what it resets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { cn, getErrorMessage } from '@/lib/utils';
import { robService } from '@/services';
import type {
  RobAiVisibility, RobBuildResponse, RobDeviationType, RobFormMapping, RobProtocolEffect, RobProtocolPatch,
  RobScope, RobSeat,
} from '@/services/rob.service';

import { ALL_DEVIATION_TYPES, DEVIATION_LABEL } from '../_lib/rob2';
import {
  DESIGN_ORDER, DESIGN_SHORT, SEAT_LABEL, TOOL_FOR_DESIGN, type StudyDesign,
} from '../_lib/robModel';
import { AI_VISIBILITY_HELP, AI_VISIBILITY_LABEL, ROB_AI_ENABLED, aiVisibilityOf } from '../_lib/robAi';
import { useRob } from '../_lib/useRobData';
import { Banner, OutlineButton, useRobNav } from './robUi';

// ── Shared with WelcomeScreen / MappingScreen ────────────────────────────────

/** A form's mapping state, as the pill and the checklist read it. */
export function mappingState(form: RobFormMapping): 'confirmed' | 'needs' | 'blocked' {
  const blocking = (form.warnings ?? []).filter(w => w.severity === 'blocking').length;
  if (blocking > 0) return 'blocked';
  if (populationQuestionOpen(form)) return 'needs';
  return form.confirmed ? 'confirmed' : 'needs';
}

/**
 * The population question on Column mapping is unanswered: either no Population
 * column and no stated population, or a mapped column with blanks and no answer
 * for what a blank means (utils/rob_mapping.population_of).
 */
export function populationQuestionOpen(form: RobFormMapping): boolean {
  const m = (form.mapping ?? {}) as Record<string, string>;
  const col = m.population;
  if (!col) return false;
  const st = form.column_stats?.[col];
  if (!st || st.rows - st.usable <= 0) return false;
  const rule = m.population_blank;
  return !(rule === 'overall' || rule === 'not_reported' || (rule === 'same' && !!(m.population_blank_value ?? '').trim()));
}

/** Identity of a candidate or a registry result, comparison included ('' when none). */
function identityKey(r: {
  document_id: string; population?: string; outcome_domain?: string; measurement?: string;
  timepoint?: string; analysis_population?: string; analysis?: string;
}, contrast: string): string {
  return [r.document_id, r.population || 'Overall', r.outcome_domain ?? '', r.measurement ?? '',
    r.timepoint ?? '', r.analysis_population ?? '', r.analysis ?? '', contrast].join('|').toLowerCase();
}

/**
 * The candidate build (every outcome extraction, read on demand) plus the
 * actions that change it. Commits send exactly what the Sep 22 setup screen
 * sent: the build's results and contrasts as proposed.
 */
export function useRobBuild(enabled = true) {
  const rob = useRob();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const projectId = rob.projectId;
  const [pendingSources, setPendingSources] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  const query = useQuery<RobBuildResponse>({
    queryKey: ['rob-build', projectId],
    queryFn: () => robService.buildResults(projectId),
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
  const build = query.data ?? null;

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] }),
  ]), [queryClient, projectId]);

  const toggleSource = useCallback(async (formId: string, use: boolean | null) => {
    setPendingSources(prev => new Set(prev).add(formId));
    try {
      await robService.setFormAsSource(formId, use);
      await invalidate();
    } catch (e) {
      toast({ title: 'Could not change this', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setPendingSources(prev => { const next = new Set(prev); next.delete(formId); return next; });
    }
  }, [invalidate, toast]);

  const saveMapping = useCallback(async (formId: string, mapping: Record<string, string>) => {
    setSavingMapping(true);
    try {
      await robService.saveMapping(formId, mapping);
      toast({
        title: 'Mapping confirmed',
        description: 'Every extraction from this form now resolves the same way.',
        variant: 'success',
      });
      await invalidate();
      return true;
    } catch (e) {
      toast({ title: 'Could not save mapping', description: getErrorMessage(e), variant: 'error' });
      return false;
    } finally {
      setSavingMapping(false);
    }
  }, [invalidate, toast]);

  const commit = useCallback(async () => {
    if (!build || build.results.length === 0) return;
    setCommitting(true);
    try {
      const response = await robService.commitResults(projectId, build.results, build.contrasts);
      toast({
        title: `${response.results.length} results created`,
        description: `${response.contrasts} comparisons stored. Assessments already made keep pointing `
          + 'at the results they were made against.',
        variant: 'success',
      });
      await invalidate();
    } catch (e) {
      toast({ title: 'Could not create results', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setCommitting(false);
    }
  }, [build, projectId, toast, invalidate]);

  const forms = build?.forms ?? [];
  const needMapping = forms.filter(f => mappingState(f) !== 'confirmed');
  const heldCount = (build?.results ?? []).filter(r => r.state === 'held').length;
  // Only candidates that do not exist yet. Waiting rows (no comparison) count
  // too: creating them is what puts their study on the dashboard, where its
  // comparisons are defined. The server drops any it already holds.
  const existing = useMemo(() => {
    const keys = new Set<string>();
    const rowKeys = new Set<string>();
    for (const r of rob.results) {
      const c = r.contrast?.intervention ? `${r.contrast.intervention}|${r.contrast.comparator}` : '';
      keys.add(identityKey(r, c));
      rowKeys.add(identityKey(r, ''));
    }
    return { keys, rowKeys };
  }, [rob.results]);
  const fresh = (build?.results ?? []).filter(r => {
    const c = r.contrast?.intervention ? `${r.contrast.intervention}|${r.contrast.comparator}` : '';
    return c ? !existing.keys.has(identityKey(r as any, c)) : !existing.rowKeys.has(identityKey(r as any, ''));
  });
  const creatable = fresh.filter(r => r.state !== 'held').length;
  const newWaiting = fresh.filter(r => r.state === 'held').length;

  return {
    build, loading: query.isLoading, fetching: query.isFetching,
    forms, needMapping, heldCount, creatable, newWaiting,
    pendingSources, toggleSource, committing, commit, savingMapping, saveMapping,
  };
}

// ── Local bits ───────────────────────────────────────────────────────────────

const SCOPE_HELP: Record<RobScope, string> = {
  result: 'One extracted result: outcome, time point and comparison. This is how RoB 2 is defined.',
  outcome: 'One assessment per outcome, attached to the outcome itself. Result-level assessments are not shown.',
};

const EFFECT_HELP: Record<RobProtocolEffect, string> = {
  assignment: 'Intention-to-treat effect. Domain 2 asks about deviations that arose because of the trial context.',
  adherence: 'Per-protocol effect. Domain 2 asks about the deviation types selected below.',
  both: 'Each assessment records which effect it addresses. Use when the review question needs both the ITT and per-protocol effect.',
};

const EFFECT_OPTION_LABEL: Record<RobProtocolEffect, string> = {
  assignment: 'Assignment (ITT)', adherence: 'Adhering (per-protocol)', both: 'Both',
};

/** Mapping roles, in the order the "identity from …" line names them. */
const ROLE_LABEL: Array<[string, string, boolean]> = [
  ['outcome_domain', 'Outcome', true],
  ['timepoint', 'Timepoint', false],
  ['measurement', 'Measurement', false],
  ['arm', 'Arm', true],
  ['population', 'Population', false],
  ['outcome_fallback', 'Outcome fallback', false],
  ['outcome_qualifier', 'Outcome qualifier', false],
  ['arm_fallback', 'Arm fallback', false],
  ['analysis_population', 'Analysis population', false],
  ['analysis', 'Analysis', false],
];

const SEATS: RobSeat[] = ['reviewer_1', 'reviewer_2', 'adjudicator'];

const SEAT_TAG: Record<RobSeat, { tag: string; cls: string }> = {
  reviewer_1: { tag: 'R1', cls: 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900' },
  reviewer_2: { tag: 'R2', cls: 'border-[#e5e7eb] bg-[#e5e7eb] text-[#374151] dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
  adjudicator: { tag: 'CR', cls: 'border-[#c7d2fe] bg-white text-[#4338ca] dark:border-indigo-800 dark:bg-transparent dark:text-indigo-300' },
};

function SettingRow({ title, help, children, last }: {
  title: string; help: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={cn('grid grid-cols-1 items-start gap-4 px-5 py-4 md:grid-cols-[200px_minmax(0,1fr)]',
      !last && 'border-b border-[#f3f4f6] dark:border-[#1a1a1a]')}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{title}</span>
        <span className="text-[11px] leading-[15px] text-[#9ca3af] dark:text-zinc-500">{help}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The prototype's segmented control: 8px radius, 12px/500 labels, equal widths. */
function Seg<T extends string>({ value, options, onChange, disabled, maxWidth }: {
  value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
  disabled?: boolean; maxWidth: number;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-[#e5e7eb] bg-white dark:border-[#2a2a2a] dark:bg-[#111111]" style={{ maxWidth }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}
            className={cn('flex-1 cursor-pointer border-none px-2.5 py-2 text-[12px] font-medium disabled:cursor-not-allowed',
              on ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900'
                : 'bg-white text-[#374151] dark:bg-[#111111] dark:text-zinc-300')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Check({ on, className }: { on: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center border-[1.5px]',
      on ? 'border-[#0a0a0a] bg-[#0a0a0a] dark:border-zinc-100 dark:bg-zinc-100' : 'border-[#d4d4d8] bg-white dark:border-zinc-600 dark:bg-transparent',
      className)}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        className="text-white dark:text-gray-900" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  );
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function SectionHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">{children}</div>
      {right !== undefined && <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{right}</span>}
    </div>
  );
}

function formatWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(at: string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

// ── Impact dialog ────────────────────────────────────────────────────────────

type Pending =
  | { kind: 'scope'; scope: RobScope }
  | { kind: 'effect'; effect: RobProtocolEffect }
  | { kind: 'deviations'; deviations: RobDeviationType[] };

function ImpactDialog({ pending, currentLabel, onCancel, onApply }: {
  pending: Pending;
  currentLabel: string;
  onCancel: () => void;
  onApply: (reason: string) => Promise<void>;
}) {
  const rob = useRob();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const impactQ = useQuery({
    queryKey: ['rob-impact', rob.projectId, JSON.stringify(pending)],
    queryFn: () => robService.protocolImpact(rob.projectId,
      pending.kind === 'effect' ? { effect: pending.effect } : pending.kind === 'deviations'
        ? { deviation_types: pending.deviations } : {}),
    enabled: pending.kind !== 'scope',
  });
  const impact = pending.kind === 'scope' ? { assessments: 0, studies: 0 } : impactQ.data;
  const n = impact?.assessments ?? 0;

  const newLabel = pending.kind === 'scope'
    ? (pending.scope === 'result' ? 'Result' : 'Outcome')
    : pending.kind === 'effect' ? EFFECT_OPTION_LABEL[pending.effect]
      : `${pending.deviations.length} deviation type${pending.deviations.length === 1 ? '' : 's'}`;
  const what = pending.kind === 'scope' ? 'assessment scope'
    : pending.kind === 'effect' ? 'effect of interest' : 'deviation types addressed';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4 dark:bg-black/60">
      <div role="dialog" aria-modal="true"
        className="w-full max-w-[520px] overflow-hidden rounded-[14px] border border-gray-200 bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)] dark:border-[#242424] dark:bg-[#111111]">
        <div className="flex flex-col gap-1.5 px-6 pb-3 pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#475569] dark:text-slate-400">Protocol deviation</span>
          <h3 className="text-[17px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">
            Change {what} to “{newLabel}”?
          </h3>
          <span className="text-[13px] leading-[19px] text-gray-500 dark:text-zinc-400">
            {pending.kind === 'scope'
              ? 'Outcome and result assessments are separate assessments, so nothing already recorded is reset or converted. Assessments of the old scope are kept but hidden while the new scope applies; new assessments follow the new scope.'
              : pending.kind === 'effect'
                ? 'Domain 2 asks different signalling questions under each effect, so existing Domain 2 answers no longer apply.'
                : 'The deviation types decide which Domain 2 questions are asked on the adhering pathway, so existing adhering answers no longer apply.'}
          </span>
        </div>

        {pending.kind !== 'scope' && (
          <div className="px-6 pb-2">
            <div className="overflow-hidden rounded-[10px] border border-gray-200 dark:border-[#242424]">
              <div className="flex items-baseline gap-2 border-b border-gray-100 px-3.5 py-2.5 dark:border-[#1a1a1a]">
                {impactQ.isLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  : <span className="text-[20px] font-bold text-gray-900 dark:text-zinc-100">{n}</span>}
                <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">
                  assessments across {impact?.studies ?? 0} studies have Domain 2 answers
                </span>
              </div>
              <div className="grid grid-cols-2 text-[12px]">
                <div className="flex flex-col gap-1 border-r border-gray-100 px-3.5 py-2.5 dark:border-[#1a1a1a]">
                  <span className="font-semibold text-[#b91c1c] dark:text-red-400">Reset</span>
                  <span className="text-gray-700 dark:text-zinc-300">Domain 2 answers &amp; judgment</span>
                  <span className="text-gray-700 dark:text-zinc-300">Overall judgment</span>
                  <span className="text-gray-700 dark:text-zinc-300">Consensus on D2 / Overall</span>
                </div>
                <div className="flex flex-col gap-1 px-3.5 py-2.5">
                  <span className="font-semibold text-[#15803d] dark:text-emerald-400">Kept</span>
                  <span className="text-gray-700 dark:text-zinc-300">Domains 1, 3, 4, 5</span>
                  <span className="text-gray-700 dark:text-zinc-300">Linked quotes &amp; rationales</span>
                  <span className="text-gray-700 dark:text-zinc-300">Previous answers, archived as revision</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-zinc-500">
              Affected assessments return to “In progress” and re-enter both reviewers’ queues.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5 px-6 pb-4 pt-2">
          <label htmlFor="rob-deviation-reason" className="text-[12px] font-semibold text-gray-900 dark:text-zinc-100">
            Reason <span className="text-[#b91c1c]">*</span>{' '}
            <span className="font-normal text-gray-400 dark:text-zinc-500">recorded in the protocol change history</span>
          </label>
          <textarea id="rob-deviation-reason" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Protocol amendment v1.2 approved 2026-09-20; review question revised to per-protocol effect."
            className="min-h-[64px] w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[12px] leading-[17px] text-gray-900 outline-none focus:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100" />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-gray-50 px-6 py-3 dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
          <OutlineButton onClick={onCancel} disabled={busy}>Keep “{currentLabel}”</OutlineButton>
          <button type="button"
            disabled={!reason.trim() || busy || (pending.kind !== 'scope' && impactQ.isLoading)}
            onClick={async () => { setBusy(true); try { await onApply(reason.trim()); } finally { setBusy(false); } }}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[7px] bg-[#b91c1c] px-4 text-[13px] font-semibold text-white hover:bg-[#991b1b] disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending.kind === 'scope' ? 'Change & log deviation' : `Change & reset ${n} assessment${n === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export function ProtocolScreen() {
  const rob = useRob();
  const { go } = useRobNav();
  const router = useRouter();
  const { toast } = useToast();
  const src = useRobBuild();
  const { protocol } = rob;
  const editable = rob.canManage;
  const hasAssessments = (protocol.assessment_count ?? 0) > 0;
  const confirmed = !!protocol.confirmed_at;

  const [pending, setPending] = useState<Pending | null>(null);
  const [editingSeat, setEditingSeat] = useState<RobSeat | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [savedAt, setSavedAt] = useState(() => formatTime(protocol.updated_at));

  const apply = useCallback(async (patch: RobProtocolPatch) => {
    setSaving(true);
    try {
      await rob.updateProtocol(patch);
      setSavedAt(formatTime(new Date().toISOString()));
    } catch (e) {
      toast({ title: 'Could not save the protocol', description: getErrorMessage(e), variant: 'error' });
      throw e;
    } finally {
      setSaving(false);
    }
  }, [rob, toast]);

  const quiet = (patch: RobProtocolPatch) => { apply(patch).catch(() => undefined); };

  // Anticipated deviations: typed freely, saved on blur and after a pause.
  const [anticipated, setAnticipated] = useState(protocol.anticipated_deviations ?? '');
  const anticipatedSaved = useRef(protocol.anticipated_deviations ?? '');
  useEffect(() => {
    const stored = protocol.anticipated_deviations ?? '';
    if (stored !== anticipatedSaved.current) { anticipatedSaved.current = stored; setAnticipated(stored); }
  }, [protocol.anticipated_deviations]);
  const saveAnticipated = useCallback((text: string) => {
    if (text === anticipatedSaved.current || !editable) return;
    anticipatedSaved.current = text;
    apply({ anticipated_deviations: text }).catch(() => undefined);
  }, [apply, editable]);
  useEffect(() => {
    if (anticipated === anticipatedSaved.current) return;
    const t = setTimeout(() => saveAnticipated(anticipated), 1200);
    return () => clearTimeout(t);
  }, [anticipated, saveAnticipated]);

  const pickScope = (scope: RobScope) => {
    if (scope === protocol.scope) return;
    if (hasAssessments && protocol.scope) setPending({ kind: 'scope', scope });
    else quiet({ scope });
  };
  const pickEffect = (effect: RobProtocolEffect) => {
    if (effect === protocol.effect) return;
    if (hasAssessments && protocol.effect) setPending({ kind: 'effect', effect });
    else quiet({ effect });
  };
  const toggleDeviation = (d: RobDeviationType) => {
    const current = protocol.deviation_types?.length ? protocol.deviation_types : ALL_DEVIATION_TYPES;
    const on = current.includes(d);
    if (on && current.length === 1) return; // at least one
    const next = ALL_DEVIATION_TYPES.filter(x => (x === d ? !on : current.includes(x)));
    if (hasAssessments) setPending({ kind: 'deviations', deviations: next });
    else quiet({ deviation_types: next });
  };

  const currentLabel = pending?.kind === 'scope'
    ? (protocol.scope === 'outcome' ? 'Outcome' : 'Result')
    : pending?.kind === 'effect' ? EFFECT_OPTION_LABEL[protocol.effect ?? 'assignment']
      : 'current deviation types';

  const designCounts = useMemo(() => {
    const counts: Record<StudyDesign, number> = { parallel: 0, cluster: 0, crossover: 0, nrsi: 0 };
    for (const s of rob.studies) {
      const d = rob.designOf(s.id).design;
      if (d) counts[d] += 1;
    }
    return counts;
  }, [rob]);

  const sourceForms = src.forms;
  const excluded = src.build?.excluded ?? [];
  const totalForms = sourceForms.length + excluded.length;
  const extractions = sourceForms.reduce((n, f) => n + f.extractions, 0);
  const duplicates = src.build?.duplicates ?? [];
  const listed = new Set([...sourceForms.map(f => f.form_id), ...excluded.map(f => f.form_id), protocol.form_id ?? '']);
  // Forms the builder does not consider at all, with the reason — the same
  // rule as rob_results_service.candidate_source_forms: a result source needs
  // a repeating table with an outcome column (every result is named by it).
  const otherFormList = rob.forms
    .filter(f => !listed.has(f.id) && f.id !== rob.robForm?.form.id)
    .map(f => {
      const table = (f.fields ?? []).find(x => x?.field_type === 'array' && (x.subform_fields?.length ?? 0) > 0);
      const cols = (table?.subform_fields ?? []).map(c => c?.field_name ?? '');
      const reason = !table
        ? 'No repeating table, so it has no rows to turn into results.'
        : cols.some(c => /judgment|judgement|rating/i.test(c))
          ? 'It records judgments, not results.'
          : !cols.some(c => /outcome/i.test(c))
            ? `Its table (${table.field_name}) has no outcome column, so its rows cannot name a result.`
            : 'Not proposed by the results builder.';
      return { id: f.id, name: f.form_name, reason };
    });
  const otherForms = otherFormList.length;
  const [showOthers, setShowOthers] = useState(false);

  // What each ticked form will produce, from the build's own candidates.
  const producesOf = (formId: string) => {
    const rows = (src.build?.results ?? []).filter(r => r.source_form_id === formId);
    const outcomes = new Set(rows.map(r => (r.outcome_domain ?? '').trim().toLowerCase()).filter(Boolean));
    return { n: rows.length, outcomes: outcomes.size };
  };

  const effectShown = (protocol.effect ?? null) as RobProtocolEffect | null;
  const devs = protocol.deviation_types?.length ? protocol.deviation_types : ALL_DEVIATION_TYPES;

  // Readiness, in the prototype's order.
  const missing: string[] = [];
  if (!protocol.scope) missing.push('assessment scope');
  if (!protocol.effect) missing.push('effect of interest');
  if (!src.loading && sourceForms.length === 0) missing.push('a result source');
  if (src.needMapping.length) missing.push(`${src.needMapping.length} form mapping${src.needMapping.length === 1 ? '' : 's'}`);
  if (!protocol.reviewers?.reviewer_1 || !protocol.reviewers?.reviewer_2) missing.push('two reviewers');
  if (protocol.effect && protocol.effect !== 'assignment' && !(protocol.deviation_types?.length)) missing.push('a deviation type');
  const ready = !src.loading && missing.length === 0;
  const canPress = confirmed || (ready && editable);

  const history = [...(protocol.history ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const pillCls = {
    bad: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
    warn: 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300',
    ok: 'border-[#e5e7eb] bg-white text-[#4b5563] dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-400',
    off: 'border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-300',
  };

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-4 pb-16">
      <button type="button" onClick={() => go({ screen: rob.protocolSet ? 'dashboard' : 'welcome' })}
        className="flex cursor-pointer items-center gap-1.5 self-start border-none bg-transparent p-0 text-[12px] text-[#6b7280] hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        Risk of Bias
      </button>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">Review protocol</h2>
        <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
          Pre-specified for the whole review. Set before the first assessment; changes afterwards are recorded as protocol deviations.
        </span>
      </div>

      <div className={cn('flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5',
        hasAssessments ? 'border-[#cbd5e1] bg-[#f8fafc] dark:border-slate-700 dark:bg-slate-800/20'
          : 'border-[#bbf7d0] bg-[#f0fdf4] dark:border-emerald-900 dark:bg-emerald-950/20')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
          className={hasAssessments ? 'text-[#475569] dark:text-slate-300' : 'text-[#15803d] dark:text-emerald-300'}>
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className={cn('flex-1 text-[12px] leading-[17px]', hasAssessments ? 'text-[#475569] dark:text-slate-300' : 'text-[#15803d] dark:text-emerald-300')}>
          {hasAssessments
            ? `${protocol.assessment_count} assessments exist. Changing effect of interest or scope now is a protocol deviation: it resets affected domains and is logged with a reason.`
            : 'No assessments yet. Set the protocol freely; it locks once the first assessment is saved.'}
        </span>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      </div>
      {!editable && (
        <Banner tone="gray">Read-only. Only a project owner or manager can change the review protocol.</Banner>
      )}

      <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        <SettingRow title="Tool by study design"
          help="Design is confirmed by the reviewer at each study’s first assessment; the tool follows">
          <div className="flex flex-col gap-1.5">
            {DESIGN_ORDER.map(d => (
              <div key={d} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-[130px] text-[#6b7280] dark:text-zinc-400">{DESIGN_SHORT[d]}</span>
                <Arrow />
                <span className="font-medium text-[#0a0a0a] dark:text-zinc-100">{TOOL_FOR_DESIGN[d]}</span>
                <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">
                  {designCounts[d] ? `${designCounts[d]} stud${designCounts[d] === 1 ? 'y' : 'ies'}` : 'none yet'}
                </span>
              </div>
            ))}
          </div>
        </SettingRow>

        <SettingRow title="Assessment scope" help="RoB 2 is defined per result">
          <div className="flex flex-col gap-2">
            <Seg<RobScope> value={protocol.scope} disabled={!editable || saving} maxWidth={360}
              options={[{ value: 'result', label: 'Result' }, { value: 'outcome', label: 'Outcome' }]}
              onChange={pickScope} />
            <span className="text-[11px] leading-4 text-[#6b7280] dark:text-zinc-400">
              {protocol.scope ? SCOPE_HELP[protocol.scope] : 'Not set. Choose how each assessment is attached.'}
            </span>
          </div>
        </SettingRow>

        <SettingRow title="Effect of interest" help="Drives the Domain 2 signalling questions">
          <div className="flex flex-col gap-2">
            <Seg<RobProtocolEffect> value={effectShown} disabled={!editable || saving} maxWidth={480}
              options={(['assignment', 'adherence', 'both'] as RobProtocolEffect[]).map(v => ({ value: v, label: EFFECT_OPTION_LABEL[v] }))}
              onChange={pickEffect} />
            <span className="text-[11px] leading-4 text-[#6b7280] dark:text-zinc-400">
              {effectShown ? EFFECT_HELP[effectShown] : 'Not set. Choose which effect the review question is about.'}{' '}
              <button type="button" onClick={() => setShowExplainer(v => !v)}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-medium text-[#374151] underline dark:text-zinc-300">
                {showExplainer ? 'Hide plain-language explanation' : 'Plain-language explanation'}
              </button>
            </span>
            {showExplainer && (
              <div className="flex max-w-[560px] flex-col gap-2 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3 text-[12px] leading-[17px] text-[#374151] dark:border-[#242424] dark:bg-[#0d0d0d] dark:text-zinc-300">
                <span><span className="font-semibold">Assignment (ITT).</span> What happens to people who are prescribed the intervention in practice, including those who stop, switch or forget. Everyone randomised stays in the arm they were assigned to. This is what most reviews want: a review of eczema creams for children asks whether prescribing the cream helps, whatever families then do with it.</span>
                <span><span className="font-semibold">Adhering (per-protocol).</span> What the intervention does when taken as directed. Of interest to patients deciding for themselves, and to screening reviews: “does attending screening reduce mortality for those who attend?” Estimating it properly needs special methods; simply dropping non-adherers is not one of them.</span>
                <span className="text-[#6b7280] dark:text-zinc-400">Under either effect, missing outcome data are handled in Domain 3, not here.</span>
              </div>
            )}
            <div className="flex max-w-[560px] flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-[#374151] dark:text-zinc-300">
                Anticipated deviations from intended intervention <span className="font-normal text-[#9ca3af] dark:text-zinc-500">· shown to reviewers at Q2.3</span>
              </span>
              <textarea value={anticipated} readOnly={!editable}
                onChange={e => setAnticipated(e.target.value)}
                onBlur={() => saveAnticipated(anticipated)}
                placeholder="List, in advance, the deviations reviewers should look for in this clinical area (trial-context deviations for the assignment effect; also adherence and co-interventions for the adhering effect)."
                className="min-h-[56px] w-full resize-y rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-2 text-[12px] leading-[17px] text-[#111827] outline-none placeholder:text-[#9ca3af] dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100" />
            </div>
            {effectShown !== null && effectShown !== 'assignment' && (
              <div className="flex max-w-[480px] flex-col gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5 dark:border-[#242424] dark:bg-[#0d0d0d]">
                <span className="text-[11px] font-semibold text-[#374151] dark:text-zinc-300">
                  Deviations addressed when assessing the effect of adhering <span className="font-normal text-[#9ca3af] dark:text-zinc-500">(at least one)</span>
                </span>
                {ALL_DEVIATION_TYPES.map(d => {
                  const on = devs.includes(d);
                  const last = on && devs.length === 1;
                  return (
                    <button key={d} type="button" disabled={!editable || saving}
                      onClick={() => toggleDeviation(d)}
                      title={last ? 'At least one deviation type must be addressed' : undefined}
                      className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 py-0.5 text-left disabled:cursor-not-allowed">
                      <Check on={on} className="h-3.5 w-3.5 rounded-[4px]" />
                      <span className="text-[12px] text-[#111827] dark:text-zinc-200">{DEVIATION_LABEL[d]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SettingRow>

        <SettingRow title="Tool version" help="Stamped on every assessment">
          <div className="flex flex-col gap-0.5 text-[13px]">
            <span className="font-medium text-[#0a0a0a] dark:text-zinc-100">RoB 2 · guidance 22 August 2019</span>
            <span className="text-[11px] text-[#6b7280] dark:text-zinc-400">
              Parallel-group template. Cluster and cross-over templates load their own domains (cluster adds 1b).
            </span>
          </div>
        </SettingRow>

        <SettingRow last={!ROB_AI_ENABLED} title="Reviewers" help="Two independent reviewers, then consensus; a consensus reviewer resolves disagreements">
          <div className="flex flex-col gap-2 text-[13px]">
            {SEATS.map(seat => {
              const holder = protocol.reviewers?.[seat] ?? null;
              const isEditing = editingSeat === seat;
              return (
                <div key={seat} className="grid grid-cols-[24px_110px_minmax(0,1fr)_auto] items-center gap-2.5">
                  <span className={cn('inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] text-[10px] font-semibold', SEAT_TAG[seat].cls)}>
                    {SEAT_TAG[seat].tag}
                  </span>
                  <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">{SEAT_LABEL[seat]}</span>
                  {isEditing ? (
                    <select value={holder ?? ''} disabled={saving}
                      onChange={e => quiet({ reviewers: { [seat]: e.target.value || null } })}
                      className="max-w-[260px] rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-[5px] text-[12px] text-[#111827] outline-none dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100">
                      {rob.members.map(m => (
                        <option key={m.user_id} value={m.user_id}
                          disabled={SEATS.some(s => s !== seat && protocol.reviewers?.[s] === m.user_id)}>
                          {m.full_name || m.email}
                        </option>
                      ))}
                      <option value="">Unassigned</option>
                    </select>
                  ) : (
                    <span className={cn('truncate font-medium', holder ? 'text-[#111827] dark:text-zinc-100' : 'text-[#475569] dark:text-slate-400')}>
                      {holder ? rob.nameOf(holder) + (holder === rob.currentUserId ? ' (you)' : '') : 'Unassigned'}
                    </span>
                  )}
                  {editable ? (
                    <button type="button" onClick={() => setEditingSeat(isEditing ? null : seat)}
                      className="cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-transparent px-2.5 py-[3px] text-[11px] font-medium text-[#374151] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]">
                      {isEditing ? 'Done' : 'Edit'}
                    </button>
                  ) : <span />}
                </div>
              );
            })}
            <span className="text-[11px] leading-4 text-[#6b7280] dark:text-zinc-400">
              R1 and R2 cannot see each other’s judgments until both complete. The consensus reviewer sees both and records the consensus judgment where they disagree; they do not assess independently.
            </span>
          </div>
        </SettingRow>

        {ROB_AI_ENABLED && (
          <SettingRow last title="AI suggestions" help="Answers to signalling questions with quotes from the paper; judgments stay with the reviewers">
            <div className="flex flex-col gap-2">
              <Seg<RobAiVisibility> value={aiVisibilityOf(protocol)} disabled={!editable || saving} maxWidth={560}
                options={(['off', 'cr_only', 'readers_and_cr'] as RobAiVisibility[]).map(v => ({ value: v, label: AI_VISIBILITY_LABEL[v] }))}
                onChange={v => quiet({ ai_visibility: v })} />
              <div className="flex max-w-[560px] flex-col gap-1">
                {(['off', 'cr_only', 'readers_and_cr'] as RobAiVisibility[]).map(v => (
                  <span key={v} className={cn('text-[11px] leading-4',
                    v === aiVisibilityOf(protocol) ? 'text-[#374151] dark:text-zinc-300' : 'text-[#9ca3af] dark:text-zinc-500')}>
                    <span className="font-semibold">{AI_VISIBILITY_LABEL[v]}.</span> {AI_VISIBILITY_HELP[v]}
                  </span>
                ))}
              </div>
            </div>
          </SettingRow>
        )}
      </div>

      {/* ── Result sources ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionHead right={`${sourceForms.length} of ${totalForms} forms · ${extractions} extractions`}>
          Result sources · which extraction forms produce results
        </SectionHead>
        <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
          <div className="flex items-center gap-1.5 border-b border-[#f3f4f6] px-5 py-2.5 text-[12px] leading-[17px] text-[#6b7280] dark:border-[#1a1a1a] dark:text-zinc-400">
            Tick the outcome forms whose rows become results.
            <span title="RoB 2 assesses one numerical result. Results are derived from the rows of the ticked forms. Untick a form whose rows duplicate another’s. Adding a source later derives new candidates only; existing assessments are kept."
              className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[#d4d4d8] text-[10px] text-[#9ca3af] dark:border-zinc-600">?</span>
          </div>
          {src.loading ? (
            <div className="flex items-center gap-2 border-b border-[#f3f4f6] px-5 py-3 text-[12px] text-[#6b7280] dark:border-[#1a1a1a]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the outcome forms…</div>
          ) : totalForms === 0 ? (
            <div className="border-b border-[#f3f4f6] px-5 py-3 text-[12px] text-[#6b7280] dark:border-[#1a1a1a] dark:text-zinc-500">No outcome form in this project can produce results yet.</div>
          ) : (
            <>
              {sourceForms.map(form => {
                const st = mappingState(form);
                const mapped = ROLE_LABEL.filter(([id]) => (form.mapping?.[id] ?? '').trim());
                const missingRoles = ROLE_LABEL.filter(([id, , req]) => req && !(form.mapping?.[id] ?? '').trim());
                const blockingN = Math.max((form.warnings ?? []).filter(w => w.severity === 'blocking').length, missingRoles.length);
                const blocked = st === 'blocked' || missingRoles.length > 0;
                const pr = producesOf(form.form_id);
                const produces = blocked
                  ? missingRoles.length
                    ? `Cannot derive results until ${missingRoles.map(([, l]) => l.toLowerCase()).join(' and ')} ${missingRoles.length === 1 ? 'is' : 'are'} mapped`
                    : ((form.warnings ?? []).find(w => w.severity === 'blocking')?.message ?? 'Cannot derive results until the mapping is fixed')
                  : `→ about ${pr.n} candidate results across ${pr.outcomes} outcome${pr.outcomes === 1 ? '' : 's'} · identity from ${mapped.map(([, l]) => l.toLowerCase()).join(', ')}`;
                const tone = blocked ? 'bad' : st === 'confirmed' ? 'ok' : 'warn';
                const label = blocked ? `${blockingN} must be fixed →` : st === 'confirmed' ? 'Mapping confirmed · review →' : 'Confirm mapping →';
                return (
                  <div key={form.form_id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[#f3f4f6] px-5 py-3 dark:border-[#1a1a1a]">
                    <SourceCheck on pending={src.pendingSources.has(form.form_id)} disabled={!editable}
                      onChange={v => src.toggleSource(form.form_id, v)} label={form.form_name} />
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{form.form_name}</span>
                        <span className="truncate text-[11px] text-[#9ca3af] dark:text-zinc-500">
                          {form.extractions} extractions · table {form.table} · {form.columns.length} columns
                        </span>
                      </div>
                      <span className={cn('text-[12px]', blocked ? 'text-[#b91c1c] dark:text-red-400' : 'text-[#374151] dark:text-zinc-300')}>{produces}</span>
                    </div>
                    <button type="button" onClick={() => go({ screen: 'mapping', form: form.form_id })}
                      className={cn('flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium leading-[22px]', pillCls[tone])}>
                      {label}
                    </button>
                  </div>
                );
              })}
              {excluded.map(ex => (
                <div key={ex.form_id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[#f3f4f6] px-5 py-3 opacity-70 dark:border-[#1a1a1a]">
                  <SourceCheck on={false} pending={src.pendingSources.has(ex.form_id)} disabled={!editable}
                    onChange={v => src.toggleSource(ex.form_id, v)} label={ex.form_name} />
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{ex.form_name}</span>
                    </div>
                    <span className="text-[12px] text-[#9ca3af] dark:text-zinc-500">Not a source: {ex.reason || 'unticked by manager'}</span>
                  </div>
                  <button type="button" disabled={!editable} onClick={() => src.toggleSource(ex.form_id, true)}
                    className={cn('flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium leading-[22px] disabled:cursor-not-allowed', pillCls.off)}>
                    Use as source
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">
              {src.needMapping.length
                ? 'Candidate results are derived once every ticked form is confirmed.'
                : `${rob.results.filter(r => r.state === 'active').length} results created · ${rob.results.filter(r => r.state === 'held' && !r.contrast).length} waiting for a comparison · ${protocol.assessment_count ?? 0} already assessed.`}
            </span>
            <div className="flex items-center gap-2">
              {editable && src.needMapping.length === 0 && src.creatable + src.newWaiting > 0 && (
                <button type="button" onClick={src.commit} disabled={src.committing}
                  className="flex cursor-pointer items-center gap-1 rounded-[6px] border-none bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#d4d4d8] dark:bg-zinc-100 dark:text-gray-900">
                  {src.committing && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create {src.creatable} result{src.creatable === 1 ? '' : 's'}
                  {src.newWaiting > 0 && ` · ${src.newWaiting} waiting for a comparison`}
                </button>
              )}
              <button type="button" onClick={() => setShowOthers(v => !v)} title="The project’s other extraction forms"
                className="cursor-pointer rounded-[6px] border border-dashed border-[#d4d4d8] bg-white px-2.5 py-1 text-[11px] font-medium text-[#374151] dark:border-zinc-600 dark:bg-transparent dark:text-zinc-300">
                + Add another form <span className="text-[#9ca3af] dark:text-zinc-500">· {otherForms} more in project</span>
              </button>
            </div>
          </div>
          {showOthers && (
            <div className="border-t border-[#f3f4f6] bg-[#fafafa] px-5 py-3 dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
              <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">Other forms in this project</div>
              {otherFormList.length === 0 && (
                <div className="mt-1.5 text-[12px] text-[#6b7280] dark:text-zinc-400">Every extraction form is already listed above.</div>
              )}
              {otherFormList.map(f => (
                <div key={f.id} className="mt-2 flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-[#111827] dark:text-zinc-100">{f.name}</span>
                  <span className="text-[12px] leading-[17px] text-[#6b7280] dark:text-zinc-400">Can’t be a result source: {f.reason}</span>
                </div>
              ))}
              <div className="mt-3 flex items-center gap-2 text-[12px] text-[#6b7280] dark:text-zinc-400">
                To add results, extract outcomes in a form whose table has an outcome column.
                <button type="button" onClick={() => router.push('/forms')}
                  className="cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-white px-2 py-[3px] text-[11px] font-medium text-[#374151] dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-300">
                  Open Forms →
                </button>
              </div>
            </div>
          )}
        </div>
        {src.needMapping.length > 0 && (
          <div className="flex items-center gap-3 rounded-[10px] border border-[#cbd5e1] bg-[#f8fafc] px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/20">
            <span className="flex-1 text-[12px] leading-[17px] text-[#475569] dark:text-slate-300">
              <span className="font-semibold">Column mapping needed:</span>{' '}
              {src.needMapping.map(f => f.form_name).join(', ')}. Every ticked form must be confirmed before its results can be created.
            </span>
            <button type="button" onClick={() => go({ screen: 'mapping', form: src.needMapping[0].form_id })}
              className="cursor-pointer whitespace-nowrap rounded-[6px] border border-[#cbd5e1] bg-white px-2.5 py-[5px] text-[12px] font-semibold text-[#475569] dark:border-slate-700 dark:bg-transparent dark:text-slate-300">
              Check it →
            </button>
          </div>
        )}
        {(duplicates.length > 0 || src.heldCount > 0) && (
          <Banner tone="slate">
            {duplicates.length > 0 && (
              <div>
                <strong className="font-semibold">{duplicates.length} duplicate result{duplicates.length === 1 ? '' : 's'} held.</strong>{' '}
                Two forms produced the same identity ({duplicates.slice(0, 2).map(d => d.from.join(' and ')).join('; ')}). Untick one of them as a source, or map a column that tells them apart. Nothing is merged.
              </div>
            )}
            {src.heldCount - duplicates.length > 0 && (
              <div className={duplicates.length ? 'mt-1' : ''}>
                <strong className="font-semibold">{src.heldCount - duplicates.length} candidate row{src.heldCount - duplicates.length === 1 ? '' : 's'} waiting on a comparison.</strong>{' '}
                These are multi-arm studies: create them, then open each study and use <strong className="font-semibold">Comparisons needed · Define →</strong> to say which arms are compared. Each comparison turns every waiting row into a result to assess.
              </div>
            )}
          </Banner>
        )}
        {src.build?.note && <Banner tone="gray">{src.build.note}</Banner>}
      </div>

      {/* ── Sticky footer ───────────────────────────────────────────────── */}
      <div className="sticky bottom-3 z-[5] flex items-center gap-3 rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,.04)] dark:border-[#1f1f1f] dark:bg-[#111111]">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className={cn('text-[13px] font-semibold',
            confirmed ? 'text-[#15803d] dark:text-emerald-400' : ready ? 'text-[#111827] dark:text-zinc-100' : 'text-[#475569] dark:text-slate-400')}>
            {confirmed ? 'Protocol confirmed' : ready ? 'Ready to confirm' : `Still missing: ${missing.join(', ')}`}
          </span>
          <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
            {confirmed
              ? 'Edits here are saved as you make them; changes after the first assessment are logged in the history below.'
              : 'Confirming writes the protocol to the project, logs it in the history below and opens the assessments dashboard.'}
          </span>
        </div>
        {savedAt && (
          <span className="flex items-center gap-1.5 text-[12px] text-[#9ca3af] dark:text-zinc-500">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
            Draft saved {savedAt}
          </span>
        )}
        <button type="button" disabled={!canPress || saving}
          onClick={async () => {
            if (confirmed) { go({ screen: 'dashboard' }); return; }
            try { await apply({ confirm: true }); go({ screen: 'dashboard' }); } catch { /* toasted */ }
          }}
          className={cn('flex h-9 items-center gap-1.5 rounded-[7px] border-none px-4 text-[13px] font-semibold text-white',
            canPress ? 'cursor-pointer bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900' : 'cursor-not-allowed bg-[#d4d4d8] dark:bg-zinc-700 dark:text-zinc-400')}>
          {confirmed ? 'Open assessments' : 'Confirm protocol & open assessments'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionHead>Protocol change history</SectionHead>
        <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
          {history.length === 0 ? (
            <div className="px-5 py-3 text-[12px] text-[#6b7280] dark:text-zinc-500">Nothing recorded yet. The protocol is logged here when it is first confirmed.</div>
          ) : history.map((h, i) => (
            <div key={i} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-[#f3f4f6] px-5 py-3 text-[12px] last:border-b-0 dark:border-[#1a1a1a]">
              <span className="text-[#9ca3af] dark:text-zinc-500">{formatWhen(h.at)}</span>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-[#111827] dark:text-zinc-100">{h.what}</span>
                {h.why && <span className="leading-4 text-[#6b7280] dark:text-zinc-400">{h.why}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {pending && (
        <ImpactDialog pending={pending} currentLabel={currentLabel}
          onCancel={() => setPending(null)}
          onApply={async reason => {
            const patch: RobProtocolPatch = pending.kind === 'scope' ? { scope: pending.scope, reason }
              : pending.kind === 'effect' ? { effect: pending.effect, reason }
                : { deviation_types: pending.deviations, reason };
            try { await apply(patch); setPending(null); } catch { /* toasted, dialog stays */ }
          }} />
      )}
    </div>
  );
}

function SourceCheck({ on, pending, disabled, onChange, label }: {
  on: boolean; pending: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string;
}) {
  if (pending) return <Loader2 className="h-4 w-4 animate-spin text-gray-400" />;
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={`Use ${label} as a source of results`}
      disabled={disabled} onClick={() => onChange(!on)}
      className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-[4px] p-0 disabled:cursor-not-allowed">
      <Check on={on} className="h-4 w-4 rounded-[4px]" />
    </button>
  );
}
