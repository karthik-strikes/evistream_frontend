'use client';

/**
 * Consensus — one assessment target, R1 and R2 side by side
 * (`?screen=consensus&study=&target=&domain=`; domain 1–5, 6 = Overall).
 *
 * Opened from a dashboard card whose consensus is "Needed · R2 differs", by
 * the protocol's consensus reviewer (seat `adjudicator`) or a manager, once
 * both readers completed — the server only releases their entries then.
 *
 * Agreement is judged after RoB 2's own equivalences (Y ≡ PY, N ≡ PN).
 * Agreed answers and judgments are pre-filled; disagreements are highlighted
 * and must each be settled before the consensus can be recorded. Only the
 * consensus judgments and support are reported; the readers' answers stay in
 * their own records for the appendix.
 *
 * The consensus is an ordinary schema-3 assessment saved on the consensus
 * record (`asConsensus`). It carries its own D1 (`d1Override`), so it never
 * depends on either reader's study-level answers. Drafts autosave; only
 * **Record consensus** marks it complete, and only a complete consensus
 * settles the card.
 *
 * With AI suggestions on (and the server releasing them to this caller), a
 * third "AI" column sits beside R1 and R2, with a filter for the questions
 * where the AI differs from both. Taking the AI's answer is logged on the
 * consensus entry's aiLog like any other AI decision.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { cn, getErrorMessage } from '@/lib/utils';

import {
  ANSWER_LABEL, isNo, isYes, signallingFor, type AnswerCode, type Answers,
} from '../_lib/rob2';
import {
  D1_QUESTIONS, DOMAIN_SHORT, DOMAIN_TITLE, JUDGEMENT_LABEL, emptyAssessment, mergedAnswers,
  isQuestionLog, targetTitle, type AiLogEntry, type AiLogItem, type Assessment, type Judgement, type RecordView,
  type StudyD1,
} from '../_lib/robModel';
import {
  AI_MODEL_LABEL, ROB_AI_ENABLED, aiVisibilityOf, isAiSupervisor, quoteLocator, suggestionsFrom,
} from '../_lib/robAi';
import { useRobAiDrafts, useRobAiRun } from '../_lib/useRobAi';
import { useRob } from '../_lib/useRobData';
import { scopeOf, targetById } from './dashboardModel';
import { Light, judgementText, judgementTextClass, useRobNav } from './robUi';

const PILL_ORDER: AnswerCode[] = ['Y', 'PY', 'PN', 'N', 'NI'];
const JUDGEMENTS: Judgement[] = ['low', 'some', 'high'];

interface Draft {
  answers: Answers;
  judg: (Judgement | null | undefined)[];
  support: (string | undefined)[];
  overall: Judgement | null;
  overallText: string;
  /** The consensus entry's AI decisions (carried from the stored entry). */
  aiLog: AiLogItem[];
}

const EMPTY_DRAFT: Draft = {
  answers: {}, judg: [undefined, undefined, undefined, undefined, undefined],
  support: [undefined, undefined, undefined, undefined, undefined], overall: null, overallText: '', aiLog: [],
};

function same(a: AnswerCode | null | undefined, b: AnswerCode | null | undefined): boolean {
  return a === b || (isYes(a) && isYes(b)) || (isNo(a) && isNo(b));
}

function supportOf(view: RecordView, a: Assessment, id: string): string {
  const shared = D1_QUESTIONS.includes(id) && !a.d1Override;
  return (shared ? view.d1.support[id] : a.support[id]) ?? '';
}

