/**
 * The project-level Review summary: agreement statistics and the CSV exports.
 *
 * Pure — no React, no services — so `lib/__checks__/robReport.check.mts` can
 * pin the statistics against a published worked example under Node. The rows
 * it formats are built from `useRob()` by `_components/reportModel.ts`, which
 * is where "which judgement does this view show" is decided; nothing here
 * re-decides it.
 *
 * Two rules the statistics must never break:
 *
 *  - **Kappa is undefined, not zero, when chance agreement is total.** If both
 *    reviewers put every target in one category, p_e = 1 and κ = 0/0. Printing
 *    0 (or 1) there would state a reliability nobody measured, so it is null and
 *    the screen shows "—".
 *  - **Only pairs both reviewers COMPLETED are compared.** A half-done
 *    assessment disagreeing with a finished one is progress, not disagreement.
 */

import { questionsFor, routeAllFor, type AnswerCode } from './rob2';
import {
  DOMAIN_TITLE, EFFECT_LABEL, JUDGEMENT_LABEL, derive, mergedAnswers, pathwayOf,
  type Assessment, type Direction, type EffectOfInterest, type Judgement, type Scope, type StudyD1,
} from './robModel';

// ── Rows ─────────────────────────────────────────────────────────────────────

export type ReportView = 'final' | 'reviewer_1' | 'reviewer_2';

export const VIEW_LABEL: Record<ReportView, string> = {
  final: 'Final', reviewer_1: 'Reviewer 1', reviewer_2: 'Reviewer 2',
};

export const VIEW_SHORT: Record<ReportView, string> = {
  final: 'Final', reviewer_1: 'R1', reviewer_2: 'R2',
};

/** One study × target, as one view of the review shows it. */
export interface ReportRow {
  documentId: string;
  studyLabel: string;
  citation: string;
  targetId: string;
  kind: Scope;
  /** `targetTitle()` — "Pain · 24 weeks · Drug A vs Placebo", or the outcome. */
  title: string;
  outcome: string;
  measurement: string;
  timepoint: string;
  analysisPopulation: string;
  analysis: string;
  /** "Intervention vs Comparator" at result scope, '' at outcome scope. */
  comparison: string;
  effect: EffectOfInterest;
  domains: (Judgement | null)[];
  overall: Judgement | null;
  /** The entry the judgements come from, when this view may show one. */
  entry: Assessment | null;
  /** The study's D1 of the SAME record as `entry` (D1 is per study). */
  d1: StudyD1 | null;
  /** Who: "Final", "R1", "R2". */
  source: string;
  /** The person (or "R1 and R2 agreed") behind `source`. */
  reviewer: string;
  /** What the row stands at in this view: "Complete", "Consensus pending", … */
  status: string;
  complete: boolean;
  completedAt: string | null;
}

// ── Agreement statistics ─────────────────────────────────────────────────────

/** Ordinal category index: Low < Some concerns < High. */
export const CATEGORY: Record<Judgement, number> = { low: 0, some: 1, high: 2 };

export interface KappaResult {
  n: number;
  /** Observed proportion of exact agreement, 0–1. */
  agreement: number | null;
  /** Cohen's unweighted kappa; null when undefined (p_e = 1 or n = 0). */
  kappa: number | null;
  /** Linear-weighted kappa over the ordinal scale; null when undefined. */
  weightedKappa: number | null;
}

/**
 * Cohen's kappa from a k×k contingency table (rows rater A, columns rater B).
 *
 * Linear agreement weights w_ij = 1 − |i − j| / (k − 1): an adjacent-category
 * disagreement (Low vs Some concerns) earns half credit on a 3-point scale, a
 * Low-vs-High one none. With k = 2 the weighted and unweighted values coincide.
 */
export function kappaFromTable(table: number[][]): KappaResult {
  const k = table.length;
  const n = table.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (!n) return { n: 0, agreement: null, kappa: null, weightedKappa: null };
  const rows = table.map(r => r.reduce((a, b) => a + b, 0) / n);
  const cols = Array.from({ length: k }, (_, j) => table.reduce((s, r) => s + r[j], 0) / n);
  const w = (i: number, j: number) => (k > 1 ? 1 - Math.abs(i - j) / (k - 1) : 1);
  let po = 0, pe = 0, pow = 0, pew = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const o = table[i][j] / n;
      const e = rows[i] * cols[j];
      if (i === j) { po += o; pe += e; }
      pow += w(i, j) * o;
      pew += w(i, j) * e;
    }
  }
  // Floating-point: a table with one populated category gives pe = 0.9999…
  const EPS = 1e-12;
  return {
    n,
    agreement: po,
    kappa: 1 - pe > EPS ? (po - pe) / (1 - pe) : null,
    weightedKappa: 1 - pew > EPS ? (pow - pew) / (1 - pew) : null,
  };
}

/** Kappa over paired category indexes (0-based, `k` categories). */
export function kappaFromPairs(pairs: Array<[number, number]>, k = 3): KappaResult {
  const table = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  for (const [a, b] of pairs) table[a][b] += 1;
  return kappaFromTable(table);
}

