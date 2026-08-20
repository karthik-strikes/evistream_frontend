/**
 * The formulas and notation behind whatever this particular analysis did.
 *
 * Selected from the result rather than listed exhaustively: a fixed-effect
 * inverse-variance pool must not display a between-study variance it never
 * estimated, and a Mantel–Haenszel pool must not display the inverse-variance
 * weights it did not use. A methods panel that lists everything the app *can* do
 * is decoration; one that lists what it *did* is auditable, and can be copied
 * into a methods section as it stands.
 *
 * LaTeX strings only — rendering is the panel's job.
 */

import { isRatioMeasure, type MetaResult } from '@/lib/metaAnalysis';

export interface Formula {
  label: string;
  latex: string;
  /** One sentence on what it is for, in the reviewer's terms. */
  note: string;
}

export interface NotationEntry {
  symbol: string;
  meaning: string;
}

export function methodsFormulas(result: MetaResult): Formula[] {
  const out: Formula[] = [];
  const ratio = isRatioMeasure(result.measure);

  // How each study's own effect was formed.
  if (result.measure === 'PROP') {
    if (result.proportionMethod === 'glmm') {
      out.push({
        label: 'One-stage binomial-normal model',
        latex: String.raw`x_i \mid u_i \sim \mathrm{Binomial}(n_i, p_i), \quad `
          + String.raw`\mathrm{logit}(p_i) = \mu + u_i, \quad u_i \sim N(0, \tau^2)`,
        note: 'Fitted to the raw counts by maximum likelihood, so no continuity correction is used '
          + 'anywhere — including for a study reporting 0% or 100%.',
      });
      out.push({
        label: 'Back-transformation',
        latex: String.raw`\hat p = \frac{e^{\hat\mu}}{1 + e^{\hat\mu}}`,
        note: 'The exact inverse of the logit, applied to the estimate and to each interval bound, '
          + 'which is why the interval is asymmetric in proportion space.',
      });
    } else if (result.proportionMethod === 'arcsine') {
      out.push({
        label: 'Arcsine (Fisher) transform',
        latex: String.raw`\varphi_i = \arcsin\sqrt{\hat p_i}, \qquad \mathrm{Var}(\varphi_i) = \frac{1}{4 n_i}`,
        note: 'The variance does not depend on the proportion, so a study at 0% or 100% keeps a '
          + 'sensible weight with no correction.',
      });
      out.push({
        label: 'Back-transformation',
        latex: String.raw`\hat p = \sin^2(\hat\varphi), \quad \hat\varphi \in [0, \tfrac{\pi}{2}]`,
        note: 'Clamped to the arcsine range before squaring — past π/2 the sine turns back downward '
          + 'and a wide bound would fold onto the wrong side of the interval.',
      });
    } else if (result.proportionMethod === 'logit') {
      out.push({
        label: 'Logit transform',
        latex: String.raw`\ell_i = \ln\frac{x_i}{n_i - x_i}, \qquad `
          + String.raw`\mathrm{Var}(\ell_i) = \frac{1}{x_i} + \frac{1}{n_i - x_i}`,
        note: 'A study at 0% or 100% has no finite logit, so 0.5 is added to its cells — the case the '
          + 'one-stage model avoids.',
      });
    } else {
      out.push({
        label: 'Untransformed proportion',
        latex: String.raw`\hat p_i = \frac{x_i}{n_i}, \qquad \mathrm{Var}(\hat p_i) = \frac{\hat p_i(1-\hat p_i)}{n_i}`,
        note: 'Pooled as reported. Near 0% or 100% the variance collapses and a single study can take '
          + 'almost all the weight.',
      });
    }
  } else if (result.measure === 'R') {
    out.push({
      label: "Fisher's z transform",
      latex: String.raw`z_i = \tfrac{1}{2}\ln\frac{1 + r_i}{1 - r_i}, \qquad \mathrm{Var}(z_i) = \frac{1}{n_i - 3}`,
      note: "A correlation's own variance depends on the correlation, so pooling happens on z and the "
        + 'result is transformed back with tanh.',
    });
  } else if (result.measure === 'RR' || result.measure === 'OR' || result.measure === 'RD') {
    out.push({
      label: `Per-study ${result.measure}`,
      latex: result.measure === 'RD'
        ? String.raw`RD_i = \frac{a_i}{n_{1i}} - \frac{c_i}{n_{2i}}, \quad `
          + String.raw`\mathrm{Var} = \frac{p_1(1-p_1)}{n_1} + \frac{p_2(1-p_2)}{n_2}`
        : result.measure === 'RR'
          ? String.raw`\ln RR_i = \ln\frac{a_i / n_{1i}}{c_i / n_{2i}}, \quad `
            + String.raw`\mathrm{Var} = \frac{1}{a_i} - \frac{1}{n_{1i}} + \frac{1}{c_i} - \frac{1}{n_{2i}}`
          : String.raw`\ln OR_i = \ln\frac{a_i d_i}{b_i c_i}, \quad `
            + String.raw`\mathrm{Var} = \frac{1}{a_i} + \frac{1}{b_i} + \frac{1}{c_i} + \frac{1}{d_i}`,
      note: result.correctedCount > 0
        ? `0.5 was added to every cell of ${result.correctedCount} study with a zero cell, so a `
          + 'ratio could be formed at all.'
        : 'Formed from the 2×2 counts as extracted; no study needed a continuity correction.',
    });
  } else if (result.measure === 'MD' || result.measure === 'SMD') {
    out.push({
      label: `Per-study ${result.measure}`,
      latex: result.measure === 'MD'
        ? String.raw`MD_i = \bar x_{1i} - \bar x_{2i}, \qquad \mathrm{Var} = \frac{s_1^2}{n_1} + \frac{s_2^2}{n_2}`
        : String.raw`g_i = J \cdot \frac{\bar x_1 - \bar x_2}{s_{\text{pooled}}}, \quad `
          + String.raw`J = 1 - \frac{3}{4(n_1 + n_2) - 9}`,
      note: result.measure === 'SMD'
        ? "Hedges' g — Cohen's d with the small-sample correction applied, which is the standardised "
          + 'difference meta-analysis expects.'
        : 'On the outcome’s own scale, so every study must be measuring it the same way.',
    });
  } else {
    out.push({
      label: 'Per-study effect',
      latex: String.raw`y_i, \quad \mathrm{SE}_i \;\; \text{as reported}`,
      note: 'Taken from the published estimate and its precision; where only a confidence interval was '
        + 'reported, SE = (upper − lower) / 3.92 on the analysis scale.',
    });
  }

  // How they were combined.
  if (result.model === 'mh') {
    out.push({
      label: 'Mantel–Haenszel pooling',
      latex: result.measure === 'RR'
        ? String.raw`RR_{MH} = \frac{\sum a_i (c_i + d_i) / n_i}{\sum c_i (a_i + b_i) / n_i}`
        : String.raw`OR_{MH} = \frac{\sum a_i d_i / n_i}{\sum b_i c_i / n_i}`,
      note: 'Pooled from the raw counts, with the '
        + (result.measure === 'RR' ? 'Greenland–Robins' : 'Robins–Breslow–Greenland')
        + ' variance — no continuity correction is needed, which is the reason to prefer it when '
        + 'events are rare.',
    });
  } else if (result.model === 'peto') {
    out.push({
      label: "Peto's odds ratio",
      latex: String.raw`\hat\psi = \exp\!\left(\frac{\sum (a_i - E_i)}{\sum V_i}\right), \qquad `
        + String.raw`\mathrm{Var}(\ln\hat\psi) = \frac{1}{\sum V_i}`,
      note: 'A one-step estimator around the null. Least biased for very rare events with balanced '
        + 'arms; most biased when the arms are unbalanced or the effect is large.',
    });
  } else if (!result.glmm) {
    out.push({
      label: 'Inverse-variance weights',
      latex: result.model === 'random'
        ? String.raw`w_i^{*} = \frac{1}{\mathrm{Var}(y_i) + \tau^2}, \qquad `
          + String.raw`\hat\theta = \frac{\sum w_i^{*} y_i}{\sum w_i^{*}}`
        : String.raw`w_i = \frac{1}{\mathrm{Var}(y_i)}, \qquad \hat\theta = \frac{\sum w_i y_i}{\sum w_i}`,
      note: result.model === 'random'
        ? 'Each study weighted by its precision plus the between-study variance, so a large study '
          + 'cannot dominate a heterogeneous corpus.'
        : 'Each study weighted purely by its precision — every study assumed to estimate one common '
          + 'effect.',
    });
  }

  if (result.model === 'random' && result.heterogeneity) {
    out.push({
      label: 'DerSimonian–Laird between-study variance',
      latex: String.raw`\tau^2 = \max\!\left(0, \frac{Q - (k-1)}{C}\right), \quad `
        + String.raw`Q = \sum w_i (y_i - \hat\theta_{FE})^2, \quad C = \sum w_i - \frac{\sum w_i^2}{\sum w_i}`,
      note: 'How much the studies disagree beyond sampling error. Q on k−1 df is the test of that '
        + 'disagreement; I² = (Q − df)/Q is the share of variation it accounts for.',
    });
  }

  if (result.hksj) {
    out.push({
      label: 'Hartung–Knapp–Sidik–Jonkman interval',
      latex: String.raw`q = \frac{1}{k-1}\sum w_i^{*}(y_i - \hat\theta)^2, \qquad `
        + String.raw`\hat\theta \pm t_{k-1,\,0.975}\sqrt{\frac{q}{\sum w_i^{*}}}`,
      note: 'The same estimate with an interval that stops treating τ² as known. Usually wider; '
        + 'narrower when q < 1, which is flagged where it happens.',
    });
  }

  if (result.prediction) {
    out.push({
      label: 'Prediction interval',
      latex: String.raw`\hat\theta \pm t_{k-2,\,0.975}\sqrt{\tau^2 + \mathrm{SE}(\hat\theta)^2}`,
      note: 'Where a future study is expected to fall (Higgins, Thompson & Spiegelhalter 2009). The t '
        + 'multiplier matters: τ² was estimated from these k studies, not known.',
    });
  }

  if (result.absolute) {
    out.push({
      label: 'Absolute effect',
      latex: ratio && result.measure === 'OR'
        ? String.raw`p_1 = \frac{OR \cdot \mathrm{odds}_0}{1 + OR \cdot \mathrm{odds}_0}, \quad `
          + String.raw`\mathrm{odds}_0 = \frac{p_0}{1 - p_0}, \quad NNT = \left\lceil \frac{1}{|p_1 - p_0|} \right\rceil`
        : String.raw`p_1 = p_0 \times RR, \qquad NNT = \left\lceil \frac{1}{|p_1 - p_0|} \right\rceil`,
      note: 'The relative effect applied to an assumed comparator risk p₀. The interval is the '
        + 'relative one restated, so it carries no uncertainty about p₀ itself.',
    });
  }

  return out;
}

