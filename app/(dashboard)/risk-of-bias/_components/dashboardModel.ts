/**
 * What the dashboard and the new-assessment screen show about each target of a
 * study, computed once from `useRob()` so the two screens agree.
 *
 * Pure apart from the `RobData` it reads — no React here.
 */

import type { ResultIdentity } from '../_lib/robIdentity';
import {
  compareAssessments, derive, finalJudgements, isOutcomeKey, outcomeTarget,
  resultTarget, type Assessment, type AssessmentStatus, type EffectOfInterest,
  type Judgement, type Scope, type Seat, type Target,
} from '../_lib/robModel';
import type { RobData } from '../_lib/useRobData';

export type ConsensusState = 'resolved' | 'agreed' | 'needed' | 'waiting_r1' | 'waiting_r2' | 'both_complete' | 'none';

export interface SeatState {
  seat: Seat;
  holder: string | null;
  status: AssessmentStatus;
  domainsJudged: number | null;
  /** Their entry, when the server let us see it. */
  view: Assessment | null;
}

export interface TargetInfo {
  target: Target;
  mine: Assessment | null;
  myStatus: AssessmentStatus;
  /** Mine when I have an entry, else the readers' combined progress. */
  status: AssessmentStatus;
  effect: EffectOfInterest;
  r1: SeatState;
  r2: SeatState;
  consensusEntry: Assessment | null;
  consensus: ConsensusState;
  /** What the review reports: consensus when resolved/agreed. */
  consensusJudgement: { domains: (Judgement | null)[]; overall: Judgement | null } | null;
  /** The judgement shown on the card: consensus if settled, else mine. */
  shownOverall: Judgement | null;
  /** Where "Continue" lands: 0 preliminary, 1–5 domains, 6 overall. */
  resumeDomain: number;
  /** Any stored assessment visible to the caller (entry or status row). */
  stored: boolean;
  held: boolean;
  /**
   * The ONE status the dashboard counts this target under, so tiles, cards,
   * lists and the study list always agree. A reader (R1/R2, or anyone without
   * a seat who is not a manager, or a manager who assessed it themselves)
   * counts their own progress. The consensus reviewer — and a manager with no
   * reader seat and no entry of their own — counts the consensus: recorded or
   * agreed = complete, anything started = in progress, nothing = not assessed.
   */
  rowStatus: AssessmentStatus;
}

export function scopeOf(rob: RobData): Scope {
  return rob.protocol.scope === 'outcome' ? 'outcome' : 'result';
}

/** Targets under the protocol's scope, in registry order. */
export function scopeTargets(rob: RobData, documentId: string): Target[] {
  // A study that still needs comparisons has no assessable rows: its rows are
  // held with no comparison, and they are listed in the held box instead.
  const waiting = studyComparisons(rob, documentId).needComps;
  const isWaiting = (r: ResultIdentity) => waiting && r.state === 'held' && !r.contrast;
  return scopeOf(rob) === 'outcome'
    ? rob.outcomesOfDoc(documentId).filter(o => o.results.some(r => !isWaiting(r))).map(outcomeTarget)
    : rob.resultsOf(documentId).filter(r => !isWaiting(r)).map(resultTarget);
}

/** Resolve a stored target id back to a Target. Null if it no longer exists. */
export function targetById(rob: RobData, documentId: string, id: string): Target | null {
  if (isOutcomeKey(id)) {
    const o = rob.outcomesOfDoc(documentId).find(x => x.key === id);
    return o ? outcomeTarget(o) : null;
  }
  const r = rob.resultById.get(id);
  return r && r.document_id === documentId ? resultTarget(r) : null;
}

function statusRow(rob: RobData, documentId: string, targetId: string, holder: string | null) {
  if (!holder) return null;
  return rob.statuses.find(s => s.document_id === documentId && s.target_id === targetId
    && s.extraction_type === 'manual' && s.extracted_by === holder) ?? null;
}