/** Landis & Koch (1977), the conventional plain-English reading of kappa. */
export function kappaStrength(kappa: number | null): string {
  if (kappa === null || !Number.isFinite(kappa)) return '';
  if (kappa < 0) return 'Poor';
  if (kappa <= 0.2) return 'Slight';
  if (kappa <= 0.4) return 'Fair';
  if (kappa <= 0.6) return 'Moderate';
  if (kappa <= 0.8) return 'Substantial';
  return 'Almost perfect';
}

/** Y≡PY and N≡PN; No information stays its own answer. */
export function collapseAnswer(code: AnswerCode): 'Y' | 'N' | 'NI' | 'NA' {
  if (code === 'Y' || code === 'PY') return 'Y';
  if (code === 'N' || code === 'PN') return 'N';
  return code;
}

/** One reviewer's side of a compared target. */
export interface AgreementSide {
  entry: Assessment;
  d1: StudyD1;
}

export interface DomainAgreement extends KappaResult {
  /** 0–4 for D1–D5, 5 for Overall. */
  domain: number;
  strength: string;
  /** Signalling questions both reviewers answered in this domain (Overall: none). */
  signalling: { n: number; exact: number | null; collapsed: number | null };
}

/** Fewer pairs than this and no statistic is reported. */
export const MIN_PAIRS = 2;

/**
 * Agreement between R1 and R2 per domain and Overall, over targets both of
 * them completed. A domain judgement one of them left empty (a legacy entry)
 * drops out of that domain only.
 *
 * Signalling agreement counts questions BOTH answered — a question one reviewer
 * never reached was routed out by an earlier answer, and that disagreement is
 * already counted where it happened. D2 is compared only when both judged under
 * the same effect of interest, because the adhering and assignment pathways ask
 * different questions under the same numbers.
 */
export function interRater(pairs: Array<[AgreementSide, AgreementSide]>): DomainAgreement[] {
  const out: DomainAgreement[] = [];
  for (let d = 0; d <= 5; d++) {
    const cats: Array<[number, number]> = [];
    let sigN = 0, sigExact = 0, sigCollapsed = 0;
    for (const [a, b] of pairs) {
      const ja = d === 5 ? a.entry.overall : a.entry.judgement[d];
      const jb = d === 5 ? b.entry.overall : b.entry.judgement[d];
      if (ja && jb) cats.push([CATEGORY[ja], CATEGORY[jb]]);
      if (d === 5 || (d === 1 && a.entry.effect !== b.entry.effect)) continue;
      const ma = mergedAnswers(a.d1, a.entry);
      const mb = mergedAnswers(b.d1, b.entry);
      for (const q of questionsFor(a.entry.effect).filter(x => x.domain === d)) {
        const xa = ma[q.id], xb = mb[q.id];
        if (!xa || !xb || xa === 'NA' || xb === 'NA') continue;
        sigN++;
        if (xa === xb) sigExact++;
        if (collapseAnswer(xa) === collapseAnswer(xb)) sigCollapsed++;
      }
    }
    const k = kappaFromPairs(cats);
    const enough = k.n >= MIN_PAIRS;
    out.push({
      domain: d,
      n: k.n,
      agreement: enough ? k.agreement : null,
      kappa: enough ? k.kappa : null,
      weightedKappa: enough ? k.weightedKappa : null,
      strength: enough ? kappaStrength(k.kappa) : '',
      signalling: {
        n: sigN,
        exact: sigN ? sigExact / sigN : null,
        collapsed: sigN ? sigCollapsed / sigN : null,
      },
    });
  }
  return out;
}

// ── Distribution (summary bar chart) ─────────────────────────────────────────

export interface Distribution {
  /** 0–4 for D1–D5, 5 for Overall. */
  domain: number;
  n: number;
  low: number;
  some: number;
  high: number;
  none: number;
}

