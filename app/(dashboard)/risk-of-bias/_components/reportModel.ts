/**
 * What the Review summary shows for each study × target, computed from
 * `useRob()` through the same `studyTargets` / `targetInfo` the dashboard uses,
 * so the report can never disagree with the Summary tab.
 *
 * "Final" is exactly the dashboard's Consensus view (`TargetInfo.consensusJudgement`):
 *  - a RECORDED consensus (the consensus reviewer completed it), or
 *  - R1 and R2 both completed and agree on all five domains and the overall,
 *    in which case R1's entry is what is reported.
 * Anything else has no final judgement yet and is drawn as not yet judged.
 *
 * Everything read here is already blinded per assessment by the server; a
 * reviewer's entry the caller may not see is simply absent, and the row says
 * "Hidden until both reviewers complete" rather than guessing.
 *
 * Pure apart from the `RobData` it reads — no React here.
 */

import {
  DESIGN_SHORT, comparisonText, designAssessable, normaliseOutcome, targetTitle,
} from '../_lib/robModel';
import type { AgreementSide, ReportRow, ReportView } from '../_lib/robReport';
import type { RobData } from '../_lib/useRobData';
import { scopeOf, studyTargets, type TargetInfo } from './dashboardModel';

/** May see R1 / R2 judgements and agreement: managers and the consensus reviewer. */
export function canSeeReviewers(rob: RobData): boolean {
  return rob.canManage || rob.mySeat === 'adjudicator';
}

/** Distinct outcomes across every study (outcome-scope filter), first-seen order. */
export function outcomeOptions(rob: RobData): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>();
  for (const s of rob.studies) {
    for (const o of rob.outcomesOfDoc(s.id)) {
      const key = normaliseOutcome(o.outcome);
      if (!seen.has(key)) seen.set(key, o.outcome);
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

function completedAt(rob: RobData, documentId: string, targetId: string, who: string | 'consensus'): string | null {
  const hit = rob.statuses.find(s => s.document_id === documentId && s.target_id === targetId && s.status === 'complete'
    && (who === 'consensus' ? s.extraction_type === 'consensus' : s.extraction_type === 'manual' && s.extracted_by === who));
  if (hit?.updated_at) return hit.updated_at;
  const rec = rob.records
    .filter(r => r.document_id === documentId && (who === 'consensus'
      ? r.extraction_type === 'consensus' : r.extraction_type === 'manual' && r.extracted_by === who))
    .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))[0];
  return rec ? rec.updated_at ?? rec.created_at : null;
}

function consensusAuthor(rob: RobData, documentId: string): string {
  const rec = rob.records
    .filter(r => r.document_id === documentId && r.extraction_type === 'consensus')
    .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))[0];
  const id = rec?.extracted_by ?? rob.protocol.reviewers?.adjudicator ?? null;
  return rec?.extracted_by_name || rob.nameOf(id);
}

const PENDING_FINAL: Record<TargetInfo['consensus'], string> = {
  resolved: 'Complete',
  agreed: 'Complete',
  needed: 'Consensus needed',
  waiting_r1: 'Waiting for R1',
  waiting_r2: 'Waiting for R2',
  both_complete: 'Consensus pending',
  none: 'Not assessed',
};