/** Only the symbols the formulas above actually use. */
export function methodsNotation(result: MetaResult): NotationEntry[] {
  const out: NotationEntry[] = [
    { symbol: 'k', meaning: 'number of studies contributing to the pooled estimate' },
  ];

  if (result.measure === 'PROP') {
    out.push(
      { symbol: 'x_i,\; n_i', meaning: 'events and total assessed in study i' },
      { symbol: '\\hat p', meaning: 'pooled proportion, back on the 0–100% scale' },
    );
    if (result.glmm) {
      out.push(
        { symbol: 'u_i', meaning: "study i's own departure from the average, on the logit scale" },
        { symbol: '\\mu', meaning: 'pooled effect on the logit scale, before back-transformation' },
      );
    }
  } else if (result.measure === 'R') {
    out.push(
      { symbol: 'r_i,\; n_i', meaning: "study i's correlation and its sample size" },
      { symbol: 'z_i', meaning: "the same correlation on Fisher's z scale, where pooling happens" },
    );
  } else if (result.model === 'mh' || result.model === 'peto') {
    out.push(
      { symbol: 'a_i,\; b_i,\; c_i,\; d_i', meaning: "study i's 2×2 cells: treatment events and non-events, then comparator" },
      { symbol: 'n_i', meaning: 'total participants in study i' },
    );
    if (result.model === 'peto') {
      out.push(
        { symbol: 'E_i', meaning: 'treatment events expected in study i if there were no effect' },
        { symbol: 'V_i', meaning: 'hypergeometric variance of that expected count' },
      );
    }
  } else {
    out.push({ symbol: 'y_i', meaning: "study i's effect on the analysis scale (log, for a ratio measure)" });
  }

  if (!result.glmm && result.model !== 'mh' && result.model !== 'peto') {
    out.push({ symbol: 'w_i', meaning: 'the weight study i actually received' });
  }
  out.push({ symbol: '\\hat\\theta', meaning: 'the pooled estimate' });

  // Defined only where it was estimated. A fixed-effect pool reports tau² as 0 by
  // construction, and a notation entry for it would imply otherwise.
  if ((result.model === 'random' && result.heterogeneity) || result.glmm) {
    out.push({ symbol: '\\tau^2', meaning: 'variance of the true effects between studies' });
  }
  if (result.heterogeneity) {
    out.push(
      { symbol: 'Q', meaning: 'weighted sum of squared departures from the pooled effect' },
      { symbol: 'I^2', meaning: 'share of the variation that is between studies rather than within them' },
    );
  }
  if (result.prediction) {
    out.push({ symbol: 't_{k-2}', meaning: 'Student t multiplier on k−2 degrees of freedom' });
  }
  if (result.hksj) {
    out.push({ symbol: 'q', meaning: "HKSJ's variance-inflation factor; below 1 the interval can narrow" });
  }
  if (result.absolute) {
    out.push(
      { symbol: 'p_0,\; p_1', meaning: 'assumed risk without treatment, and the risk it implies with it' },
      { symbol: 'NNT', meaning: 'patients treated per additional event prevented or caused' },
    );
  }

  return out;
}
