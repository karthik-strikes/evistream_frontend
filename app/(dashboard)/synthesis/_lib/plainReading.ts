/**
 * The pooled result, in a sentence a reviewer could paste into a paper.
 *
 * A forest plot is a summary a trained reader decodes; this is the same content
 * for the reader who is going to quote it. That makes over-claiming the only real
 * risk here, so the wording follows fixed rules rather than sounding confident:
 *
 *  - An interval containing the null is described as *compatible with no
 *    difference*, never as "no difference" or "no effect". Absence of a
 *    significant result is not evidence of absence, and the sentence must not
 *    imply it is.
 *  - An odds ratio is never restated as a change in risk. That conversion needs a
 *    baseline, and the absolute-effect card is where it happens, with the baseline
 *    named.
 *  - Heterogeneity, a small corpus, and a prediction interval each add a clause
 *    when they apply and are silent when they do not, so the reading gets longer
 *    exactly when the result is more fragile.
 *  - Nothing here is computed. Every number comes off `MetaResult`, so the
 *    sentence cannot disagree with the plot above it.
 *
 * Pure function of the result; returns paragraphs.
 */

import {
  describeAbsolute, EFFECT_LABEL, isRatioMeasure, isSingleGroupMeasure, MIN_POOLABLE,
  type MetaResult,
} from '@/lib/metaAnalysis';

/** Cohen's conventional bands for a correlation, named as conventions. */
function correlationStrength(r: number): string {
  const a = Math.abs(r);
  if (a < 0.1) return 'negligible';
  if (a < 0.3) return 'small';
  if (a < 0.5) return 'moderate';
  return 'large';
}

function pct(v: number, dp = 1): string {
  return `${(v * 100).toFixed(dp)}%`;
}

function num(v: number): string {
  return v.toFixed(2);
}