/** Counts per domain + Overall. Unweighted: each study × target counts once. */
export function distribution(rows: ReportRow[]): Distribution[] {
  return [0, 1, 2, 3, 4, 5].map(domain => {
    const d: Distribution = { domain, n: rows.length, low: 0, some: 0, high: 0, none: 0 };
    for (const r of rows) {
      const j = domain === 5 ? r.overall : r.domains[domain];
      if (j) d[j]++;
      else d.none++;
    }
    return d;
  });
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * One CSV cell. Quotes when needed; a leading `=`, `+` or `@` is prefixed with
 * an apostrophe so a rationale that starts with one is not run as a formula
 * when the file is opened in a spreadsheet.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM + CRLF, so Excel opens accented study names and quotes correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map(r => r.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

const DIRECTION_TEXT: Record<Direction, string> = {
  exp: 'Favours experimental', comp: 'Favours comparator', null: 'Towards null',
  away: 'Away from null', unpred: 'Unpredictable',
};

function judgementWord(j: Judgement | 'none' | null | undefined): string {
  return j && j !== 'none' ? JUDGEMENT_LABEL[j] : '';
}

/** "p. 4" for a bare page number, otherwise the stored locator as written. */
function locatorText(locator: string): string {
  const t = locator.trim();
  return /^\d+$/.test(t) ? `p. ${t}` : t;
}

/** "1.1=Y; 1.2=PN; 1.3=NA" for one domain — NA where the question was routed out. */
export function signallingText(entry: Assessment, d1: StudyD1, domain: number): string {
  const merged = mergedAnswers(d1, entry);
  const route = routeAllFor(merged, pathwayOf(entry));
  return questionsFor(entry.effect).filter(q => q.domain === domain).map(q => {
    const code = merged[q.id] ?? (route[q.id] === 'skipped' ? 'NA' : '');
    return `${q.id}=${code || '—'}`;
  }).join('; ');
}

/** The per-question support text and linked quotes of one domain. */
function evidenceOf(entry: Assessment, d1: StudyD1, domain: number): { support: string; quotes: string } {
  const ids = questionsFor(entry.effect).filter(q => q.domain === domain).map(q => q.id);
  // D1 lives at the study root unless this assessment answered it itself.
  const fromStudy = domain === 0 && !entry.d1Override;
  const support = fromStudy ? d1.support : entry.support;
  const quotes = fromStudy ? d1.quotes : entry.quotes;
  return {
    support: ids.filter(id => support[id]?.trim()).map(id => `${id}: ${support[id].trim()}`).join(' | '),
    quotes: ids.filter(id => quotes[id]?.quote?.trim()).map(id => {
      const q = quotes[id];
      const where = locatorText(q.locator ?? '')
        || (typeof q.location?.page === 'number' ? `p. ${q.location.page}` : '');
      return `${id}: "${q.quote.trim()}"${where ? ` (${where})` : ''}`;
    }).join(' | '),
  };
}

const IDENTITY_HEADER = [
  'study_label', 'citation', 'target_kind', 'outcome', 'measurement', 'timepoint',
  'analysis_population', 'analysis', 'comparison', 'effect_of_interest', 'source', 'reviewer', 'status',
];

function identityCells(r: ReportRow): string[] {
  return [
    r.studyLabel, r.citation, r.kind === 'outcome' ? 'Outcome' : 'Result', r.outcome, r.measurement,
    r.timepoint, r.analysisPopulation, r.analysis, r.comparison, EFFECT_LABEL[r.effect],
    r.source, r.reviewer, r.status,
  ];
}

function completedCells(r: ReportRow): string[] {
  return [r.complete ? 'yes' : 'no', r.complete && r.completedAt ? r.completedAt.slice(0, 10) : ''];
}

/** Long format: one line per study × target × domain, plus one for Overall. */
export function longCsv(rows: ReportRow[]): string {
  const header = [
    ...IDENTITY_HEADER, 'domain', 'domain_name', 'signalling_answers', 'suggested_judgement',
    'judgement', 'direction', 'rationale', 'support', 'quotes', 'completed', 'completed_at',
  ];
  const lines: string[][] = [];
  for (const r of rows) {
    const derived = r.entry && r.d1 ? derive(r.d1, r.entry) : null;
    for (let d = 0; d <= 5; d++) {
      const overall = d === 5;
      const ev = r.entry && r.d1 && !overall ? evidenceOf(r.entry, r.d1, d) : { support: '', quotes: '' };
      const dir = r.entry ? (overall ? r.entry.overallDirection : r.entry.direction[d]) : '';
      lines.push([
        ...identityCells(r),
        overall ? 'Overall' : `D${d + 1}`,
        overall ? 'Overall risk of bias' : DOMAIN_TITLE[d],
        r.entry && r.d1 && !overall ? signallingText(r.entry, r.d1, d) : '',
        derived ? judgementWord(overall ? derived.overallSuggestion.severity : derived.suggestions[d].severity) : '',
        judgementWord(overall ? r.overall : r.domains[d]),
        dir ? DIRECTION_TEXT[dir] : '',
        r.entry ? (overall ? r.entry.overallRationale : r.entry.rationale[d]) : '',
        ev.support,
        ev.quotes,
        ...completedCells(r),
      ]);
    }
  }
  return toCsv(header, lines);
}

/** Wide format: one line per study × target, D1–D5 + Overall side by side. */
export function wideCsv(rows: ReportRow[]): string {
  const codes = ['D1', 'D2', 'D3', 'D4', 'D5', 'Overall'];
  const header = [
    ...IDENTITY_HEADER, ...codes, ...codes.map(c => `${c}_rationale`), 'completed', 'completed_at',
  ];
  const lines = rows.map(r => [
    ...identityCells(r),
    ...r.domains.map(judgementWord), judgementWord(r.overall),
    ...[0, 1, 2, 3, 4].map(d => r.entry?.rationale[d] ?? ''), r.entry?.overallRationale ?? '',
    ...completedCells(r),
  ]);
  return toCsv(header, lines);
}

/** "0.68" / "—". */
export function formatKappa(k: number | null): string {
  return k === null || !Number.isFinite(k) ? '—' : k.toFixed(2);
}

/** "83%" / "—". */
export function formatPct(p: number | null): string {
  return p === null || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`;
}
