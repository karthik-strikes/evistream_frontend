/**
 * AI suggestions for the RoB 2 workspace — gated OFF by default.
 *
 * Two switches, both must be on: the build flag `NEXT_PUBLIC_ROB_AI_SUGGESTIONS=1`
 * (`ROB_AI_ENABLED`) and the protocol's `ai_visibility` (`off` / `cr_only` /
 * `readers_and_cr`). Off, the workspace shows no AI UI at all.
 *
 * Rules that hold even when it is on:
 *  - Suggestions answer SIGNALLING QUESTIONS only, never judgements. The
 *    "engine suggests {judgment}" row is derived by `suggestDomain` from the
 *    AI's answers, exactly as a reviewer's answers would be (CLAUDE.md: AI
 *    drafting answers questions, never judgements).
 *  - Nothing is pre-filled. A suggestion becomes an answer only when the
 *    reviewer presses Accept (or Modify), and every reveal / accept / modify /
 *    keep / reject is logged on the assessment (`aiLog`) so reviewer
 *    independence stays auditable.
 *  - Who sees what is decided by the SERVER (`GET /rob/ai/drafts` → `hidden`).
 *    The screen never un-hides a question on its own.
 *  - Evidence strength is derived server-side from the verified quotes, never
 *    reported by the model; there is no confidence score.
 */

import type {
  RobAiAnswer, RobAiDomainState, RobAiDraftsResponse, RobAiSourceLocation, RobAiVisibility,
  RobProtocol,
} from '@/services/rob.service';

import {
  isNo, isYes, parseAnswer, routeAllFor, signallingFor, suggestDomain, suggestOverall,
  ANSWER_LABEL, type AnswerCode, type Answers, type PathwayOptions,
} from './rob2';
import { DOMAIN_SHORT, JUDGEMENT_LABEL, type Judgement, type Seat } from './robModel';

export const ROB_AI_ENABLED = process.env.NEXT_PUBLIC_ROB_AI_SUGGESTIONS === '1';

/** Recorded on audit entries when the draft does not name its model. */
export const AI_MODEL_LABEL = 'rob2-draft';

export const AI_VISIBILITY_LABEL: Record<RobAiVisibility, string> = {
  off: 'Off',
  cr_only: 'Consensus reviewer only',
  readers_and_cr: 'Readers and Consensus reviewer',
};

export const AI_VISIBILITY_HELP: Record<RobAiVisibility, string> = {
  off: 'No AI calls are made for this project and no suggestions are shown.',
  cr_only: 'Readers assess independently without AI. The consensus reviewer sees AI answers beside R1 and R2.',
  readers_and_cr: 'Readers may reveal the AI answer to a question only after saving their own; the consensus reviewer sees all of it.',
};

/** The protocol's setting; servers without the column behave as the default. */
export function aiVisibilityOf(protocol: Pick<RobProtocol, 'ai_visibility'>): RobAiVisibility {
  const v = protocol.ai_visibility;
  return v === 'off' || v === 'readers_and_cr' ? v : 'cr_only';
}

/** Consensus reviewer or a manager without a reader seat — who may run and always sees drafts. */
export function isAiSupervisor(seat: Seat | null, canManage: boolean): boolean {
  if (seat === 'reviewer_1' || seat === 'reviewer_2') return false;
  return seat === 'adjudicator' || canManage;
}

export interface AiQuote {
  text: string;
  page: number | null;
  location: RobAiSourceLocation | null;
}

export interface AiSuggestion {
  questionId: string;
  domain: number;
  answer: AnswerCode;
  quotes: AiQuote[];
  evidenceType: 'explicit' | 'inferred' | 'absent';
  strength: 'Strong' | 'Partial' | 'Insufficient';
  rationale: string;
  lookedFor: string;
  conflicting: boolean;
  variesAcross: Array<{ label: string; answer: string }>;
  needsReview: boolean;
  strippedQuotes: number;
  draftId: string;
}

function fromAnswer(a: RobAiAnswer): AiSuggestion | null {
  const code = parseAnswer(a.answer);
  if (!code || code === 'NA') return null;
  return {
    questionId: a.question_id,
    domain: a.domain,
    answer: code,
    quotes: (a.quotes ?? [])
      .map(q => ({ text: String(q?.text ?? '').trim(), page: typeof q?.page === 'number' ? q.page : null, location: q?.source_location ?? null }))
      .filter(q => q.text),
    evidenceType: a.evidence_type ?? 'inferred',
    strength: a.strength === 'Strong' || a.strength === 'Partial' ? a.strength : 'Insufficient',
    rationale: String(a.rationale ?? '').trim(),
    lookedFor: String(a.looked_for ?? '').trim(),
    conflicting: !!a.conflicting,
    variesAcross: Array.isArray(a.varies_across) ? a.varies_across.filter(v => v && v.label) : [],
    needsReview: !!a.needs_human_review,
    strippedQuotes: Number(a.stripped_quotes) || 0,
    draftId: String(a.draft_id ?? ''),
  };
}