function rowFor(rob: RobData, info: TargetInfo, view: ReportView, blocked: string): ReportRow {
  const t = info.target;
  const doc = rob.docById.get(t.documentId);
  const r = t.result;
  const base: ReportRow = {
    documentId: t.documentId,
    studyLabel: rob.labelOf(t.documentId),
    citation: doc?.title || doc?.filename || '',
    targetId: t.id,
    kind: t.kind,
    title: targetTitle(t),
    outcome: t.outcome,
    measurement: r ? r.measurement : t.outcomeTarget?.measurements.join('; ') ?? '',
    timepoint: r?.timepoint ?? '',
    analysisPopulation: r?.analysis_population ?? '',
    analysis: r?.analysis ?? '',
    comparison: r ? comparisonText(r) : '',
    effect: info.effect,
    domains: [null, null, null, null, null],
    overall: null,
    entry: null,
    d1: null,
    source: view === 'final' ? 'Final' : view === 'reviewer_1' ? 'R1' : 'R2',
    reviewer: '',
    status: 'Not assessed',
    complete: false,
    completedAt: null,
  };

  if (view === 'final') {
    if (info.consensus === 'resolved' && info.consensusEntry) {
      const entry = info.consensusEntry;
      return {
        ...base, entry, d1: rob.viewOf(t.documentId, 'consensus')?.d1 ?? null,
        domains: [...entry.judgement], overall: entry.overall, effect: entry.effect,
        reviewer: `Consensus · ${consensusAuthor(rob, t.documentId)}`,
        status: 'Complete · consensus recorded', complete: true,
        completedAt: completedAt(rob, t.documentId, t.id, 'consensus'),
      };
    }
    if (info.consensus === 'agreed' && info.r1.view && info.r1.holder) {
      const entry = info.r1.view;
      const dates = [info.r1.holder, info.r2.holder]
        .map(h => (h ? completedAt(rob, t.documentId, t.id, h) : null)).filter(Boolean) as string[];
      return {
        ...base, entry, d1: rob.viewOf(t.documentId, info.r1.holder)?.d1 ?? null,
        domains: [...entry.judgement], overall: entry.overall, effect: entry.effect,
        reviewer: 'R1 and R2 agreed',
        status: 'Complete · R1 and R2 agreed', complete: true,
        completedAt: dates.sort()[dates.length - 1] ?? null,
      };
    }
    return { ...base, status: blocked || (info.stored && info.consensus === 'none' ? 'In progress' : PENDING_FINAL[info.consensus]) };
  }

  const seat = view === 'reviewer_1' ? info.r1 : info.r2;
  const reviewer = seat.holder ? rob.nameOf(seat.holder) : 'Unassigned';
  if (seat.view && seat.holder) {
    const entry = seat.view;
    return {
      ...base, entry, d1: rob.viewOf(t.documentId, seat.holder)?.d1 ?? null,
      domains: [...entry.judgement], overall: entry.overall, effect: entry.effect,
      reviewer, status: entry.complete ? 'Complete' : 'In progress', complete: entry.complete,
      completedAt: entry.complete ? completedAt(rob, t.documentId, t.id, seat.holder) : null,
    };
  }
  const status = !seat.holder ? 'Seat unassigned'
    : seat.status !== 'none' ? 'Hidden until both reviewers complete' : blocked || 'Not assessed';
  return { ...base, reviewer, status };
}

/**
 * Every study × target of the protocol's scope, in study-list order. Readers
 * only ever get the Final view; asking for R1/R2 without the standing falls
 * back to it rather than showing an empty page.
 */
export function reportRows(rob: RobData, view: ReportView, outcome: string | null): ReportRow[] {
  const effective: ReportView = canSeeReviewers(rob) ? view : 'final';
  const out: ReportRow[] = [];
  for (const s of rob.studies) {
    const { design, confirmed } = rob.designOf(s.id);
    const blocked = confirmed && !designAssessable(design) ? `Not assessable · ${DESIGN_SHORT[design!]}` : '';
    for (const info of studyTargets(rob, s.id).all) {
      if (outcome && normaliseOutcome(info.target.outcome) !== outcome) continue;
      out.push(rowFor(rob, info, effective, blocked));
    }
  }
  return out;
}

/**
 * R1/R2 pairs for agreement: targets where BOTH seat holders completed and
 * both entries are visible to the caller. Empty for anyone without standing.
 */
export function agreementPairs(rob: RobData, outcome: string | null): {
  pairs: Array<[AgreementSide, AgreementSide]>;
  /** Targets in scope, for "n of N" wording. */
  total: number;
} {
  const pairs: Array<[AgreementSide, AgreementSide]> = [];
  let total = 0;
  if (!canSeeReviewers(rob)) return { pairs, total };
  const sideOf = (documentId: string, seat: TargetInfo['r1']): AgreementSide | null => {
    if (seat.status !== 'complete' || !seat.view?.complete || !seat.holder) return null;
    const d1 = rob.viewOf(documentId, seat.holder)?.d1;
    return d1 ? { entry: seat.view, d1 } : null;
  };
  for (const s of rob.studies) {
    for (const info of studyTargets(rob, s.id).all) {
      if (outcome && normaliseOutcome(info.target.outcome) !== outcome) continue;
      total++;
      const a = sideOf(s.id, info.r1);
      const b = sideOf(s.id, info.r2);
      if (a && b) pairs.push([a, b]);
    }
  }
  return { pairs, total };
}

/** "Outcome" / "Result" — what one row of the report is at this scope. */
export function targetHeading(rob: RobData): string {
  return scopeOf(rob) === 'outcome' ? 'Outcome' : 'Result';
}
