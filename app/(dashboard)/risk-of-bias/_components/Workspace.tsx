'use client';

/**
 * The assessment workspace: Preliminary considerations → Domains 1–5 → Overall.
 *
 * Every route, count and suggested judgement comes from `rob2.ts` through
 * `robModel.derive`; this screen only records what the reviewer answers and
 * decides. The judgement is the reviewer's own pick, and one that differs from
 * the algorithm cannot be confirmed without a written rationale.
 *
 * Storage split (see robModel): Domain 1 is the STUDY's, shared by every
 * assessment of it unless this one overrides; everything else is this
 * assessment's. Consensus is recorded on its own screen (ConsensusScreen).
 *
 * A target must match the protocol's scope: under outcome scope a result-level
 * target (e.g. a deep link) opens read-only and is never loaded or saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Info, Loader2 } from 'lucide-react';

import { cn, getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { boxesFromLocation } from '@/lib/sourceBoxes';
import { SourceEvidenceDrawer } from '@/components/source-evidence/SourceEvidenceDrawer';
import type { SelectedQuote, SourceMarker } from '@/components/PdfHighlightViewer';
import {
  ANSWER_LABEL, routeAllFor, signallingFor, type AnswerCode, type Answers, type SignallingQuestion,
} from '../_lib/rob2';
import {
  D1_QUESTIONS, DOMAIN_SHORT, DOMAIN_TITLE, EFFECT_SHORT, EMPTY_D1, JUDGEMENT_LABEL,
  SOURCE_OPTIONS, TOOL_FOR_DESIGN, conditionPrefix, derive, designAssessable,
  emptyAssessment, isOutcomeKey, isQuestionLog, mergedAnswers, normaliseOutcome, outcomeTarget, pathwayOf,
  resultTarget, targetTitle, type AiLogEntry, type Assessment, type Direction, type Judgement, type QuoteRef,
  type StudyD1, type Target,
} from '../_lib/robModel';
import { guidanceFor } from '../_lib/robGuidance';
import {
  AI_MODEL_LABEL, ROB_AI_ENABLED, aiDomainSuggestion, aiOverallSuggestion, aiVisibilityOf, isAiSupervisor,
  quoteLocator, runPhase, sameAnswer, suggestionsFrom, type AiQuote, type AiSuggestion,
} from '../_lib/robAi';
import { useRobAiDrafts, useRobAiRun } from '../_lib/useRobAi';
import { useRob } from '../_lib/useRobData';
import {
  Banner, BackLink, Eyebrow, OutlineButton, PrimaryButton, SeatBadge, judgementText,
  judgementTextClass, Light, useRobNav,
} from './robUi';
import { scopeOf } from './dashboardModel';
import { DomainRail, EvidencePanel, TargetPanel, type Passage, type RailItem } from './workspace/Rails';
import { JudgementCard, QuestionCard } from './workspace/parts';
import {
  AiAuditCard, AiHeaderControl, AiHiddenStrip, AiJudgementRow, AiNotFoundStrip, AiQuestionStrip, aiTally,
  decisions,
} from './workspace/AiParts';
import { Preliminary } from './workspace/Preliminary';
import { useWorkspaceDraft, type Draft } from './workspace/useWorkspaceDraft';

const isD1 = (id: string) => id.startsWith('1.');

function sev(s: string | null | undefined): Judgement | null {
  return s === 'low' || s === 'some' || s === 'high' ? s : null;
}

const D2_FRAME = {
  assignment: 'Effect of assignment to intervention (ITT). Only deviations that arose because of the trial '
    + 'context count here. Stopping treatment for reasons that would also occur in routine care is part of the '
    + 'effect of assignment, not a deviation. Answer for this trial on its own evidence.',
  adherence: 'Effect of adhering to intervention. Deviations from the intended intervention are considered '
    + 'broadly, limited to the deviation types pre-specified in the protocol. The analysis should estimate the '
    + 'effect of adhering.',
};

export function Workspace() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const { toast } = useToast();

  const targetId = get('target');
  const studyParam = get('study');
  const step = Math.min(6, Math.max(0, Number(get('domain') || 0) || 0));

  // ── Target ─────────────────────────────────────────────────────────────────

  const target: Target | null = useMemo(() => {
    if (!targetId) return null;
    if (isOutcomeKey(targetId)) {
      if (!studyParam) return null;
      const o = rob.outcomesOfDoc(studyParam).find(x => x.key === targetId);
      return o ? outcomeTarget(o) : null;
    }
    const r = rob.resultById.get(targetId);
    return r ? resultTarget(r) : null;
  }, [targetId, studyParam, rob]);

  const documentId = target?.documentId ?? studyParam;
  const studyLabel = documentId ? rob.labelOf(documentId) : '';
  const result = target?.result ?? null;
  const scope = scopeOf(rob);
  /** The target belongs to the protocol's scope; anything else is hidden, never edited. */
  const inScope = !!target && target.kind === scope;

  // ── Draft ──────────────────────────────────────────────────────────────────

  const loadKey = !rob.loading && target && inScope ? `${documentId}|${target.id}|m` : '';

  const initial = useCallback((): Draft | null => {
    if (!target || !documentId) return null;
    const view = rob.myView(documentId);
    const existing = view?.assessments.get(target.id);
    const effect = rob.defaultEffect;
    const deviations = [...(rob.protocol.deviation_types ?? [])];
    const study: StudyD1 = view?.d1 ?? EMPTY_D1;
    const assessment: Assessment = existing
      ? { ...existing }
      : emptyAssessment({ id: target.id, kind: target.kind, resultVersion: result?.version ?? null },
        effect, deviations);
    assessment.label = targetTitle(target);
    if (assessment.resultVersion === null && result?.version) assessment.resultVersion = result.version;

    return { study, assessment };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, rob.records]);

  const onReopened = useCallback((n: number) => {
    toast({
      title: `${n} completed assessment${n === 1 ? '' : 's'} reopened`,
      description: 'They were judged on this study’s Domain 1 answers, which you just changed. Nothing was deleted.',
      variant: 'warning',
    });
  }, [toast]);

  const { draft, update, flush, saveState, savedAt } = useWorkspaceDraft({
    loadKey, initial, save: rob.save, documentId, onReopened,
  });

  const d = useMemo(() => (draft ? derive(draft.study, draft.assessment) : null), [draft]);
  const a = draft?.assessment ?? null;

  const { design, confirmed: designConfirmed } = rob.designOf(documentId);
  const designBlocked = designConfirmed && !designAssessable(design);
  // The study's design (and a result's comparison) are settled in Preliminary
  // before any signalling question is answered — the design picks the tool.
  const comparisonMissing = target?.kind === 'result' && !result?.contrast?.intervention;
  const prelimPending = !designConfirmed || comparisonMissing;
  const baseReadOnly = !rob.canEdit || !!a?.complete || designBlocked || !inScope;
  const readOnly = baseReadOnly || (step > 0 && prelimPending);

  // ── Focus (which question a linked passage goes to) ───────────────────────

  const [focusedQ, setFocusedQ] = useState<string | null>(null);
  /** Which questions have their Guidance note open. View state only, never saved. */
  const [guideOpen, setGuideOpen] = useState<Record<string, boolean>>({});
  const domainIdx = step >= 1 && step <= 5 ? step - 1 : -1;
  const route = useMemo(() => (d && a ? routeAllFor(d.merged, pathwayOf(a)) : {}), [d, a]);
  const domainQuestions = useMemo(
    () => (a && domainIdx >= 0 ? signallingFor(a.effect)[domainIdx].questions : []), [a, domainIdx]);
  const focus = domainQuestions.find(q => q.id === focusedQ && route[q.id] === 'asked')?.id
    ?? domainQuestions.find(q => route[q.id] === 'asked' && !d?.merged[q.id])?.id
    ?? domainQuestions.find(q => route[q.id] === 'asked')?.id ?? null;

  useEffect(() => { setFocusedQ(null); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); }, [step, targetId]);

  // ── Edits ──────────────────────────────────────────────────────────────────

  const sharedZone = (id: string, dr: Draft) => isD1(id) && !dr.assessment.d1Override;

  /** My other completed assessments of this scope in the study — they read the shared D1. */
  const reopenSiblings = useCallback((): Assessment[] => {
    if (!documentId || !target) return [];
    const view = rob.myView(documentId);
    if (!view) return [];
    return [...view.assessments.values()]
      .filter(x => x.targetId !== target.id && x.kind === scope && x.complete && !x.d1Override)
      .map(x => {
        const judgement = [...x.judgement]; judgement[0] = null;
        return { ...x, complete: false, judgement, overall: null, reopenedBecause: 'Domain 1 answers for this study changed' };
      });
  }, [documentId, target, rob, scope]);

  const setAnswer = (idx: number, id: string, code: AnswerCode | null) => {
    if (readOnly || !draft) return;
    const shared = sharedZone(id, draft);
    // Only a real change to a shared D1 answer reopens siblings; re-clicking
    // the selected answer (or clearing an empty one) changes nothing.
    const d1Changed = shared && (draft.study.answers[id] ?? null) !== (code ?? null);
    update(dr => {
      let study = dr.study;
      let assessment = dr.assessment;
      const put = (answers: Answers) => { const next = { ...answers }; if (code) next[id] = code; else delete next[id]; return next; };
      if (shared) study = { ...study, answers: put(study.answers) };
      else assessment = { ...assessment, answers: put(assessment.answers) };
      // Clear what the new answer routes out, so a stale answer never lingers.
      const r = routeAllFor(mergedAnswers(study, assessment), pathwayOf(assessment));
      for (const q of signallingFor(assessment.effect)[idx].questions) {
        if (r[q.id] !== 'skipped') continue;
        if (sharedZone(q.id, { study, assessment })) {
          if (study.answers[q.id]) { const s = { ...study.answers }; delete s[q.id]; study = { ...study, answers: s }; }
        } else if (assessment.answers[q.id]) {
          const s = { ...assessment.answers }; delete s[q.id]; assessment = { ...assessment, answers: s };
        }
      }
      return { study, assessment };
    }, d1Changed ? { alsoAssessments: reopenSiblings() } : undefined);
  };

  const setSupport = (id: string, text: string) => {
    if (readOnly || !draft) return;
    update(dr => (sharedZone(id, dr)
      ? { ...dr, study: { ...dr.study, support: { ...dr.study.support, [id]: text } } }
      : { ...dr, assessment: { ...dr.assessment, support: { ...dr.assessment.support, [id]: text } } }));
  };

  const setQuote = (id: string, quote: QuoteRef | null) => {
    if (readOnly || !draft) return;
    update(dr => {
      const zone = sharedZone(id, dr) ? dr.study.quotes : dr.assessment.quotes;
      const next = { ...zone };
      if (quote) next[id] = quote; else delete next[id];
      return sharedZone(id, dr)
        ? { ...dr, study: { ...dr.study, quotes: next } }
        : { ...dr, assessment: { ...dr.assessment, quotes: next } };
    });
  };

  const setA = (patch: Partial<Assessment>) => update(dr => ({ ...dr, assessment: { ...dr.assessment, ...patch } }));
  const setAt = <K extends 'judgement' | 'rationale' | 'direction'>(key: K, i: number, value: Assessment[K][number]) =>
    update(dr => {
      const arr = [...dr.assessment[key]] as Assessment[K];
      (arr as any)[i] = value;
      return { ...dr, assessment: { ...dr.assessment, [key]: arr } };
    });

  const toggleD1Override = () => {
    if (readOnly || !draft) return;
    update(dr => {
      const x = dr.assessment;
      if (!x.d1Override) {
        const answers = { ...x.answers }; const support = { ...x.support }; const quotes = { ...x.quotes };
        for (const id of D1_QUESTIONS) {
          if (dr.study.answers[id]) answers[id] = dr.study.answers[id];
          if (dr.study.support[id]) support[id] = dr.study.support[id];
          if (dr.study.quotes[id]) quotes[id] = dr.study.quotes[id];
        }
        return { ...dr, assessment: { ...x, d1Override: true, answers, support, quotes } };
      }
      const answers = { ...x.answers }; const support = { ...x.support }; const quotes = { ...x.quotes };
      for (const id of D1_QUESTIONS) { delete answers[id]; delete support[id]; delete quotes[id]; }
      return { ...dr, assessment: { ...x, d1Override: false, answers, support, quotes } };
    });
  };

  // ── Copying from my other assessments ─────────────────────────────────────

  const infoOf = useCallback((id: string) => {
    if (isOutcomeKey(id)) return { outcome: id.slice('outcome:'.length), measurement: '', title: '' };
    const r = rob.resultById.get(id);
    return {
      outcome: normaliseOutcome(r?.outcome_domain ?? ''),
      measurement: (r?.measurement ?? '').trim().toLowerCase(),
      title: r ? [r.outcome_domain, r.timepoint].filter(Boolean).join(' · ') : '',
    };
  }, [rob.resultById]);

  const copySource = useMemo(() => {
    if (!a || !target || !documentId || (domainIdx !== 1 && domainIdx !== 3)) return null;
    const view = rob.myView(documentId);
    if (!view) return null;
    const mine = infoOf(target.id);
    const measurement = (result?.measurement ?? '').trim().toLowerCase();
    const candidates = [...view.assessments.values()].filter(x => {
      if (x.targetId === target.id || x.kind !== scope) return false;
      const info = infoOf(x.targetId);
      if (domainIdx === 1) return info.outcome === normaliseOutcome(target.outcome) && x.effect === a.effect;
      return !!measurement && info.measurement === measurement;
    });
    const best = candidates.find(x => x.complete) ?? candidates[0];
    if (!best) return null;
    return { assessment: best, title: infoOf(best.targetId).title || best.label || mine.title };
  }, [a, target, documentId, domainIdx, rob, infoOf, result, scope]);

  const copyFrom = () => {
    if (!copySource || readOnly || domainIdx < 0 || !a) return;
    const from = copySource.assessment;
    const ids = signallingFor(a.effect)[domainIdx].questions.map(q => q.id);
    let copied = 0;
    update(dr => {
      const answers = { ...dr.assessment.answers }; const support = { ...dr.assessment.support }; const quotes = { ...dr.assessment.quotes };
      for (const id of ids) {
        if (answers[id] || !from.answers[id]) continue;
        answers[id] = from.answers[id]; copied += 1;
        if (!support[id] && from.support[id]) support[id] = from.support[id];
        if (!quotes[id] && from.quotes[id]) quotes[id] = from.quotes[id];
      }
      return { ...dr, assessment: { ...dr.assessment, answers, support, quotes } };
    });
    toast({
      title: copied ? `Copied ${copied} answer${copied === 1 ? '' : 's'} from ${copySource.title}` : 'Nothing to copy',
      description: copied ? 'Only empty questions were filled. The judgment stays yours to make.' : 'Every question here is already answered.',
      variant: copied ? 'success' : 'default',
    });
  };

  // ── AI suggestions (ROB_AI_ENABLED + protocol ai_visibility; see _lib/robAi.ts) ──
  //
  // Never pre-filled: a suggestion becomes an answer only via Accept / Modify,
  // and every reveal / accept / modify / keep / reject is appended to the
  // assessment's aiLog. What this seat may see is decided by the server.

  const aiVisibility = aiVisibilityOf(rob.protocol);
  const aiOn = ROB_AI_ENABLED && aiVisibility !== 'off' && inScope && !designBlocked;
  const aiSupervisor = isAiSupervisor(rob.mySeat, rob.canManage);
  const draftsQ = useRobAiDrafts({
    projectId: rob.projectId, documentId: documentId ?? '', targetId: target?.id ?? '', enabled: aiOn && !!loadKey,
  });
  const aiRun = useRobAiRun();
  const drafts = aiOn ? draftsQ.data ?? null : null;
  const aiSug = useMemo(() => suggestionsFrom(drafts), [drafts]);
  const aiHidden = useMemo(() => new Set(drafts?.hidden ?? []), [drafts]);
  const aiNotFound = useMemo(() => new Set(drafts?.not_found ?? []), [drafts]);
  const aiPhase = runPhase(drafts?.domains);
  const aiHasAnswers = Object.keys(aiSug).length > 0;
  const [aiOpen, setAiOpen] = useState<Record<string, boolean>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [aiEvidence, setAiEvidence] = useState<{ qid: string; quote: AiQuote; answer: AnswerCode } | null>(null);
  useEffect(() => { setAiOpen({}); setAiEvidence(null); }, [loadKey]);

  // "Opened" trigger: once per target. The server decides whether to act on it
  // (readers only under readers_and_cr) and is idempotent on the draft key.
  const openedFor = useRef('');
  const { trigger: triggerAi } = aiRun;
  useEffect(() => {
    if (!aiOn || !loadKey || !documentId || !target || openedFor.current === loadKey) return;
    openedFor.current = loadKey;
    triggerAi({ project_id: rob.projectId, document_id: documentId, target_id: target.id, trigger: 'opened' });
  }, [aiOn, loadKey, documentId, target, triggerAi, rob.projectId]);

  const runAi = (force: boolean) => {
    if (!documentId || !target) return;
    aiRun.mutate(
      { project_id: rob.projectId, document_id: documentId, target_id: target.id, trigger: 'manual', force },
      {
        onSuccess: r => {
          if (r.skipped) toast({ title: 'AI suggestions not started', description: r.skipped.replace(/_/g, ' '), variant: 'default' });
        },
        onError: e => toast({ title: 'Could not start AI suggestions', description: getErrorMessage(e), variant: 'error' }),
      },
    );
  };

  const retryAiDomain = (domain: number) => {
    if (!documentId || !target) return;
    aiRun.mutate(
      { project_id: rob.projectId, document_id: documentId, target_id: target.id, trigger: 'manual', domains: [domain] },
      { onError: e => toast({ title: 'Could not retry this domain', description: getErrorMessage(e), variant: 'error' }) },
    );
  };
  const retryingAi = aiRun.isPending && aiRun.variables?.trigger === 'manual' && aiRun.variables?.domains?.length === 1
    ? aiRun.variables.domains[0] : null;

  const modelOf = (domain: number) => drafts?.domains.find(x => x.domain === domain)?.model || AI_MODEL_LABEL;
  const aiSeat = rob.mySeat ?? (rob.canManage ? 'manager' : null);

  const logAi = (question: string, action: AiLogEntry['action'], ai: AiSuggestion,
    before: AnswerCode | undefined, final: AnswerCode | undefined, reason = '') => {
    if (readOnly) return;
    const entry: AiLogEntry = {
      kind: 'question', question, action, ai_answer: ai.answer,
      human_answer_before: before ?? null, final_answer: final ?? null,
      evidence: { quotes: ai.quotes.map(q => ({ text: q.text, page: q.page })), strength: ai.strength },
      reason: reason || undefined, draft_id: ai.draftId || null, seat: aiSeat,
      at: new Date().toISOString(), model: modelOf(ai.domain),
    };
    // One entry per (question, action): a later decision replaces the earlier
    // one, so the log stays bounded however often a strip is reopened.
    update(dr => ({
      ...dr,
      assessment: {
        ...dr.assessment,
        aiLog: [...(dr.assessment.aiLog ?? [])
          .filter(e => !(isQuestionLog(e) && e.question === question && e.action === action)), entry],
      },
    }));
  };

  /** The AI's quote as a stored location: its geometry plus where it came from. */
  const aiQuoteRef = (q: AiQuote, ai: AiSuggestion): QuoteRef => ({
    quote: q.text,
    locator: quoteLocator(q),
    location: {
      ...(q.location ?? (q.page ? { page: q.page } : {})),
      // The server re-stamps grounding_method on reviewer-supplied evidence;
      // these keys survive its merge, so the cell still says it came from the AI.
      origin: 'ai_suggestion',
      ai_grounding_method: q.location?.grounding_method ?? null,
      draft_id: ai.draftId || null,
    },
  });

  const acceptAi = (idx: number, qid: string, ai: AiSuggestion, reason = '') => {
    const before = d?.merged[qid] as AnswerCode | undefined;
    setAnswer(idx, qid, ai.answer);
    // Evidence travels with the answer: the verified quote and its location.
    if (ai.quotes[0]) setQuote(qid, aiQuoteRef(ai.quotes[0], ai));
    logAi(qid, 'accepted', ai, before, ai.answer, reason);
    setAiOpen(o => ({ ...o, [qid]: false }));
  };

  const modifyAi = (idx: number, qid: string, ai: AiSuggestion, code: AnswerCode, reason: string) => {
    if (code === ai.answer) { acceptAi(idx, qid, ai, reason); return; }
    const before = d?.merged[qid] as AnswerCode | undefined;
    setAnswer(idx, qid, code);
    // Y ≡ PY and N ≡ PN: the AI's quote still supports an equivalent answer.
    if (sameAnswer(code, ai.answer) && ai.quotes[0]) setQuote(qid, aiQuoteRef(ai.quotes[0], ai));
    logAi(qid, 'modified', ai, before, code, reason);
    setAiOpen(o => ({ ...o, [qid]: false }));
  };

  const keepAi = (qid: string, ai: AiSuggestion) => {
    const value = d?.merged[qid] as AnswerCode | undefined;
    logAi(qid, value ? 'kept' : 'rejected', ai, value, value);
    setAiOpen(o => ({ ...o, [qid]: false }));
  };

  /** readers_and_cr: save the reader's answer, then ask the server again. */
  const reveal = async (qid: string) => {
    setRevealing(qid);
    try {
      await flush();
      const r = await draftsQ.refetch();
      if (r.data?.answers.some(x => x.question_id === qid)) {
        setAiOpen(o => ({ ...o, [qid]: true }));
      } else if (r.data?.hidden.includes(qid)) {
        toast({ title: 'Still hidden', description: 'The server has not seen your saved answer to this question yet. Try again in a moment.', variant: 'default' });
      }
    } catch (e) {
      toast({ title: 'Could not reveal the AI answer', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setRevealing(null);
    }
  };

  const LOG_NOTE: Record<AiLogEntry['action'], string> = {
    revealed: '', accepted: 'Accepted', modified: 'Modified', kept: 'Kept own', rejected: 'Dismissed',
  };

  const aiStripFor = (idx: number, q: SignallingQuestion, asked: boolean) => {
    if (!aiOn || !asked || !d) return undefined;
    const qid = q.id;
    const value = d.merged[qid] as AnswerCode | undefined;
    const ai = aiSug[qid];
    if (!ai) {
      if (aiHidden.has(qid) && drafts?.hidden_reason === 'answer_first') {
        return <AiHiddenStrip answered={!!value} revealing={revealing === qid} onReveal={() => reveal(qid)} />;
      }
      if (aiNotFound.has(qid)) return <AiNotFoundStrip />;
      return undefined;
    }
    const open = !!aiOpen[qid];
    const last = decisions(a?.aiLog).find(e => e.question === qid);
    return (
      <AiQuestionStrip
        questionId={qid} ai={ai} value={value} open={open} readOnly={readOnly}
        allowNoInformation={q.noInformationOption !== false}
        logNote={last ? LOG_NOTE[last.action] : ''}
        onToggle={() => {
          if (!open && !(a?.aiLog ?? []).some(e => isQuestionLog(e) && e.question === qid && e.action === 'revealed')) {
            logAi(qid, 'revealed', ai, value, value);
          }
          setAiOpen(o => ({ ...o, [qid]: !open }));
        }}
        onAccept={() => acceptAi(idx, qid, ai)}
        onKeep={() => keepAi(qid, ai)}
        onModify={(code, reason) => modifyAi(idx, qid, ai, code, reason)}
        onShowQuote={quote => setAiEvidence({ qid, quote, answer: ai.answer })}
      />
    );
  };

  const aiDomains = useMemo(
    () => (aiOn && aiHasAnswers && d && a ? [0, 1, 2, 3, 4].map(i => aiDomainSuggestion(i, d.merged, aiSug, pathwayOf(a))) : []),
    [aiOn, aiHasAnswers, d, a, aiSug]);
  const aiOverall = aiDomains.length ? aiOverallSuggestion(aiDomains) : null;

  /** The reviewer's pick, logged beside the engine's suggestion from the AI's answers. */
  const setJudgement = (i: number, j: Judgement) => {
    setAt('judgement', i, j);
    const ai = aiDomains[i];
    if (!ai || readOnly) return;
    update(dr => ({
      ...dr,
      assessment: {
        ...dr.assessment,
        aiLog: [...(dr.assessment.aiLog ?? []).filter(e => !(e.kind === 'domain' && e.domain === i)),
          { kind: 'domain', domain: i, judgement_ai: ai.judgement, judgement_final: j, at: new Date().toISOString() }],
      },
    }));
  };

  // PDF tab: the AI's quotes for the domain on screen, drawn as markers.
  const aiMarkers: SourceMarker[] = !aiOn || domainIdx < 0 ? [] : domainQuestions.flatMap(q => {
    const ai = aiSug[q.id];
    if (!ai || route[q.id] !== 'asked') return [];
    return ai.quotes.map((quote, n) => ({
      key: `${q.id}#${n}`,
      label: `${q.id} · AI ${ANSWER_LABEL[ai.answer]}`,
      text: quote.text,
      used: (a?.quotes[q.id]?.quote ?? (isD1(q.id) ? draft?.study.quotes[q.id]?.quote : '')) === quote.text,
    }));
  });
  const onMarkerClick = (keys: string[], quote: SelectedQuote) => {
    const ids = [...new Set(keys.map(k => k.split('#')[0]))];
    for (const id of ids) {
      const ai = aiSug[id];
      setQuote(id, {
        quote: quote.text, locator: `p. ${quote.page}`,
        location: { ...quote.location, origin: 'ai_suggestion', draft_id: ai?.draftId || null },
      });
    }
    toast({ title: `Linked to Q${ids.join(', Q')}`, description: `Page ${quote.page}. The answer itself is unchanged.`, variant: 'success' });
  };
  const onSelectPdfQuote = (quote: SelectedQuote) => {
    if (!focus) return;
    setQuote(focus, { quote: quote.text, locator: `p. ${quote.page}`, location: quote.location });
    toast({ title: `Linked to Q${focus}`, description: `Page ${quote.page}`, variant: 'success' });
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goStep = (n: number) => go({ domain: n }, { replace: true });
  const toDashboard = () => go({ screen: 'dashboard', study: documentId, target: null, domain: null, as: null });

  // ── Delete (owners / managers; only the caller's own entry) ────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mineStored = !!(target && rob.myView(documentId)?.assessments.get(target.id));
  const canDelete = rob.canManage && mineStored;
  const deleteMine = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await flush().catch(() => undefined);
      await rob.removeMine(documentId, target.id);
      toast({ title: 'Assessment deleted', variant: 'success' });
      go({ screen: 'dashboard', study: documentId, target: null, domain: null, as: null });
    } catch (e) {
      toast({ title: 'Could not delete it', description: getErrorMessage(e), variant: 'error' });
      setDeleting(false);
    }
  };

  const saveAndExit = async () => {
    try { await flush(); toDashboard(); } catch {
      toast({ title: 'Save failed', description: 'Your changes are still on this screen. Try again.', variant: 'error' });
    }
  };

  const complete = async () => {
    if (!d?.canComplete || readOnly) return;
    setA({ complete: true, reopenedBecause: '' });
    try {
      await flush();
      // A reader's completion may make the target consensus-ready; the server
      // checks both readers and no-ops otherwise.
      if (aiOn && documentId && (rob.mySeat === 'reviewer_1' || rob.mySeat === 'reviewer_2')) {
        triggerAi({ project_id: rob.projectId, document_id: documentId, target_id: target!.id, trigger: 'consensus_ready' });
      }
      toast({ title: 'Assessment complete', variant: 'success' });
      toDashboard();
    } catch {
      toast({ title: 'Save failed', description: 'The assessment is not marked complete yet. Try again.', variant: 'error' });
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (rob.loading) {
    return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!target) {
    return (
      <div className="mx-auto mt-16 max-w-[520px] text-center">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-zinc-100">This assessment target no longer exists</h2>
        <p className="mt-2 text-[13px] text-gray-500 dark:text-zinc-400">
          The result or outcome may have been merged or removed from the result registry.
        </p>
        <OutlineButton className="mt-5" onClick={() => go({ screen: 'dashboard', target: null, domain: null, as: null })}>
          Back to Risk of Bias
        </OutlineButton>
      </div>
    );
  }
  if (!inScope) {
    return (
      <div className="mx-auto mt-16 max-w-[520px] text-center">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-zinc-100">Not in this protocol’s scope</h2>
        <p className="mt-2 text-[13px] text-gray-500 dark:text-zinc-400">
          The review protocol assesses {scope === 'outcome' ? 'outcomes' : 'individual results'}, so this
          {' '}{target.kind === 'outcome' ? 'outcome-level' : 'result-level'} assessment is not shown or edited here.
          Anything stored for it is kept.
        </p>
        <OutlineButton className="mt-5" onClick={() => go({ screen: 'dashboard', study: documentId, target: null, domain: null, as: null })}>
          Back to {studyLabel || 'Risk of Bias'}
        </OutlineButton>
      </div>
    );
  }
  if (!draft || !a || !d) {
    return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const tool = design ? TOOL_FOR_DESIGN[design] : 'RoB 2';
  const effectText = a.effect === 'adherence' ? 'Effect of adhering' : 'Effect of assignment (ITT)';

  // ── Rails ──────────────────────────────────────────────────────────────────

  const railItems: RailItem[] = [
    {
      step: 0, label: 'Preliminary',
      status: a.prelimConfirmed
        ? [a.sourcesObtained.length ? `${a.sourcesObtained.length} source${a.sourcesObtained.length === 1 ? '' : 's'}` : '',
          target.kind === 'result' ? `${a.experimental || result?.contrast?.intervention || '?'} vs ${a.comparator || result?.contrast?.comparator || '?'}` : '',
        ].filter(Boolean).join(' · ') || 'Confirmed'
        : 'Not started',
    },
    ...DOMAIN_SHORT.map((label, i) => {
      const j = a.judgement[i];
      const c = d.counts[i];
      return {
        step: i + 1, label, judgement: j,
        status: j ? `${JUDGEMENT_LABEL[j]}${d.domainReady[i] ? '' : ' · unconfirmed'}`
          : c.answered > 0 ? 'In progress' : 'Not started',
      } as RailItem;
    }),
    { step: 6, label: 'Overall', judgement: a.overall, status: a.overall ? JUDGEMENT_LABEL[a.overall] : 'Not judged' },
  ];
  // The AI state of each domain, beside its name in the rail (when this caller sees AI at all).
  if (aiOn && drafts?.domains?.length && (aiSupervisor || aiHasAnswers)) {
    for (const it of railItems) {
      if (it.step >= 1 && it.step <= 5) it.ai = drafts.domains.find(x => x.domain === it.step - 1) ?? null;
    }
  }

  const targetRows: Array<[string, React.ReactNode]> = target.kind === 'result' && result
    ? [
      ['Outcome', [result.outcome_domain, result.measurement].filter(Boolean).join(' · ')],
      ['Time point', result.timepoint],
      ['Experimental', a.experimental || result.contrast?.intervention || ''],
      ['Comparator', a.comparator || result.contrast?.comparator || ''],
      ['Population', result.population],
      ['Estimate', result.estimate],
      ['Location', a.resultLocation],
      ['Effect', a.effect === 'adherence' ? 'Adhering (per-protocol)' : 'Assignment (ITT)'],
      ['Tool', `${tool} · 2019-08-22`],
    ]
    : [
      ['Outcome', target.outcome],
      ['Measurement', target.outcomeTarget?.measurements.join(', ') ?? ''],
      ['Effect', a.effect === 'adherence' ? 'Adhering (per-protocol)' : 'Assignment (ITT)'],
      ['Tool', `${tool} · 2019-08-22`],
    ];

  const allQuotes = [
    ...Object.entries(draft.study.quotes).filter(([id]) => !a.d1Override && isD1(id)),
    ...Object.entries(a.quotes),
  ].filter(([, q]) => q?.quote);
  const isLinked = (text: string) => allQuotes.find(([, q]) => q.quote === text)?.[0] ?? null;
  const onToggleLink = (p: Passage) => {
    const at = isLinked(p.text);
    if (at) setQuote(at, null);
    else if (focus) setQuote(focus, { quote: p.text, locator: p.locator });
  };

  // ── Main column ────────────────────────────────────────────────────────────

  const notices = (
    <>
      {!rob.canEdit && (
        <Banner tone="gray" icon="lock">
          <strong>Read-only.</strong> Recording a risk-of-bias assessment needs the “run manual extractions”
          permission on this project.
        </Banner>
      )}
      {designBlocked && design && (
        <Banner tone="slate">
          <strong>{TOOL_FOR_DESIGN[design]} is not available yet.</strong> This study is recorded as a
          {' '}{design === 'nrsi' ? 'non-randomised study' : `${design} trial`}; only the parallel-group RoB 2 template is
          built, so it cannot be assessed here.
        </Banner>
      )}
      {step > 0 && prelimPending && !baseReadOnly && (
        <Banner tone="slate" action={<OutlineButton small onClick={() => goStep(0)}>Go to Preliminary</OutlineButton>}>
          {!designConfirmed
            ? <>Confirm the study design in Preliminary considerations first. It selects the instrument, and it is
              asked once for {studyLabel}.</>
            : <>Name the interventions compared in Preliminary considerations first. This result has no comparison yet.</>}
        </Banner>
      )}
      {a.complete && (
        <Banner tone="green" icon={<Check className="mt-px h-3.5 w-3.5 shrink-0" />}
          action={rob.canEdit && !designBlocked ? <OutlineButton small onClick={() => setA({ complete: false })}>Reopen assessment</OutlineButton> : undefined}>
          This assessment is complete. Reopen it to change an answer or judgment.
        </Banner>
      )}
      {a.reopenedBecause && !a.complete && (
        <Banner tone="slate" action={!readOnly ? <OutlineButton small onClick={() => setA({ reopenedBecause: '' })}>Dismiss</OutlineButton> : undefined}>
          <strong>Reopened:</strong> {a.reopenedBecause}. Check the affected domains and complete it again.
        </Banner>
      )}
      {a.legacy && (
        <Banner tone="gray" icon={<Info className="mt-px h-3.5 w-3.5 shrink-0" />}>
          Carried over from the earlier Risk of Bias screen: answers 2.1–2.3 came from the answers shared across the
          comparison. Check them before completing.
        </Banner>
      )}
      {result?.version && a.resultVersion && result.version !== a.resultVersion && (
        <Banner tone="slate">
          This result’s identity was corrected after this assessment was made (version {a.resultVersion} → {result.version}).
          Check the answers still describe it.
        </Banner>
      )}
    </>
  );

  let main: React.ReactNode;
  if (step === 0) {
    main = (
      <Preliminary draft={draft} update={update} target={target} readOnly={baseReadOnly} studyLabel={studyLabel}
        onContinue={() => goStep(1)} onBackToDashboard={toDashboard} />
    );
  } else if (step <= 5) {
    const idx = step - 1;
    const domain = signallingFor(a.effect)[idx];
    const c = d.counts[idx];
    const s = d.suggestions[idx];
    const isD1Shared = idx === 0 && !a.d1Override;
    const kindWord = target.kind === 'outcome' ? 'assessment' : 'result';
    const banner = idx === 0
      ? {
        text: a.d1Override
          ? `This ${kindWord} answers Domain 1 itself, overriding the answers shared across ${studyLabel}.`
          : `Applies to the whole trial. These answers are shared with every assessment of ${studyLabel} unless you override them here.`,
        action: readOnly ? null : { label: a.d1Override ? 'Use the study’s answers' : `Override for this ${kindWord}`, run: toggleD1Override },
      }
      : idx === 1
        ? {
          text: copySource
            ? `Applies mainly to the outcome. Answers for another assessment of this outcome (${copySource.title}) can be copied as a starting point; the judgment stays per ${kindWord}.`
            : `Applies mainly to the outcome. Answer for this ${kindWord}; once another assessment of this outcome exists, its answers can be copied as a starting point.`,
          action: copySource && !readOnly ? { label: `Copy from ${copySource.title}`, run: copyFrom } : null,
        }
        : idx === 2
          ? { text: target.kind === 'outcome'
            ? 'Applies to this outcome. Judge on the completeness of its outcome data.'
            : 'Applies to this outcome at this time point. Judge on the completeness of data for this result.', action: null }
          : idx === 3
            ? {
              text: copySource
                ? `Applies to the measurement method. Other assessments measured with ${result?.measurement} in this trial can share these answers.`
                : 'Applies to the measurement method. Other assessments measured the same way in this trial can share these answers.',
              action: copySource && !readOnly ? { label: `Copy from ${copySource.title}`, run: copyFrom } : null,
            }
            : { text: target.kind === 'outcome'
              ? 'Applies to the results reported for this outcome. Nothing is copied; check the protocol, statistical analysis plan or registry entry.'
              : 'Applies to this specific numerical result. Nothing is copied; check the protocol, statistical analysis plan or registry entry for this result.', action: null };

    const nextLabel = idx < 4 ? `Confirm & go to Domain ${idx + 2} →` : 'Confirm & go to Overall →';

    main = (
      <div className="flex flex-col gap-4">
        <div>
          <Eyebrow>Domain {idx + 1}</Eyebrow>
          <h2 className="mt-1 text-[20px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">
            {DOMAIN_TITLE[idx]}
            {idx === 1 && ` (${a.effect === 'adherence' ? 'effect of adhering to intervention' : 'effect of assignment to intervention'})`}
          </h2>
          <p className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
            {c.answered} of {c.applicable} applicable signalling question{c.applicable === 1 ? '' : 's'} answered
            {c.notApplicable > 0 && ` · ${c.notApplicable} not applicable`}
            {c.waiting > 0 && ` · ${c.waiting} awaiting earlier answers`}
          </p>
        </div>

        {idx === 1 && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-2.5 dark:border-[#242424] dark:bg-[#0d0d0d]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={2} strokeLinecap="round" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="text-[12px] leading-[17px] text-[#374151] dark:text-zinc-300">{D2_FRAME[a.effect]}</span>
              {!!rob.protocol.anticipated_deviations?.trim() && (
                <span className="text-[12px] leading-[17px] text-[#374151] dark:text-zinc-300">
                  <span className="font-semibold">Anticipated deviations (from protocol):</span>{' '}
                  {rob.protocol.anticipated_deviations.trim()}
                </span>
              )}
            </span>
          </div>
        )}

        <Banner tone="blue" action={banner.action ? (
          <button type="button" onClick={banner.action.run}
            className="shrink-0 rounded-[6px] border border-[#bfdbfe] bg-white px-2.5 py-1 text-[12px] font-medium text-[#1d4ed8] hover:bg-blue-50 dark:border-blue-900 dark:bg-transparent dark:text-blue-300">
            {banner.action.label}
          </button>
        ) : undefined}>
          {banner.text}
          {isD1Shared && !readOnly && (
            <span className="mt-1 block text-[11.5px] opacity-80">
              Changing a shared answer reopens your other completed assessments of this study.
            </span>
          )}
        </Banner>

        <div className="flex flex-col gap-2.5">
        {domain.questions.map(q => {
          const shared = isD1(q.id) && !a.d1Override;
          return (
            <QuestionCard key={q.id}
              question={q}
              prefix={conditionPrefix(q.id, a.effect)}
              route={(route as any)[q.id] ?? 'asked'}
              value={d.merged[q.id] as AnswerCode | undefined}
              onAnswer={code => setAnswer(idx, q.id, code)}
              support={(shared ? draft.study.support[q.id] : a.support[q.id]) ?? ''}
              onSupport={t => setSupport(q.id, t)}
              quote={(shared ? draft.study.quotes[q.id] : a.quotes[q.id]) ?? null}
              onUnlink={() => setQuote(q.id, null)}
              readOnly={readOnly}
              focused={focus === q.id}
              onFocus={() => setFocusedQ(q.id)}
              guidance={guidanceFor(q.id, a.effect)}
              guideOpen={!!guideOpen[q.id]}
              onToggleGuide={() => setGuideOpen(g => ({ ...g, [q.id]: !g[q.id] }))}
              aiSlot={aiStripFor(idx, q, ((route as any)[q.id] ?? 'asked') === 'asked')}
            />
          );
        })}
        </div>

        <JudgementCard
          title={`Domain ${idx + 1} judgment`}
          suggestion={{ severity: sev(s.severity), reason: s.reason }}
          value={a.judgement[idx]}
          onChange={j => setJudgement(idx, j)}
          direction={a.direction[idx]}
          onDirection={v => setAt('direction', idx, v as Direction | '')}
          rationale={a.rationale[idx]}
          onRationale={t => setAt('rationale', idx, t)}
          needsRationale={d.needsRationale[idx]}
          readOnly={readOnly}
          aiSlot={aiDomains[idx] ? (
            <AiJudgementRow suggestion={aiDomains[idx]!} readOnly={readOnly}
              onInsert={() => setAt('rationale', idx, aiDomains[idx]!.text)} />
          ) : undefined}
          footer={<>
            <OutlineButton onClick={() => goStep(step - 1)}>← Previous</OutlineButton>
            <PrimaryButton disabled={!d.domainReady[idx]} onClick={() => goStep(step + 1)}>{nextLabel}</PrimaryButton>
          </>}
        />
      </div>
    );
  } else {
    const o = d.overallSuggestion;
    const unjudged = a.judgement.filter(j => !j).length;
    const overallReason = o.severity ? o.reason
      : `${unjudged} domain${unjudged === 1 ? '' : 's'} not yet judged. Full assessment of all five domains is required; no stopping rule.`;
    const blocker = !a.prelimConfirmed ? 'Confirm Preliminary considerations first'
      : !d.domainReady.every(Boolean) ? `Judge every domain first (${d.domainReady.filter(x => !x).length} left)`
        : !a.overall ? 'Choose the overall judgment'
          : d.overallTooLow ? 'The overall cannot be milder than the worst domain'
            : d.overallNeedsRationale && !a.overallRationale.trim() ? 'A rationale is required' : '';
    main = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">Overall</span>
          <h2 className="m-0 text-[18px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">Overall risk of bias</h2>
          <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">{targetTitle(target)}</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
          {DOMAIN_TITLE.map((title, i) => (
            <div key={title} className="flex items-center gap-3.5 border-b border-[#f3f4f6] px-5 py-3 last:border-b-0 dark:border-[#1a1a1a]">
              <span className="w-[26px] text-[12px] font-semibold text-[#9ca3af] dark:text-zinc-500">D{i + 1}</span>
              <span className="flex-1 text-[13px] text-gray-900 dark:text-zinc-100">
                {title}{i === 1 && ` (${a.effect === 'adherence' ? 'effect of adhering to intervention' : 'effect of assignment to intervention'})`}
              </span>
              <Light j={a.judgement[i]} size={22} />
              <span className={cn('w-[120px] text-[13px] font-semibold', judgementTextClass(a.judgement[i]))}>
                {judgementText(a.judgement[i])}
              </span>
              <button type="button" onClick={() => goStep(i + 1)}
                className="rounded-[6px] border border-[#e5e7eb] bg-transparent px-2 py-[3px] text-[11px] font-medium text-[#6b7280] hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]">
                Review
              </button>
            </div>
          ))}
        </div>

        <JudgementCard
          variant="overall"
          title="Overall judgment"
          suggestion={{ severity: sev(o.severity), reason: overallReason }}
          note={o.considerHigh ? 'Several domains have some concerns. RoB 2 allows an overall High risk of bias when they substantially lower confidence in the result; that is your call, with a rationale.' : undefined}
          value={a.overall}
          onChange={j => setA({ overall: j })}
          floor={d.worstDomain}
          direction={a.overallDirection}
          onDirection={v => setA({ overallDirection: v })}
          rationale={a.overallRationale}
          onRationale={t => setA({ overallRationale: t })}
          needsRationale={d.overallNeedsRationale}
          readOnly={readOnly}
          aiSlot={aiOverall ? (
            <AiJudgementRow suggestion={aiOverall} readOnly={readOnly}
              onInsert={() => setA({ overallRationale: aiOverall.text })} />
          ) : undefined}
          footer={<>
            <button type="button" onClick={() => goStep(5)}
              className="h-[34px] rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#374151] hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
              ← Domain 5
            </button>
            <div className="flex items-center gap-3">
              {!d.canComplete && !readOnly && blocker && (
                <span className="text-[12px] text-gray-500 dark:text-zinc-400">{blocker}</span>
              )}
              <button type="button" disabled={readOnly || !d.canComplete} onClick={complete}
                className="h-[34px] rounded-[7px] border-none bg-[#0a0a0a] px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#d4d4d8] dark:bg-zinc-100 dark:text-gray-900 dark:disabled:bg-zinc-700">
                Complete assessment
              </button>
            </div>
          </>}
        />
      </div>
    );
  }

  // ── Shell ──────────────────────────────────────────────────────────────────

  const aiDoc = documentId ? rob.docById.get(documentId) : undefined;
  const aiEvidenceDrawer = aiOn && (
    <SourceEvidenceDrawer
      open={!!aiEvidence}
      onClose={() => setAiEvidence(null)}
      documentId={documentId}
      documentFilename={studyLabel}
      sourceText={aiEvidence?.quote.text ?? null}
      boxes={aiEvidence ? boxesFromLocation(aiEvidence.quote.location) : null}
      page={aiEvidence ? aiEvidence.quote.page ?? (typeof aiEvidence.quote.location?.page === 'number' ? aiEvidence.quote.location.page : null) : null}
      storedValue={aiEvidence ? ANSWER_LABEL[aiEvidence.answer] : null}
      fieldLabel={aiEvidence ? `${aiEvidence.qid} AI evidence` : undefined}
      hasPdf={aiDoc ? !!aiDoc.s3_pdf_path : true}
      sourceType={aiDoc?.source_type ?? null}
      recordId={aiDoc?.nct_id ?? aiDoc?.pmid ?? null}
      doi={aiDoc?.doi ?? null}
    />
  );

  return (
    <>
    {aiEvidenceDrawer}
    <div className="overflow-x-auto">
      <div className="flex min-w-[1100px] flex-col gap-5 pb-16">
        <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 dark:border-[#1f1f1f] dark:bg-[#111111]">
          <button type="button" onClick={saveAndExit} aria-label="Back to the study"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[15px] font-semibold text-gray-900 dark:text-zinc-100">{studyLabel}</span>
              <span className="text-gray-300">·</span>
              <span className="truncate text-[13px] font-medium text-gray-800 dark:text-zinc-200">{targetTitle(target)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500 dark:text-zinc-400">
              <span>{tool}</span><span>·</span>
              <span>{target.kind === 'outcome' ? 'Outcome' : 'Result'} scope</span><span>·</span>
              <span>{effectText}</span><span>·</span>
              {rob.mySeat ? (
                <span className="inline-flex items-center gap-1.5"><SeatBadge seat={rob.mySeat} /> You</span>
              ) : (
                <span>No seat · additional assessment</span>
              )}
            </div>
          </div>
          {aiOn && (
            <AiHeaderControl
              supervisor={aiSupervisor}
              phase={aiPhase}
              domains={drafts?.domains ?? []}
              estimate={drafts?.estimate ?? aiRun.data?.estimate ?? null}
              readerNote={aiSupervisor ? null
                : drafts?.hidden_reason === 'cr_only' ? 'AI suggestions · consensus reviewer only'
                  : drafts?.hidden_reason === 'answer_first' && !aiHasAnswers ? 'AI suggestions · reveal after you answer'
                    : null}
              busy={aiRun.isPending && aiRun.variables?.trigger === 'manual'}
              onRun={runAi}
              tally={aiTally(a.aiLog)} />
          )}
          <SaveIndicator state={saveState} savedAt={savedAt} readOnly={readOnly} />
          {canDelete && (
            <OutlineButton onClick={() => setConfirmDelete(true)} className="text-[#b91c1c] dark:text-red-300">Delete</OutlineButton>
          )}
          <OutlineButton onClick={saveAndExit}>{readOnly ? 'Exit' : 'Save & exit'}</OutlineButton>
        </div>
        {confirmDelete && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[12.5px] text-[#b91c1c] dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
            <span className="flex-1">
              Delete your assessment of <strong>{targetTitle(target)}</strong>? Your answers, judgments and rationale for it are
              removed. Other reviewers&apos; assessments and any recorded consensus are not affected. This cannot be undone.
            </span>
            <OutlineButton small onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</OutlineButton>
            <button type="button" onClick={deleteMine} disabled={deleting}
              className="h-7 rounded-[6px] bg-[#dc2626] px-3 text-[12px] font-semibold text-white hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-60">
              {deleting ? 'Deleting…' : 'Delete assessment'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-[200px_minmax(0,1fr)_280px] items-start gap-5">
          <DomainRail items={railItems} active={step} onPick={goStep} outcomeScope={target.kind === 'outcome'}
            onRetryAi={aiSupervisor ? retryAiDomain : undefined} retryingAi={retryingAi} />
          <div className="flex min-w-0 flex-col gap-4">
            {notices}
            {main}
          </div>
          <div className="sticky top-4 flex flex-col gap-4">
            <TargetPanel rows={targetRows} />
            {aiOn && (aiHasAnswers || (a.aiLog ?? []).length > 0) && (
              <AiAuditCard log={a.aiLog} model={drafts?.domains.find(x => x.model)?.model || AI_MODEL_LABEL} />
            )}
            <EvidencePanel
              documentId={documentId}
              studyLabel={studyLabel}
              focusedQuestion={step >= 1 && step <= 5 ? focus : null}
              linkedCount={allQuotes.length}
              isLinked={isLinked}
              onToggleLink={onToggleLink}
              linked={allQuotes.map(([id, q]) => ({ id, quote: q.quote, locator: q.locator }))}
              readOnly={readOnly}
              pdf={aiOn ? {
                markers: aiMarkers,
                onMarkerClick,
                onSelectQuote: onSelectPdfQuote,
                hint: aiMarkers.length
                  ? `${aiMarkers.length} AI quote${aiMarkers.length === 1 ? '' : 's'} for this domain · click one to link it`
                  : focus && step >= 1 && step <= 5 ? `Select a passage to link it to Q${focus}` : null,
              } : undefined}
            />
            {a.sourcesObtained.length > 0 && step !== 0 && (
              <div className="px-1 text-[11px] leading-[16px] text-gray-400 dark:text-zinc-500">
                Sources: {a.sourcesObtained.map(k => SOURCE_OPTIONS.find(([key]) => key === k)?.[1] ?? k).join(', ')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

function SaveIndicator({ state, savedAt, readOnly }: { state: string; savedAt: string; readOnly: boolean }) {
  if (readOnly && state === 'idle') return <span className="text-[12px] text-gray-400 dark:text-zinc-500">Read-only</span>;
  if (state === 'saving') {
    return <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Saving…</span>;
  }
  if (state === 'failed') return <span className="text-[12px] font-medium text-[#b91c1c] dark:text-red-400">Save failed · retrying on next change</span>;
  if (state === 'saved') {
    return <span className="inline-flex items-center gap-1 text-[12px] text-gray-500 dark:text-zinc-400"><Check className="h-3.5 w-3.5 text-[#16a34a]" />Saved {savedAt}</span>;
  }
  return <span className="text-[12px] text-gray-400 dark:text-zinc-500">Changes save automatically</span>;
}

// Re-exported for page.tsx's convenience.
export { EFFECT_SHORT };
