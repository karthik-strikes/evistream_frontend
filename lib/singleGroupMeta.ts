/**
 * Pooling a single group: prevalences, event rates, correlations.
 *
 * These are the meta-analyses with no comparator. A prevalence has no null value
 * to sit either side of, and a correlation has no arms — so neither fits the
 * contrast machinery in `metaAnalysis.ts`, and both need a variance-stabilising
 * transform before they can be pooled at all: a proportion near 0 or 1 has almost
 * no variance and would otherwise dominate every other study, and a correlation's
 * variance depends on the correlation itself.
 *
 * The transforms and the one-stage GLMM here are ported from The Biostat Toolkit
 * (StatProf1234/Stats-Educator, `calculators.js`), including two details that
 * repay reading: the arcsine inverse has to clamp to [0, pi/2] before squaring or
 * a wide interval folds back on itself, and the GLMM integrates the random effect
 * out by Simpson's rule rather than pretending a closed form exists.
 *
 * Everything is a pure function of numbers. `runMetaAnalysis` calls in.
 */

/** Which scale a measure is pooled on, and therefore how it comes back. */
export type MeasureScale = 'identity' | 'log' | 'logit' | 'arcsine' | 'fisherz';

export type ProportionMethod = 'glmm' | 'arcsine' | 'logit' | 'raw';

export const PROPORTION_METHOD_LABEL: Record<ProportionMethod, string> = {
  glmm: 'Logit GLMM (one-stage, no correction needed)',
  arcsine: 'Arcsine (Fisher) — stable at 0% and 100%',
  logit: 'Logit (DerSimonian–Laird)',
  raw: 'Untransformed proportion',
};

export const PROPORTION_METHOD_NOTE: Record<ProportionMethod, string> = {
  glmm:
    'Fits a binomial model to the raw counts by maximum likelihood, so a study reporting 0% or 100% '
    + 'needs no continuity correction. One-stage models have no Cochran’s Q or I² — tau² is '
    + 'estimated directly instead.',
  arcsine:
    'Variance 1/(4n) does not depend on the proportion, so a study at 0% or 100% keeps a sensible '
    + 'weight without any correction. Back-transformed intervals are asymmetric, as they should be.',
  logit:
    'The conventional log-odds scale. A study at 0% or 100% has no finite logit, so 0.5 is added to '
    + 'its cells — which is exactly the case the GLMM avoids.',
  raw:
    'Pools the percentages as they stand. Simplest to explain and the least trustworthy near 0% or '
    + '100%, where the variance collapses and a study can take almost all the weight.',
};

// ── Proportions, two-stage ───────────────────────────────────────────────────

export interface TransformedStudy {
  /** Effect on the pooling scale. */
  y: number;
  /** Standard error on the pooling scale. */
  se: number;
  corrected: boolean;
}

/**
 * One study's proportion on the chosen pooling scale.
 *
 * `corrected` is true only where the transform genuinely could not be computed
 * without help — an all-or-nothing study on the logit or raw scale. The arcsine
 * transform never needs it, which is most of why it is offered.
 */
export function proportionEffectAndSE(
  events: number,
  total: number,
  method: Exclude<ProportionMethod, 'glmm'>,
): TransformedStudy | null {
  if (!Number.isFinite(events) || !Number.isFinite(total)) return null;
  if (total <= 0 || events < 0 || events > total) return null;

  if (method === 'arcsine') {
    return { y: Math.asin(Math.sqrt(events / total)), se: Math.sqrt(1 / (4 * total)), corrected: false };
  }

  const extreme = events === 0 || events === total;
  if (method === 'logit') {
    const x = extreme ? events + 0.5 : events;
    const nx = extreme ? total - events + 0.5 : total - events;
    return { y: Math.log(x / nx), se: Math.sqrt(1 / x + 1 / nx), corrected: extreme };
  }

  const n = extreme ? total + 1 : total;
  const x = extreme ? events + 0.5 : events;
  const p = x / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  if (!(se > 0)) return null;
  return { y: p, se, corrected: extreme };
}