export function ConsensusScreen() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const { toast } = useToast();
  const studyId = get('study');
  const targetId = get('target');
  const step = Math.min(6, Math.max(1, Number(get('domain')) || 1));

  const target = studyId && targetId ? targetById(rob, studyId, targetId) : null;
  const r1Holder = rob.protocol.reviewers?.reviewer_1 ?? null;
  const r2Holder = rob.protocol.reviewers?.reviewer_2 ?? null;
  const r1View = r1Holder ? rob.viewOf(studyId, r1Holder) : null;
  const r2View = r2Holder ? rob.viewOf(studyId, r2Holder) : null;
  const r1 = r1View?.assessments.get(targetId) ?? null;
  const r2 = r2View?.assessments.get(targetId) ?? null;
  const consView = rob.viewOf(studyId, 'consensus');
  const stored = consView?.assessments.get(targetId) ?? null;
  const inScope = !target || target.kind === scopeOf(rob);
  const allowed = (rob.mySeat === 'adjudicator' || rob.canManage) && inScope;

  const effect = r1?.effect ?? rob.defaultEffect;
  const domains = signallingFor(effect);
  const r1Answers = useMemo(() => (r1 && r1View ? mergedAnswers(r1View.d1, r1) : {}), [r1, r1View]);
  const r2Answers = useMemo(() => (r2 && r2View ? mergedAnswers(r2View.d1, r2) : {}), [r2, r2View]);

  // ── Draft: load once per target, autosave on change ────────────────────────
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [version, setVersion] = useState(0);
  const loaded = useRef('');
  useEffect(() => {
    const key = `${studyId}|${targetId}`;
    if (loaded.current === key || rob.loading) return;
    loaded.current = key;
    if (stored && consView) {
      setDraft({
        answers: mergedAnswers(consView.d1, stored),
        judg: [...stored.judgement],
        support: [...stored.rationale],
        overall: stored.overall,
        overallText: stored.overallRationale,
        aiLog: [...(stored.aiLog ?? [])],
      });
    } else setDraft(EMPTY_DRAFT);
    setVersion(0);
  }, [studyId, targetId, stored, consView, rob.loading]);

  const update = (fn: (d: Draft) => Draft) => { setDraft(fn); setVersion(v => v + 1); };

  // ── What is agreed, what is open ──────────────────────────────────────────
  const model = useMemo(() => {
    const doms = domains.map((d, i) => {
      const rows = d.questions.filter(q => r1Answers[q.id] || r2Answers[q.id]).map(q => {
        const a1 = (r1Answers[q.id] ?? null) as AnswerCode | null;
        const a2 = (r2Answers[q.id] ?? null) as AnswerCode | null;
        const agree = !!a1 && !!a2 && same(a1, a2);
        const consA = (draft.answers[q.id] ?? (agree ? a1 : null)) as AnswerCode | null;
        return { id: q.id, text: q.text, a1, a2, agree, consA };
      });
      const j1 = r1?.judgement[i] ?? null;
      const j2 = r2?.judgement[i] ?? null;
      const agreeJ = j1 === j2;
      const consJ = (draft.judg[i] ?? (agreeJ ? j1 : null)) as Judgement | null;
      const open = rows.filter(r => !r.agree && !r.consA).length + (!agreeJ && !consJ ? 1 : 0);
      const differs = rows.filter(r => !r.agree).length + (agreeJ ? 0 : 1);
      const support = draft.support[i] !== undefined ? draft.support[i]! : (agreeJ ? r1?.rationale[i] ?? '' : '');
      const title = i === 1
        ? `${DOMAIN_TITLE[1]} (effect of ${effect === 'adherence' ? 'adhering to' : 'assignment to'} intervention)`
        : DOMAIN_TITLE[i];
      return { i, num: i + 1, label: DOMAIN_SHORT[i], title, rows, j1, j2, agreeJ, consJ, open, differs, support };
    });
    const o1 = r1?.overall ?? null;
    const o2 = r2?.overall ?? null;
    const overallAgree = o1 === o2;
    const overall = draft.overall ?? (overallAgree ? o1 : null);
    const openTotal = doms.reduce((n, x) => n + x.open, 0) + (!overallAgree && !overall ? 1 : 0);
    const diffTotal = doms.reduce((n, x) => n + x.differs, 0) + (overallAgree ? 0 : 1);
    return { doms, o1, o2, overallAgree, overall, openTotal, diffTotal };
  }, [domains, r1Answers, r2Answers, r1, r2, draft, effect]);

  const canRecord = model.openTotal === 0 && !!model.overall;

  // ── AI (only when the server releases answers to this caller) ─────────────
  const aiOn = ROB_AI_ENABLED && aiVisibilityOf(rob.protocol) !== 'off' && allowed && !!target
    && isAiSupervisor(rob.mySeat, rob.canManage);
  const aiQ = useRobAiDrafts({ projectId: rob.projectId, documentId: studyId, targetId, enabled: aiOn });
  const aiSug = useMemo(() => (aiOn ? suggestionsFrom(aiQ.data) : {}), [aiOn, aiQ.data]);
  const showAi = Object.keys(aiSug).length > 0;
  const [aiDiffOnly, setAiDiffOnly] = useState(false);
  // Normally already run on consensus_ready; this is the idempotent fallback.
  const { trigger: triggerAi } = useRobAiRun();
  const aiOpened = useRef('');
  useEffect(() => {
    const key = `${studyId}|${targetId}`;
    if (!aiOn || aiOpened.current === key) return;
    aiOpened.current = key;
    triggerAi({ project_id: rob.projectId, document_id: studyId, target_id: targetId, trigger: 'opened' });
  }, [aiOn, studyId, targetId, triggerAi, rob.projectId]);

  // ── Saving ────────────────────────────────────────────────────────────────
  const build = useCallback((complete: boolean): { study: StudyD1; assessment: Assessment } | null => {
    if (!target || !r1) return null;
    // Build on the stored consensus entry when there is one, so whatever it
    // carries beyond the consensus decisions (per-question support and quotes,
    // sources, location, revisions, AI log) survives every autosave. Only the
    // consensus decisions below are overwritten.
    const a: Assessment = stored
      ? {
        ...stored,
        answers: { ...stored.answers }, support: { ...stored.support }, quotes: { ...stored.quotes },
        judgement: [...stored.judgement], rationale: [...stored.rationale], direction: [...stored.direction],
        sourcesObtained: [...stored.sourcesObtained], revisions: [...stored.revisions],
      }
      : emptyAssessment(
        { id: target.id, kind: target.kind, label: targetTitle(target), resultVersion: r1.resultVersion },
        effect, r1.deviations);
    a.label = targetTitle(target);
    a.d1Override = true;
    a.prelimConfirmed = true;
    if (!a.experimental) a.experimental = r1.experimental;
    if (!a.comparator) a.comparator = r1.comparator;
    for (const d of model.doms) for (const r of d.rows) if (r.consA) a.answers[r.id] = r.consA;
    a.judgement = model.doms.map(d => d.consJ);
    a.rationale = model.doms.map(d => d.support);
    a.overall = model.overall;
    a.overallRationale = draft.overallText;
    if (draft.aiLog.length) a.aiLog = draft.aiLog;
    a.complete = complete;
    const d1: Answers = {};
    for (const id of D1_QUESTIONS) if (a.answers[id]) d1[id] = a.answers[id];
    return { study: { answers: d1, support: {}, quotes: {} }, assessment: a };
  }, [target, r1, stored, effect, model, draft.overallText, draft.aiLog]);

  const [saving, setSaving] = useState(false);
  const saveNow = useCallback(async (complete: boolean) => {
    const built = build(complete);
    if (!built || !allowed) return;
    setSaving(true);
    try {
      await rob.save({ documentId: studyId, study: built.study, assessment: built.assessment, asConsensus: true });
    } finally {
      setSaving(false);
    }
  }, [build, allowed, rob, studyId]);

  const savedVersion = useRef(0);
  useEffect(() => {
    if (version === 0 || version <= savedVersion.current || !allowed) return;
    const at = version;
    const t = setTimeout(() => {
      saveNow(false).then(() => { savedVersion.current = at; }).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, [version, saveNow, allowed]);

  const exit = async () => {
    if (allowed && version > savedVersion.current) {
      try { await saveNow(false); } catch (e) {
        toast({ title: 'Save failed', description: getErrorMessage(e), variant: 'error' });
        return;
      }
    }
    go({ screen: 'dashboard', study: studyId, target: null, domain: null, as: null });
  };

  const record = async () => {
    if (!canRecord || !allowed) return;
    try {
      await saveNow(true);
      savedVersion.current = version;
      toast({ title: 'Consensus recorded', variant: 'success' });
      go({ screen: 'dashboard', study: studyId, target: null, domain: null, as: null, tab: null });
    } catch (e) {
      toast({ title: 'Could not record consensus', description: getErrorMessage(e), variant: 'error' });
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  const note = (text: string) => (
    <div className="flex flex-col gap-3">
      <div className="rounded-[12px] border border-[#e5e7eb] bg-white px-5 py-6 text-center text-[13px] text-[#6b7280] dark:border-[#1f1f1f] dark:bg-[#111111] dark:text-zinc-400">{text}</div>
      <button type="button" onClick={() => go({ screen: 'dashboard', study: studyId, target: null, domain: null, as: null })}
        className="self-center rounded-[7px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#111827] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
        Back to study
      </button>
    </div>
  );
  if (!target) return note('This assessment target no longer exists.');
  // The protocol scope decides what may be assessed; a target of the other
  // scope is not in this review and is never loaded or saved here.
  if (target.kind !== scopeOf(rob)) {
    return note(`This is ${target.kind === 'outcome' ? 'an outcome' : 'a result'}-level assessment, which is not in this review protocol's scope (${scopeOf(rob)}). It is kept but cannot be edited here.`);
  }
  if (!r1 || !r2) return note('Both reviewers must complete this assessment before consensus can be recorded.');

  const cd = model.doms[Math.min(step, 5) - 1];
  const r1Name = rob.nameOf(r1Holder);
  const r2Name = rob.nameOf(r2Holder);
  const crHolder = rob.protocol.reviewers?.adjudicator ?? null;
  const crName = crHolder ? rob.nameOf(crHolder) : 'No consensus reviewer';
  const progress = model.openTotal
    ? `${model.openTotal} of ${model.diffTotal} disagreement${model.diffTotal === 1 ? '' : 's'} still to resolve`
    : `All ${model.diffTotal} disagreement${model.diffTotal === 1 ? '' : 's'} resolved`;
  const readOnly = !allowed;

  const setAnswer = (id: string, v: AnswerCode | null) => update(d => ({ ...d, answers: { ...d.answers, [id]: v ?? undefined } }));
  const aiDiffers = (r: { id: string; a1: AnswerCode | null; a2: AnswerCode | null }) => {
    const ai = aiSug[r.id];
    return !!ai && !same(ai.answer, r.a1) && !same(ai.answer, r.a2);
  };
  const takeAi = (r: { id: string; consA: AnswerCode | null }) => {
    const ai = aiSug[r.id];
    if (!ai) return;
    const entry: AiLogEntry = {
      kind: 'question', question: r.id, action: 'accepted', ai_answer: ai.answer,
      human_answer_before: r.consA, final_answer: ai.answer,
      evidence: { quotes: ai.quotes.map(q => ({ text: q.text, page: q.page })), strength: ai.strength },
      draft_id: ai.draftId || null, seat: rob.mySeat ?? 'manager', at: new Date().toISOString(),
      model: aiQ.data?.domains.find(x => x.domain === ai.domain)?.model || AI_MODEL_LABEL,
    };
    update(d => ({
      ...d,
      answers: { ...d.answers, [r.id]: ai.answer },
      aiLog: [...d.aiLog.filter(e => !(isQuestionLog(e) && e.question === r.id && e.action === 'accepted')), entry],
    }));
  };
  const setJudg = (i: number, j: Judgement) => update(d => { const judg = [...d.judg]; judg[i] = j; return { ...d, judg }; });
  const setSupport = (i: number, t: string) => update(d => { const support = [...d.support]; support[i] = t; return { ...d, support }; });
  const takeJudgement = (i: number, from: Assessment) => update(d => {
    const judg = [...d.judg]; const support = [...d.support];
    judg[i] = from.judgement[i]; support[i] = from.rationale[i] ?? '';
    return { ...d, judg, support };
  });
  const goStep = (n: number) => go({ domain: n });

  const algo = (() => {
    const js = model.doms.map(x => x.consJ);
    if (!js.every(Boolean)) return 'Resolve every domain first.';
    const some = js.filter(j => j === 'some').length;
    return js.includes('high') ? 'Algorithm: High (a domain is at high risk)'
      : some ? `Algorithm: Some concerns (${some} domain${some > 1 ? 's' : ''})` : 'Algorithm: Low (all domains low)';
  })();
  const foot = canRecord
    ? 'Only the consensus judgments and support are reported. Reviewer answers are kept for the appendix.'
    : model.openTotal ? 'Resolve every disagreement, then record.' : 'Set the overall judgment to record.';

  // ── Pieces ────────────────────────────────────────────────────────────────
  const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500';
  const SMALL_BTN = 'rounded-[6px] border border-[#e5e7eb] bg-white px-2 py-[3px] text-[11px] font-semibold text-[#374151] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300';
  const GRID = showAi
    ? 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-[14px]'
    : 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-[14px]';
  const aiRowsDiffering = showAi ? cd.rows.filter(aiDiffers).length : 0;
  const shownRows = showAi && aiDiffOnly ? cd.rows.filter(aiDiffers) : cd.rows;

  const seatDot = (tag: string, cls: string) => (
    <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded-full font-semibold', cls)}>{tag}</span>
  );

  const reviewerCard = (who: 'R1' | 'R2', name: string, j: Judgement | null, text: string, onUse?: () => void, useLabel?: string) => (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#e5e7eb] px-3 py-2.5 dark:border-[#2a2a2a]">
      <span className={EYEBROW}>{who} · {name}</span>
      <div className="flex items-center gap-2">
        <Light j={j} size={20} />
        <span className={cn('text-[13px] font-semibold', judgementTextClass(j))}>{judgementText(j)}</span>
      </div>
      <span className="text-[12px] leading-[17px] text-[#6b7280] dark:text-zinc-400">{text}</span>
      {onUse && !readOnly && (
        <button type="button" onClick={onUse} className={cn(SMALL_BTN, 'self-start')}>{useLabel}</button>
      )}
    </div>
  );

  const picker = (value: Judgement | null, onPick: (j: Judgement) => void) => (
    <div className="grid grid-cols-3 gap-2">
      {JUDGEMENTS.map(j => {
        const on = value === j;
        const ring = j === 'low' ? 'border-[#16a34a]' : j === 'some' ? 'border-[#64748b]' : 'border-[#dc2626]';
        return (
          <button key={j} type="button" disabled={readOnly} onClick={() => onPick(j)}
            className={cn('flex items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 py-2.5 text-left disabled:cursor-not-allowed',
              on ? cn('bg-[#f9fafb] dark:bg-[#161616]', ring) : 'border-[#e5e7eb] bg-white dark:border-[#2a2a2a] dark:bg-[#111111]')}>
            <Light j={j} size={22} />
            <span className="text-[13px] font-semibold text-[#111827] dark:text-zinc-100">{JUDGEMENT_LABEL[j]}</span>
          </button>
        );
      })}
    </div>
  );

  const TEXTAREA = 'min-h-[56px] w-full resize-y rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 py-2 text-[12px] leading-[17px] text-[#111827] outline-none placeholder:text-[#9ca3af] read-only:bg-[#fafafa] dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100';

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-4 rounded-[12px] border border-[#e5e7eb] bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#111111]">
        <button type="button" onClick={exit} aria-label="Back to study"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{rob.labelOf(studyId)}</span>
            <span className="text-[#d4d4d8]">·</span>
            <span className="truncate text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{targetTitle(target)}</span>
            <span className="rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-2 text-[11px] font-medium leading-5 text-[#4338ca] dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">Consensus</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#6b7280] dark:text-zinc-400">
            <span className="inline-flex items-center gap-[5px]">{seatDot('R1', 'bg-[#0a0a0a] text-[8px] text-white dark:bg-zinc-100 dark:text-gray-900')}{r1Name}</span>
            <span className="inline-flex items-center gap-[5px]">{seatDot('R2', 'bg-[#e5e7eb] text-[8px] text-[#374151] dark:bg-zinc-700 dark:text-zinc-200')}{r2Name}</span>
            <span className="text-[#d4d4d8]">·</span>
            <span className="inline-flex items-center gap-[5px]">
              {seatDot('CR', 'border-[1.5px] border-[#c7d2fe] bg-white text-[7px] text-[#4338ca] dark:border-indigo-800 dark:bg-transparent dark:text-indigo-300')}
              {crName}{rob.mySeat === 'adjudicator' ? ' · you' : ''}
            </span>
          </div>
        </div>
        <span className={cn('text-[12px] font-medium', model.openTotal ? 'text-[#475569] dark:text-slate-300' : 'text-[#15803d] dark:text-emerald-400')}>
          {saving ? 'Saving…' : progress}
        </span>
        <button type="button" onClick={exit}
          className="h-8 rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#111827] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
          {readOnly ? 'Exit' : 'Save & exit'}
        </button>
      </div>

      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-5">
        {/* Rail */}
        <div className="sticky top-4 flex flex-col gap-1">
          <div className="mb-1.5 px-3 text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">Domains</div>
          {model.doms.map(x => {
            const on = step === x.num;
            const status = x.open ? `${x.open} to resolve` : x.differs ? 'Resolved' : 'Agreed';
            return (
              <button key={x.num} type="button" onClick={() => goStep(x.num)}
                className={cn('flex items-center gap-2.5 rounded-[8px] px-3 py-[9px] text-left', on ? 'bg-[#f3f4f6] dark:bg-[#1a1a1a]' : 'bg-transparent')}>
                <Light j={x.consJ} size={18} active={on} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className={cn('text-[13px] text-[#111827] dark:text-zinc-100', on ? 'font-semibold' : 'font-medium')}>{x.label}</span>
                  <span className={cn('text-[11px]', x.open ? 'text-[#475569] dark:text-slate-300' : x.differs ? 'text-[#15803d] dark:text-emerald-400' : 'text-[#9ca3af]')}>{status}</span>
                </span>
              </button>
            );
          })}
          {(() => {
            const on = step === 6;
            const openO = !model.overallAgree && !model.overall;
            return (
              <button type="button" onClick={() => goStep(6)}
                className={cn('flex items-center gap-2.5 rounded-[8px] px-3 py-[9px] text-left', on ? 'bg-[#f3f4f6] dark:bg-[#1a1a1a]' : 'bg-transparent')}>
                <Light j={model.overall} size={18} active={on} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className={cn('text-[13px] text-[#111827] dark:text-zinc-100', on ? 'font-semibold' : 'font-medium')}>Overall</span>
                  <span className={cn('text-[11px]', openO ? 'text-[#475569] dark:text-slate-300' : model.overallAgree ? 'text-[#9ca3af]' : 'text-[#15803d] dark:text-emerald-400')}>
                    {openO ? '1 to resolve' : model.overallAgree ? 'Agreed' : 'Resolved'}
                  </span>
                </span>
              </button>
            );
          })()}
          <div className="mt-2.5 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5 text-[11px] leading-4 text-[#6b7280] dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-400">
            Both reviewers have completed. Their answers are now visible side by side; agreements are pre-filled, disagreements are highlighted.
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {step <= 5 ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">Domain {cd.num}</span>
                <h2 className="m-0 text-[18px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">{cd.title}</h2>
                <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
                  {cd.open ? `${cd.open} to resolve` : cd.differs ? 'Resolved' : 'Reviewers agree'}
                </span>
              </div>
              {showAi && (
                <div className="flex items-center gap-2">
                  {([false, true] as const).map(on => (
                    <button key={String(on)} type="button" onClick={() => setAiDiffOnly(on)}
                      className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        aiDiffOnly === on ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                          : 'border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300')}>
                      {on ? `Where AI differs from both · ${aiRowsDiffering}` : 'All questions'}
                    </button>
                  ))}
                  <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">AI answers are suggestions; the engine, not the AI, derives judgments.</span>
                </div>
              )}

              <div className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
                <div className={cn(GRID, 'border-b border-[#e5e7eb] bg-[#f9fafb] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-500')}>
                  <span>Signalling question</span><span>R1 · {r1Name}</span><span>R2 · {r2Name}</span>{showAi && <span>AI</span>}<span>Consensus</span>
                </div>
                {cd.rows.length === 0 && (
                  <div className="px-5 py-4 text-[12px] text-[#9ca3af]">Neither reviewer answered a question in this domain.</div>
                )}
                {cd.rows.length > 0 && shownRows.length === 0 && (
                  <div className="px-5 py-4 text-[12px] text-[#9ca3af]">The AI agrees with at least one reviewer on every question in this domain.</div>
                )}
                {shownRows.map(r => (
                  <div key={r.id} className={cn(GRID, 'items-start border-b border-[#f3f4f6] px-5 py-3 last:border-b-0 dark:border-[#1a1a1a]',
                    r.agree ? 'bg-white dark:bg-[#111111]' : 'bg-[#f8fafc] dark:bg-slate-800/30')}>
                    <div className="flex gap-2">
                      <span className="w-[26px] shrink-0 text-[12px] font-semibold text-[#9ca3af]">{r.id}</span>
                      <span className="text-[13px] leading-[19px] text-[#111827] dark:text-zinc-100">{r.text}</span>
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{r.a1 ? ANSWER_LABEL[r.a1] : 'Not asked'}</span>
                      <span className="text-[11px] leading-[15px] text-[#6b7280] dark:text-zinc-400">{supportOf(r1View!, r1, r.id)}</span>
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{r.a2 ? ANSWER_LABEL[r.a2] : 'Not asked'}</span>
                      <span className="text-[11px] leading-[15px] text-[#6b7280] dark:text-zinc-400">{supportOf(r2View!, r2, r.id)}</span>
                    </div>
                    {showAi && (() => {
                      const ai = aiSug[r.id];
                      if (!ai) return <span className="text-[12px] text-[#9ca3af] dark:text-zinc-500">—</span>;
                      const q = ai.quotes[0];
                      return (
                        <div className="flex flex-col gap-[3px]">
                          <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">
                            {ANSWER_LABEL[ai.answer]}
                            <span className={cn('ml-1.5 text-[11px] font-medium', ai.strength === 'Strong' ? 'text-[#15803d] dark:text-emerald-400' : 'text-[#475569] dark:text-slate-300')}>{ai.strength}</span>
                          </span>
                          {q && (
                            <span className="text-[11px] italic leading-[15px] text-[#6b7280] dark:text-zinc-400" title={q.text}>
                              “{q.text.length > 120 ? `${q.text.slice(0, 117).trimEnd()}…` : q.text}”{quoteLocator(q) ? ` ${quoteLocator(q)}` : ''}
                            </span>
                          )}
                          {!q && ai.rationale && <span className="text-[11px] leading-[15px] text-[#6b7280] dark:text-zinc-400">{ai.rationale}</span>}
                          {(ai.conflicting || ai.variesAcross.length > 0) && (
                            <span className="text-[11px] text-[#475569] dark:text-slate-400">
                              {[ai.conflicting ? 'Report conflicts' : '', ai.variesAcross.length ? `Differs for ${ai.variesAcross.map(v => `${v.label} (${v.answer})`).join(', ')}` : ''].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex flex-col gap-1.5">
                      <span className={cn('text-[13px] font-semibold', r.consA ? 'text-[#111827] dark:text-zinc-100' : 'text-[#475569] dark:text-slate-300')}>
                        {r.consA ? ANSWER_LABEL[r.consA] : 'Unresolved'}
                      </span>
                      {!r.agree && !readOnly && (
                        <>
                          <div className="flex flex-wrap gap-1">
                            {r.a1 && <button type="button" onClick={() => setAnswer(r.id, r.a1)} className={SMALL_BTN}>Use R1</button>}
                            {r.a2 && <button type="button" onClick={() => setAnswer(r.id, r.a2)} className={SMALL_BTN}>Use R2</button>}
                            {showAi && aiSug[r.id] && <button type="button" onClick={() => takeAi(r)} className={SMALL_BTN}>Use AI</button>}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {PILL_ORDER.filter(k => !(k === 'NI' && r.id === '3.2')).map(k => {
                              const on = r.consA === k;
                              return (
                                <button key={k} type="button" onClick={() => setAnswer(r.id, k)}
                                  className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                    on ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                                      : 'border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300')}>
                                  {ANSWER_LABEL[k]}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3.5 rounded-[12px] border border-[#e5e7eb] bg-white px-5 py-[18px] dark:border-[#1f1f1f] dark:bg-[#111111]">
                <span className="text-[14px] font-semibold text-[#0a0a0a] dark:text-zinc-100">Domain {cd.num} judgment</span>
                <div className="grid grid-cols-2 gap-2.5">
                  {reviewerCard('R1', r1Name, cd.j1, r1.rationale[cd.i] ?? '', !cd.agreeJ ? () => takeJudgement(cd.i, r1) : undefined, 'Use R1 judgment & support')}
                  {reviewerCard('R2', r2Name, cd.j2, r2.rationale[cd.i] ?? '', !cd.agreeJ ? () => takeJudgement(cd.i, r2) : undefined, 'Use R2 judgment & support')}
                </div>
                <div className="flex flex-col gap-2">
                  <span className={EYEBROW}>Consensus judgment</span>
                  {picker(cd.consJ, j => setJudg(cd.i, j))}
                </div>
                <textarea value={cd.support} readOnly={readOnly} onChange={e => setSupport(cd.i, e.target.value)}
                  placeholder="Consensus support for judgment (this is what the review reports)" className={TEXTAREA} />
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => goStep(Math.max(1, step - 1))}
                    className="h-[34px] rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
                    ← Previous
                  </button>
                  <button type="button" onClick={() => goStep(Math.min(6, step + 1))}
                    className="h-[34px] rounded-[7px] bg-[#0a0a0a] px-3.5 text-[13px] font-semibold text-white dark:bg-zinc-100 dark:text-gray-900">
                    {step === 5 ? 'Overall →' : `Domain ${step + 1} →`}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">Overall</span>
                <h2 className="m-0 text-[18px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">Consensus overall risk of bias</h2>
                <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">{algo}</span>
              </div>
              <div className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
                {model.doms.map(x => (
                  <div key={x.num} className="flex items-center gap-3.5 border-b border-[#f3f4f6] px-5 py-3 last:border-b-0 dark:border-[#1a1a1a]">
                    <span className="w-[26px] text-[12px] font-semibold text-[#9ca3af]">D{x.num}</span>
                    <span className="flex-1 text-[13px] text-[#0a0a0a] dark:text-zinc-100">{x.title}</span>
                    <Light j={x.consJ} size={22} />
                    <span className={cn('w-[130px] text-[13px] font-semibold', judgementTextClass(x.consJ))}>{judgementText(x.consJ)}</span>
                    <button type="button" onClick={() => goStep(x.num)}
                      className="rounded-[6px] border border-[#e5e7eb] bg-transparent px-2 py-[3px] text-[11px] font-medium text-[#6b7280] dark:border-[#2a2a2a] dark:text-zinc-400">
                      Review
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-3.5 rounded-[12px] border border-[#e5e7eb] bg-white px-5 py-[18px] dark:border-[#1f1f1f] dark:bg-[#111111]">
                <div className="grid grid-cols-2 gap-2.5">
                  {reviewerCard('R1', r1Name, model.o1, r1.overallRationale)}
                  {reviewerCard('R2', r2Name, model.o2, r2.overallRationale)}
                </div>
                <div className="flex flex-col gap-2">
                  <span className={EYEBROW}>Consensus overall judgment</span>
                  {picker(model.overall, j => update(d => ({ ...d, overall: j })))}
                </div>
                <textarea value={draft.overallText} readOnly={readOnly} onChange={e => update(d => ({ ...d, overallText: e.target.value }))}
                  placeholder="Consensus overall support (reported in the review)" className={TEXTAREA} />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">{readOnly ? 'Only the consensus reviewer or a project manager can record consensus.' : foot}</span>
                  <button type="button" onClick={record} disabled={!canRecord || readOnly || saving}
                    className={cn('h-9 rounded-[7px] px-4 text-[13px] font-semibold text-white',
                      canRecord && !readOnly ? 'cursor-pointer bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900' : 'cursor-not-allowed bg-[#d4d4d8] dark:bg-zinc-700')}>
                    Record consensus
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
