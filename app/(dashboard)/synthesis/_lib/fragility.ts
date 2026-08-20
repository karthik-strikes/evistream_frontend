/**
 * How many patients' outcomes it would take to undo each trial's result.
 *
 * The Fragility Index (Walsh et al., J Clin Epidemiol 2014): starting from a
 * significant 2×2, convert one non-event to an event at a time — in the arm with
 * fewer events, the direction that narrows the gap — until Fisher's exact p
 * reaches 0.05. The count is the index; divided by the trial's size it is the
 * Fragility Quotient.
 *
 * Why it belongs on a synthesis screen: a pooled estimate inherits its
 * significance from its studies, and a corpus whose contributing trials each turn
 * on two or three patients is a different kind of evidence from one whose trials
 * turn on fifty — a difference that no confidence interval on the plot shows.
 *
 * Ported from The Biostat Toolkit (StatProf1234/Stats-Educator, `calculators.js`),
 * including its termination fallback: when the arm being modified runs out of
 * non-events, it switches to removing events from the other arm, so the loop ends
 * on a real table instead of running past the available patients.
 */

import { isBinaryArm, type StudyEffect } from '@/lib/metaAnalysis';

/** ln C(n, k), via lgamma, so large tables do not overflow. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Lanczos approximation — the standard one, good to ~1e-13 over this range. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Two-sided Fisher's exact p — the sum of every table at least as unlikely as the
 * observed one, under fixed margins. Matches R's `fisher.test` convention.
 */
export function fisherExactTwoSidedP(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = row1 + row2;
  if (row1 <= 0 || row2 <= 0 || col1 <= 0 || n - col1 <= 0) return NaN;

  const logDenom = logChoose(n, col1);
  const lo = Math.max(0, col1 - row2);
  const hi = Math.min(row1, col1);
  const probs: number[] = [];
  for (let x = lo; x <= hi; x++) {
    probs.push(Math.exp(logChoose(row1, x) + logChoose(row2, col1 - x) - logDenom));
  }
  const total = probs.reduce((s, v) => s + v, 0);
  const observed = probs[a - lo];
  if (observed === undefined) return NaN;
  const threshold = observed * (1 + 1e-7);
  let p = 0;
  for (const prob of probs) if (prob <= threshold) p += prob;
  return Math.min(p / total, 1);
}

export type FragilityOutcome =
  | { kind: 'fragile'; index: number; quotient: number; finalP: number; flippedIn: 1 | 2 }
  | { kind: 'not_significant'; p: number }
  | { kind: 'not_computable'; p: number }
  | { kind: 'not_applicable' };

export interface FragilityRow {
  key: string;
  label: string;
  p: number | null;
  outcome: FragilityOutcome;
}

const ALPHA = 0.05;

/**
 * One trial's fragility. `not_significant` is not a failure — the index is only
 * defined for a result that starts out significant, and saying so is more useful
 * than a blank cell.
 */
export function fragilityOf(a: number, b: number, c: number, d: number): FragilityOutcome {
  if (![a, b, c, d].every(v => Number.isFinite(v) && v >= 0 && Number.isInteger(v))) {
    return { kind: 'not_applicable' };
  }
  const n = a + b + c + d;
  if (a + b <= 0 || c + d <= 0) return { kind: 'not_applicable' };

  const p0 = fisherExactTwoSidedP(a, b, c, d);
  if (!Number.isFinite(p0)) return { kind: 'not_applicable' };
  if (!(p0 < ALPHA)) return { kind: 'not_significant', p: p0 };

  let e1 = a;
  let ne1 = b;
  let e2 = c;
  let ne2 = d;
  let group: 1 | 2 = e1 <= e2 ? 1 : 2;
  const started: 1 | 2 = group;
  let steps = 0;
  const cap = n + 5;
  let p = p0;

  while (p < ALPHA && steps < cap) {
    if (group === 1) {
      if (ne1 > 0) { e1 += 1; ne1 -= 1; }
      else if (e2 > 0) { group = 2; e2 -= 1; ne2 += 1; }
      else return { kind: 'not_computable', p: p0 };
    } else {
      if (ne2 > 0) { e2 += 1; ne2 -= 1; }
      else if (e1 > 0) { group = 1; e1 -= 1; ne1 += 1; }
      else return { kind: 'not_computable', p: p0 };
    }
    steps += 1;
    p = fisherExactTwoSidedP(e1, ne1, e2, ne2);
  }

  if (!(p >= ALPHA)) return { kind: 'not_computable', p: p0 };
  return { kind: 'fragile', index: steps, quotient: steps / n, finalP: p, flippedIn: started };
}

/**
 * Fragility for every plotted study that has 2×2 counts.
 *
 * Studies without them — a continuous outcome, a pre-computed effect, a
 * prevalence — come back `not_applicable` rather than being dropped, so the panel
 * accounts for the whole plot instead of quietly showing a subset.
 */
export function fragilityTable(studies: StudyEffect[]): FragilityRow[] {
  return studies.map(s => {
    const t = s.treatment;
    const c = s.comparator;
    if (!t || !c || !isBinaryArm(t) || !isBinaryArm(c)) {
      return { key: s.key, label: s.label, p: null, outcome: { kind: 'not_applicable' } as const };
    }
    const outcome = fragilityOf(
      Math.round(t.events), Math.round(t.total - t.events),
      Math.round(c.events), Math.round(c.total - c.events),
    );
    const p = outcome.kind === 'fragile' ? null
      : outcome.kind === 'not_significant' || outcome.kind === 'not_computable' ? outcome.p
      : null;
    return {
      key: s.key,
      label: s.label,
      p: outcome.kind === 'fragile'
        ? fisherExactTwoSidedP(
            Math.round(t.events), Math.round(t.total - t.events),
            Math.round(c.events), Math.round(c.total - c.events),
          )
        : p,
      outcome,
    };
  });
}

/** One line for the panel: what the fragility of this corpus adds up to. */
export function fragilitySummary(rows: FragilityRow[]): string | null {
  const fragile = rows.filter(r => r.outcome.kind === 'fragile') as Array<
    FragilityRow & { outcome: Extract<FragilityOutcome, { kind: 'fragile' }> }
  >;
  if (fragile.length === 0) {
    const anyApplicable = rows.some(r => r.outcome.kind !== 'not_applicable');
    return anyApplicable
      ? 'No contributing trial reached significance on its own, so there is no fragility index to '
        + 'report for any of them. That is common — and it is what a meta-analysis is for.'
      : null;
  }
  const indices = fragile.map(f => f.outcome.index).sort((a, b) => a - b);
  const median = indices[Math.floor(indices.length / 2)];
  const smallest = indices[0];
  return `${fragile.length} of ${rows.length} ${rows.length === 1 ? 'trial' : 'trials'} reached `
    + `significance on its own. Their median fragility index is ${median}, and the least robust turns `
    + `on ${smallest} ${smallest === 1 ? 'patient' : 'patients'} — that many outcomes changing would `
    + `make it non-significant.`;
}