/**
 * Back to a proportion from whichever scale it was pooled on.
 *
 * Exact algebraic inverses, applied directly to the interval bounds — which is
 * how a transformed-scale interval is supposed to be reported, and why the result
 * is asymmetric in proportion space.
 *
 * The arcsine clamp is not decoration: sin(theta)^2 only inverts arcsin(sqrt(p))
 * while theta stays inside [0, pi/2]. A wide interval or a prediction interval
 * can push a bound past pi/2, where sin turns back downward and the bound would
 * fold onto the wrong side of the interval instead of resting at 1.
 */
export function proportionInverse(theta: number, method: ProportionMethod): number {
  const clip = (v: number) => Math.max(0, Math.min(1, v));
  if (method === 'arcsine') {
    return clip(Math.sin(Math.max(0, Math.min(Math.PI / 2, theta))) ** 2);
  }
  if (method === 'logit' || method === 'glmm') return clip(invLogit(theta));
  return clip(theta);
}

export function invLogit(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Wilson score interval for a raw proportion.
 *
 * Used for the per-study intervals under the GLMM, which — being one-stage — has
 * no per-study (effect, SE) to back-transform. Unlike a Wald interval it stays
 * inside [0, 1] and still says something sensible at 0 or n events.
 */
export function wilsonCI(events: number, total: number, z = 1.96): { lo: number; hi: number } | null {
  if (!Number.isFinite(events) || !Number.isFinite(total) || total <= 0) return null;
  const p = events / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// ── Proportions, one-stage GLMM ──────────────────────────────────────────────

interface Counts {
  events: number;
  total: number;
}

/** Binomial log-likelihood without the constant term, on the logit scale. */
function binomialLogLik(events: number, total: number, theta: number): number {
  const p = invLogit(theta);
  const eps = 1e-15;
  return events * Math.log(Math.max(p, eps)) + (total - events) * Math.log(Math.max(1 - p, eps));
}

/**
 * One study's marginal log-likelihood, integrating the random effect out by
 * composite Simpson's rule over +/-8 tau — where the normal density is ~1e-14 of
 * its peak, so truncation is negligible. Not Gauss–Hermite; converges to the same
 * integral, and is verifiable by eye.
 */
function studyLogLik(events: number, total: number, mu: number, tau2: number): number {
  if (tau2 < 1e-8) return binomialLogLik(events, total, mu);
  const tau = Math.sqrt(tau2);
  const halfWidth = 8 * tau;
  const steps = 100;
  const h = (2 * halfWidth) / steps;
  const integrand = (u: number) =>
    Math.exp(binomialLogLik(events, total, mu + u))
    * (Math.exp(-(u * u) / (2 * tau2)) / (tau * Math.sqrt(2 * Math.PI)));

  let sum = integrand(-halfWidth) + integrand(halfWidth);
  for (let j = 1; j < steps; j++) {
    sum += (j % 2 === 0 ? 2 : 4) * integrand(-halfWidth + j * h);
  }
  return Math.log(Math.max((h / 3) * sum, 1e-300));
}

function totalLogLik(studies: Counts[], mu: number, tau2: number): number {
  return studies.reduce((s, st) => s + studyLogLik(st.events, st.total, mu, tau2), 0);
}

/** Golden-section maximum of a unimodal function — one evaluation per iteration. */
function goldenSectionMax(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tol = 1e-5,
  maxIter = 100,
): { x: number; value: number } {
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < maxIter && b - a > tol; i++) {
    if (fc > fd) {
      b = d; d = c; fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c; c = d; fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  const x = (a + b) / 2;
  return { x, value: f(x) };
}

/**
 * SE of mu-hat from the observed information — a numerical second derivative of
 * the profile log-likelihood. Retries with a coarser step when the curvature
 * comes back non-negative (the search has not converged), and falls back to the
 * two-stage logit fixed-effect SE only if every step fails, which is
 * deliberately conservative and reported as such by the caller.
 */
function glmmSE(studies: Counts[], muHat: number, tau2Hat: number): { se: number; fallback: boolean } {
  const curvature = (h: number): number | null => {
    const ll0 = totalLogLik(studies, muHat, tau2Hat);
    const plus = totalLogLik(studies, muHat + h, tau2Hat);
    const minus = totalLogLik(studies, muHat - h, tau2Hat);
    const second = (plus - 2 * ll0 + minus) / (h * h);
    return second < -1e-10 ? Math.sqrt(-1 / second) : null;
  };
  for (const h of [1e-3, 1e-2, 1e-1]) {
    const se = curvature(h);
    if (se != null && Number.isFinite(se)) return { se, fallback: false };
  }
  const information = studies.reduce((s, st) => {
    const extreme = st.events === 0 || st.events === st.total;
    const x = extreme ? st.events + 0.5 : st.events;
    const nx = extreme ? st.total - st.events + 0.5 : st.total - st.events;
    return s + 1 / (1 / x + 1 / nx);
  }, 0);
  return { se: information > 0 ? Math.sqrt(1 / information) : NaN, fallback: true };
}

export interface GlmmFit {
  /** Pooled logit. */
  mu: number;
  se: number;
  /** Between-study variance on the logit scale; 0 for the fixed-effect fit. */
  tau2: number;
  /** True when the SE came from the conservative fallback rather than the curvature. */
  seFallback: boolean;
}

/**
 * Fit logit(p_i) = mu + u_i, u_i ~ N(0, tau2), by maximum likelihood.
 *
 * An outer golden-section search over tau2, profiling mu out at each candidate,
 * then one final re-optimisation of mu at the winning tau2. Bounds are fixed and
 * generous (mu in [-15, 15] covers proportions from 3e-7 to 1 - 3e-7) rather than
 * data-adaptive, so no heuristic can silently narrow the search.
 */
export function fitProportionGlmm(studies: Counts[], randomEffects: boolean): GlmmFit | null {
  const usable = studies.filter(
    s => Number.isFinite(s.events) && Number.isFinite(s.total)
      && s.total > 0 && s.events >= 0 && s.events <= s.total,
  );
  if (usable.length === 0) return null;

  const MU_LO = -15;
  const MU_HI = 15;
  const tau2 = randomEffects
    ? Math.max(0, goldenSectionMax(
        t => goldenSectionMax(mu => totalLogLik(usable, mu, t), MU_LO, MU_HI, 1e-5, 80).value,
        0, 10, 1e-4, 60,
      ).x)
    : 0;
  const mu = goldenSectionMax(m => totalLogLik(usable, m, tau2), MU_LO, MU_HI, 1e-6, 80).x;
  const { se, fallback } = glmmSE(usable, mu, tau2);
  if (!Number.isFinite(mu) || !Number.isFinite(se) || !(se > 0)) return null;
  return { mu, se, tau2, seFallback: fallback };
}

// ── Correlations ─────────────────────────────────────────────────────────────

/**
 * Fisher's z. Var(z) = 1/(n-3) is used rather than the textbook 1/(n-3) vs
 * 1/(n-1) argument being fudged: 1/(n-3) is the variance of z as a pooled effect
 * (Hedges & Olkin), matching what meta-analysis software uses, and it is why four
 * observations are the minimum a correlation can enter a pool with.
 */
export function correlationEffectAndSE(r: number, n: number): TransformedStudy | null {
  if (!Number.isFinite(r) || !Number.isFinite(n)) return null;
  if (Math.abs(r) >= 1) return null;
  if (n < 4) return null;
  return { y: Math.atanh(r), se: Math.sqrt(1 / (n - 3)), corrected: false };
}

/** Back to a correlation. tanh is the exact inverse, so bounds stay inside (-1, 1). */
export function correlationInverse(z: number): number {
  return Math.tanh(z);
}