function seatState(rob: RobData, documentId: string, targetId: string, seat: Seat): SeatState {
  const holder = rob.protocol.reviewers?.[seat] ?? null;
  const view = holder ? rob.viewOf(documentId, holder) : null;
  const entry = view?.assessments.get(targetId) ?? null;
  const row = statusRow(rob, documentId, targetId, holder);
  let status: AssessmentStatus = rob.statusOf(documentId, targetId, seat);
  if (entry && view) status = derive(view.d1, entry).status;
  return {
    seat, holder, status,
    domainsJudged: row ? row.domains_judged : entry ? entry.judgement.filter(Boolean).length : null,
    view: entry,
  };
}

export function targetInfo(rob: RobData, documentId: string, target: Target): TargetInfo {
  const my = rob.myView(documentId);
  const mine = my?.assessments.get(target.id) ?? null;
  const myDerived = mine && my ? derive(my.d1, mine) : null;
  const myStatus: AssessmentStatus = myDerived?.status ?? 'none';

  const r1 = seatState(rob, documentId, target.id, 'reviewer_1');
  const r2 = seatState(rob, documentId, target.id, 'reviewer_2');
  const consensusEntry = rob.viewOf(documentId, 'consensus')?.assessments.get(target.id) ?? null;

  let consensus: ConsensusState = 'none';
  let consensusJudgement: TargetInfo['consensusJudgement'] = null;
  // Only a RECORDED consensus settles the target; a draft the consensus
  // reviewer autosaved on the Consensus screen is still "needed".
  if (consensusEntry && consensusEntry.complete) {
    consensus = 'resolved';
    consensusJudgement = finalJudgements(consensusEntry);
  } else if (r1.status === 'complete' && r2.status === 'complete') {
    if (r1.view && r2.view) {
      const cmp = compareAssessments(r1.view, r2.view);
      consensus = cmp.agree ? 'agreed' : 'needed';
      if (cmp.agree) consensusJudgement = finalJudgements(r1.view);
    } else consensus = 'both_complete';
  } else if (r1.status === 'complete') consensus = 'waiting_r2';
  else if (r2.status === 'complete') consensus = 'waiting_r1';

  const anyStatus = rob.statuses.some(s => s.document_id === documentId && s.target_id === target.id);
  const stored = !!mine || !!consensusEntry || anyStatus || !!r1.view || !!r2.view;

  const aggregate: AssessmentStatus = r1.status === 'complete' && r2.status === 'complete' ? 'complete'
    : [r1.status, r2.status].some(s => s !== 'none') || anyStatus ? 'progress' : 'none';
  const status = mine ? myStatus : consensus === 'resolved' ? 'complete' : aggregate;

  let resumeDomain = 0;
  if (mine) {
    if (!mine.prelimConfirmed) resumeDomain = 0;
    else {
      const first = mine.judgement.findIndex(j => !j);
      resumeDomain = first >= 0 ? first + 1 : 6;
    }
  }

  const readerSeat = rob.mySeat === 'reviewer_1' || rob.mySeat === 'reviewer_2';
  const consensusViewer = rob.mySeat === 'adjudicator' || (!readerSeat && rob.canManage && !mine);
  const consensusStatus: AssessmentStatus = consensus === 'resolved' || consensus === 'agreed' ? 'complete'
    : consensus !== 'none' || !!consensusEntry || [r1.status, r2.status].some(s => s !== 'none') ? 'progress'
      : 'none';
  const rowStatus: AssessmentStatus = consensusViewer ? consensusStatus : myStatus;

  return {
    target, mine, myStatus, status, rowStatus,
    effect: mine?.effect ?? rob.defaultEffect,
    r1, r2, consensusEntry, consensus, consensusJudgement,
    shownOverall: consensusJudgement?.overall ?? mine?.overall ?? null,
    resumeDomain, stored,
    held: target.result?.state === 'held',
  };
}