/** The drafts response, keyed by question. `NA` and unparseable answers are dropped. */
export function suggestionsFrom(response: RobAiDraftsResponse | null | undefined): Record<string, AiSuggestion> {
  const out: Record<string, AiSuggestion> = {};
  for (const a of response?.answers ?? []) {
    const s = fromAnswer(a);
    if (s) out[a.question_id] = s;
  }
  return out;
}

/** Y≡PY and N≡PN, as the tool treats them. */
export function sameAnswer(a: AnswerCode | undefined | null, b: AnswerCode | undefined | null): boolean {
  if (!a || !b) return false;
  return a === b || (isYes(a) && isYes(b)) || (isNo(a) && isNo(b));
}

/** "p. 4" from the quote's page, or its location's. */
export function quoteLocator(q: Pick<AiQuote, 'page' | 'location'>): string {
  const page = q.page ?? (typeof q.location?.page === 'number' ? q.location.page : null);
  return page ? `p. ${page}` : '';
}

// ── Run status ───────────────────────────────────────────────────────────────

export type AiRunPhase = 'none' | 'working' | 'ready' | 'partial' | 'failed';

export function isPending(d: Pick<RobAiDomainState, 'status'>): boolean {
  return d.status === 'queued' || d.status === 'running';
}

/** Poll while any domain is queued or running. */
export function draftsPending(r: RobAiDraftsResponse | null | undefined): boolean {
  return !!r?.domains?.some(isPending);
}

export function runPhase(domains: RobAiDomainState[] | undefined): AiRunPhase {
  const ds = domains ?? [];
  if (!ds.length || ds.every(d => d.status === 'missing')) return 'none';
  if (ds.some(isPending)) return 'working';
  if (ds.every(d => d.status === 'done')) return 'ready';
  if (ds.some(d => d.status === 'done')) return 'partial';
  return 'failed';
}

/** "5 calls · ~12k-token paper". */
export function estimateText(e: { calls: number; paper_tokens: number } | null | undefined): string {
  if (!e || !e.calls) return '';
  const k = e.paper_tokens >= 1000 ? `~${Math.round(e.paper_tokens / 1000)}k` : `~${e.paper_tokens}`;
  return `${e.calls} call${e.calls === 1 ? '' : 's'}${e.paper_tokens ? ` · ${k}-token paper` : ''}`;
}

// ── Engine-derived judgements from the AI's answers ─────────────────────────

/** The reviewer's answers with the AI's substituted wherever it gave one. */
function withAi(merged: Answers, ai: Record<string, AiSuggestion>, domain: number, opts: PathwayOptions): Answers {
  const out: Answers = { ...merged };
  for (const q of signallingFor(opts.effect ?? 'assignment')[domain].questions) {
    if (ai[q.id]) out[q.id] = ai[q.id].answer;
  }
  return out;
}

export interface AiDomainSuggestion {
  judgement: Judgement;
  /** The assembled rationale — built from the AI's answers, never generated. */
  text: string;
}

function answerPhrase(id: string, s: AiSuggestion): string {
  const q = s.quotes[0];
  const bits = [q ? `‘${q.text.length > 140 ? `${q.text.slice(0, 137).trimEnd()}…` : q.text}’` : '', q ? quoteLocator(q) : '']
    .filter(Boolean).join(', ');
  return `${id} ${ANSWER_LABEL[s.answer]}${bits ? ` (${bits})` : ''}`;
}

/**
 * "AI answers → engine suggests {judgment}" for one domain — the algorithm run
 * on the AI's answers. Null unless the AI answered EVERY question its own
 * answers route in: a suggestion assembled partly from the reviewer's answers
 * would be presented as the AI's when it is not.
 */
export function aiDomainSuggestion(
  domain: number, merged: Answers, ai: Record<string, AiSuggestion>, opts: PathwayOptions,
): AiDomainSuggestion | null {
  const effect = opts.effect ?? 'assignment';
  const answers = withAi(merged, ai, domain, opts);
  const route = routeAllFor(answers, opts);
  const asked = signallingFor(effect)[domain].questions.filter(q => route[q.id] === 'asked');
  if (!asked.length || asked.some(q => !ai[q.id])) return null;
  const qs = asked;
  const s = suggestDomain(domain, answers, opts);
  if (!s.severity || s.severity === 'none') return null;
  const j = s.severity as Judgement;
  return {
    judgement: j,
    text: `Suggested ${JUDGEMENT_LABEL[j]}: ${qs.map(q => answerPhrase(q.id, ai[q.id])).join('; ')}. Algorithm: ${s.reason}.`,
  };
}

/** Overall from the five AI domain suggestions (Table 1). Null unless all five exist. */
export function aiOverallSuggestion(
  domains: (AiDomainSuggestion | null)[],
): AiDomainSuggestion | null {
  if (domains.length < 5 || domains.some(d => !d)) return null;
  const js = domains.map(d => d!.judgement);
  const o = suggestOverall(js);
  if (!o.severity || o.severity === 'none') return null;
  const parts = js.map((j, i) => `D${i + 1} ${DOMAIN_SHORT[i].toLowerCase()}: ${JUDGEMENT_LABEL[j].toLowerCase()}`);
  return {
    judgement: o.severity as Judgement,
    text: `${parts.join('; ')}. Overall: ${JUDGEMENT_LABEL[o.severity as Judgement].toLowerCase()}.`,
  };
}