export function plainReading(
  result: MetaResult,
  context: { outcomeLabel: string; comparisonLabel: string },
): string[] {
  const paragraphs: string[] = [];
  const k = result.studies.length;
  const outcome = context.outcomeLabel.trim() || 'this outcome';

  if (result.poolingMethodRefusal) {
    return [
      `No pooled estimate was produced for ${outcome}: ${result.poolingMethodRefusal}`,
      `The ${k} ${k === 1 ? 'study' : 'studies'} above are still shown individually, and the `
      + `inclusion ledger accounts for every one that was excluded.`,
    ];
  }

  if (!result.pooled) {
    return [
      k === 0
        ? `Nothing was pooled for ${outcome}: no study in this selection produced a usable estimate. `
          + `The inclusion ledger says why for each one.`
        : `${k} ${k === 1 ? 'study' : 'studies'} matched this selection, which is fewer than the `
          + `${MIN_POOLABLE} a pooled estimate is shown for. The individual estimates are above; a `
          + `pooled number from ${k} would carry more authority than it earns.`,
    ];
  }

  const { est, lo, hi } = result.pooled;
  const measure = result.measure;

  // ── The headline ──────────────────────────────────────────────────────────
  if (measure === 'PROP') {
    paragraphs.push(
      `Pooling ${k} ${k === 1 ? 'study' : 'studies'}, the ${outcome.toLowerCase()} prevalence was `
      + `${pct(est)} (95% CI ${pct(lo)} to ${pct(hi)}). `
      + `That is an average across the included studies, not a value any one of them reported.`,
    );
  } else if (measure === 'R') {
    const dir = est < 0 ? 'negative' : 'positive';
    paragraphs.push(
      `Pooling ${k} ${k === 1 ? 'correlation' : 'correlations'}, the association with ${outcome} was `
      + `r = ${num(est)} (95% CI ${num(lo)} to ${num(hi)}) — a ${correlationStrength(est)} ${dir} `
      + `association by Cohen's conventional bands. `
      + (lo <= 0 && hi >= 0
        ? `The interval includes zero, so this pool is compatible with no association.`
        : `The interval excludes zero.`),
    );
  } else if (isRatioMeasure(measure)) {
    const crosses = lo <= 1 && hi >= 1;
    const lower = est < 1;
    const magnitude = Math.abs(1 - est) * 100;
    const quantity = measure === 'OR' ? 'odds' : measure === 'HR' ? 'hazard' : 'risk';
    const relative = measure === 'OR' || measure === 'HR' || measure === 'RATIO'
      // An odds ratio is not a risk ratio, and a hazard ratio is not either. Give
      // the ratio itself rather than a percentage a reader would read as risk.
      ? `${EFFECT_LABEL[measure]} ${num(est)} (95% CI ${num(lo)} to ${num(hi)})`
      // "0% higher" is not a finding. Below half a percentage point the honest
      // phrasing is that the pooled estimate sits on no difference.
      : magnitude < 0.5
        ? `essentially unchanged (${EFFECT_LABEL[measure]} ${num(est)}, 95% CI ${num(lo)} to ${num(hi)})`
        : `${magnitude.toFixed(0)}% ${lower ? 'lower' : 'higher'} `
          + `(${EFFECT_LABEL[measure]} ${num(est)}, 95% CI ${num(lo)} to ${num(hi)})`;
    paragraphs.push(
      `Pooling ${k} ${k === 1 ? 'study' : 'studies'}, the ${quantity} of ${outcome.toLowerCase()} `
      + `${measure === 'RR' ? 'was' : 'compared'} ${relative}. `
      + (crosses
        ? `The interval spans no difference, so this pool is compatible with no effect in either `
          + `direction — which is not the same as evidence that there is none.`
        : `The interval excludes no difference.`),
    );
  } else {
    const crosses = lo <= 0 && hi >= 0;
    const unit = measure === 'SMD' ? ' standard deviations' : measure === 'RD' ? ' (risk difference)' : '';
    paragraphs.push(
      `Pooling ${k} ${k === 1 ? 'study' : 'studies'}, ${outcome.toLowerCase()} differed by `
      + `${num(est)}${unit} (95% CI ${num(lo)} to ${num(hi)}). `
      + (crosses
        ? `The interval spans zero, so this pool is compatible with no difference in either `
          + `direction — which is not the same as evidence that there is none.`
        : `The interval excludes zero.`),
    );
  }

  // ── How well the average describes the studies ────────────────────────────
  const caveats: string[] = [];
  if (result.heterogeneity) {
    const h = result.heterogeneity;
    // tau-squared only where it was actually estimated: a fixed-effect pool
    // reports it as 0 by construction, and quoting that would imply the studies
    // were found to agree rather than assumed to.
    const tau = result.model === 'random' ? `τ² = ${h.tau2.toFixed(3)}, ` : '';
    caveats.push(
      `Heterogeneity was ${h.label.toLowerCase()} (I² = ${h.i2.toFixed(0)}%, `
      + `${tau}Q = ${h.q.toFixed(1)} on ${h.df} df)`
      + (h.i2 >= 50
        ? `, so the studies are not all estimating the same thing and the pooled average describes `
          + `them loosely. Look at the subgroup and sensitivity panels before quoting it.`
        : `.`),
    );
  }
  if (result.glmm) {
    caveats.push(
      `The one-stage model estimated a between-study variance of τ² = ${result.glmm.tau2.toFixed(3)} `
      + `on the logit scale; it has no I² to report.`,
    );
  }
  if (result.prediction) {
    const fmt = measure === 'PROP' ? (v: number) => pct(v) : num;
    caveats.push(
      `A future study in a similar population would be expected to fall between `
      + `${fmt(result.prediction.lo)} and ${fmt(result.prediction.hi)} — wider than the confidence `
      + `interval because it carries the spread between studies as well as the uncertainty in the `
      + `average.`,
    );
  }
  if (k < 5 && !isSingleGroupMeasure(measure)) {
    caveats.push(
      `With ${k} studies the between-study variance is estimated imprecisely, so treat the interval's `
      + `exact width as illustrative.`,
    );
  }
  if (result.hksj && result.hksj.narrower === false) {
    caveats.push(
      `Referring the same estimate to the Hartung–Knapp interval — which stops assuming the `
      + `between-study variance is known — gives ${num(result.hksj.lo)} to ${num(result.hksj.hi)}.`,
    );
  }
  if (caveats.length) paragraphs.push(caveats.join(' '));

  // ── What it means for patients ────────────────────────────────────────────
  if (result.absolute) {
    const a = result.absolute;
    const described = describeAbsolute(a);
    paragraphs.push(
      `In absolute terms, against ${a.riskSource === 'corpus' ? 'this corpus’s own' : 'an assumed'} `
      + `comparator risk of ${pct(a.comparatorRisk)}, that is ${described.headline} `
      + `(95% CI ${described.interval})`
      + (described.nnt
        ? `, or one additional ${a.nntKind === 'benefit' ? 'benefit' : 'harm'} for every ${a.nnt} `
          + `patients treated${a.nntLo != null && a.nntHi != null ? ` (95% CI ${a.nntLo} to ${a.nntHi})` : ''}.`
        : `. The difference is too small to express usefully as a number needed to treat.`),
    );
  }

  // ── What was left out ─────────────────────────────────────────────────────
  const excluded = result.notEstimable.length;
  if (excluded > 0 || result.correctedCount > 0) {
    const bits: string[] = [];
    if (excluded > 0) {
      bits.push(
        `${excluded} matched ${excluded === 1 ? 'study is' : 'studies are'} not in this pool because `
        + `${excluded === 1 ? 'it' : 'they'} could not produce an estimate`,
      );
    }
    if (result.correctedCount > 0) {
      bits.push(
        `${result.correctedCount} ${result.correctedCount === 1 ? 'study' : 'studies'} needed a `
        + `continuity correction to be estimable at all`,
      );
    }
    paragraphs.push(`${bits.join(', and ')} — the inclusion ledger names each one.`);
  }

  return paragraphs;
}