/** Every target of a study the caller can see an assessment for, plus the scope's own. */
export function studyTargets(rob: RobData, documentId: string): {
  /** Every target the dashboard counts: the scope's own plus stored ones of the same scope. */
  all: TargetInfo[];
  scoped: TargetInfo[];
  stored: TargetInfo[];
} {
  const scoped = scopeTargets(rob, documentId).map(t => targetInfo(rob, documentId, t));
  const seen = new Set(scoped.map(i => i.target.id));
  const extraIds = new Set<string>();
  rob.myView(documentId)?.assessments.forEach((_, id) => extraIds.add(id));
  rob.viewOf(documentId, 'consensus')?.assessments.forEach((_, id) => extraIds.add(id));
  for (const s of rob.statuses) if (s.document_id === documentId) extraIds.add(s.target_id);
  for (const seat of ['reviewer_1', 'reviewer_2'] as Seat[]) {
    const holder = rob.protocol.reviewers?.[seat];
    if (holder) rob.viewOf(documentId, holder)?.assessments.forEach((_, id) => extraIds.add(id));
  }
  const extras: TargetInfo[] = [];
  for (const id of extraIds) {
    if (seen.has(id)) continue;
    const t = targetById(rob, documentId, id);
    // Only assessments of the protocol's scope are shown. A result-level
    // assessment (e.g. from the pre-protocol page) stays stored but is not
    // listed under outcome scope, and vice versa.
    if (t && t.kind === scopeOf(rob)) extras.push(targetInfo(rob, documentId, t));
  }
  const all = [...scoped, ...extras];
  return { all, scoped, stored: all.filter(i => i.stored) };
}

/** Completed / total targets, counted exactly as the stat tiles count them. */
export function studyProgress(rob: RobData, documentId: string): { done: number; total: number } {
  const { all } = studyTargets(rob, documentId);
  return { done: all.filter(i => i.rowStatus === 'complete').length, total: all.length };
}

export const STATUS_WORD: Record<AssessmentStatus, string> = {
  none: 'Not started', progress: 'In progress', complete: 'Complete',
};

export function seatStatusText(s: SeatState): string {
  if (!s.holder) return 'Unassigned';
  if (s.status === 'progress' && s.domainsJudged !== null) return `In progress · ${s.domainsJudged}/5 domains`;
  return STATUS_WORD[s.status];
}

export function consensusText(c: ConsensusState): string {
  return {
    resolved: 'Agreed · consensus recorded',
    agreed: 'Agreed',
    needed: 'Needed · R2 differs',
    waiting_r1: 'Waiting for R1',
    waiting_r2: 'Waiting for R2',
    both_complete: 'Both complete',
    none: '—',
  }[c];
}

/** "{population} · {estimate}" — the result's second line everywhere it is listed. */
export function resultLine(r: ResultIdentity): string {
  return [r.population || 'Overall', r.estimate].filter(Boolean).join(' · ');
}

/** A row held because its study still needs comparisons (result scope only). */
export function isWaitingRow(rob: RobData, r: ResultIdentity): boolean {
  return studyComparisons(rob, r.document_id).needComps && r.state === 'held' && !r.contrast;
}

// ── Comparisons (per study) ──────────────────────────────────────────────────

export interface StudyComparisonState {
  /** Arms found in extraction: the placeholder's arm list plus settled sides. */
  arms: string[];
  /** Comparisons with both sides named. */
  settled: RobData['contrasts'];
  /** >2 arms and no comparison yet — the study cannot produce results. */
  needComps: boolean;
  /** Rows held because no comparison says which pair they belong to. */
  held: ResultIdentity[];
  /**
   * Comparisons only matter at RESULT scope: a result is one outcome × time
   * point × comparison. At outcome scope the assessment attaches to the outcome
   * itself, so nothing waits on a comparison and the screen is not offered.
   */
  applies: boolean;
}

export function studyComparisons(rob: RobData, studyId: string): StudyComparisonState {
  const contrasts = rob.contrasts.filter(c => c.document_id === studyId);
  const settled = contrasts.filter(c => c.intervention && c.comparator);
  const arms: string[] = [];
  const add = (a?: string) => { const t = String(a ?? '').trim(); if (t && !arms.includes(t)) arms.push(t); };
  for (const c of contrasts) for (const a of c.arms ?? []) add(a);
  for (const c of settled) { for (const a of c.intervention.split(' + ')) add(a); add(c.comparator); }
  const held = rob.resultsOf(studyId).filter(r => r.state === 'held' && !r.contrast);
  const applies = scopeOf(rob) === 'result';
  return {
    arms, settled, held: applies ? held : [], applies,
    needComps: applies && arms.length > 2 && settled.length === 0,
  };
}
