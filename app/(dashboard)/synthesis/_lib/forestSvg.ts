/**
 * The forest plot as one self-contained SVG.
 *
 * The on-screen plot is an HTML grid — one `<svg>` per row, a CSS gradient for
 * the null line — which reads well and cannot be exported: there is no single
 * element to serialize, and a screenshot of it carries the page's own
 * background. This rebuilds the same figure as one SVG so it can be handed to a
 * manuscript: vector out, or rasterized at 3x by `lib/rasterizeSvg.ts`.
 *
 * Deliberately a pure string builder with no DOM and no React, so the geometry
 * is checkable (`lib/__checks__/forestSvg.check.mts`) rather than only viewable.
 * Two rules it must never break:
 *
 *  1. Every number it draws comes from `MetaResult` — it recomputes nothing. A
 *     figure that disagreed with the screen would be worse than no figure.
 *  2. Every string is XML-escaped. Study labels are paper filenames, and one
 *     ampersand in "Smith & Jones 2019" would otherwise produce an SVG that no
 *     renderer will open.
 */

import {
  buildAxis, describeAbsolute, EFFECT_LABEL, formatMeasured, formatMeasuredTick, formatP, formatTick, hasNullValue,
  isRatioMeasure, measureColumnLabel, MODEL_SHORT, studyDataCells, type MetaResult,
} from '@/lib/metaAnalysis';

// ── Geometry ─────────────────────────────────────────────────────────────────

const W = 920;
const PAD_X = 16;
const ROW_H = 22;
const POOLED_H = 28;

const COL_LABEL_X = PAD_X;
// Right edges of the two data columns. Kept 110px apart because the widest
// headings this figure carries ("Comparator n/N") are ~90px at 10px, and a
// heading that collides with its neighbour is the one defect a reader cannot
// work around.
const COL_D1_R = 254;
const COL_D2_R = 364;
const PLOT_X = 392;
const PLOT_W = 252;
const PLOT_R = PLOT_X + PLOT_W;
const COL_EFFECT_X = PLOT_R + 22;
const COL_WEIGHT_R = W - PAD_X;

const INK = '#111111';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const GRID = '#e5e7eb';
/**
 * The trivial zone. A pre-mixed light green rather than a dark green at low
 * opacity: `opacity` on a `<rect>` is honoured inconsistently outside browsers
 * (ImageMagick renders it near-solid), and a figure that reads as a green stripe
 * in one renderer and a wash in another is not a figure you can put in a paper.
 * The edge rules keep the saturated tone, where a thin line needs it.
 */
const BAND_FILL = '#e3f1e9';
const BAND_EDGE = '#23875b';

const FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const MAX_LABEL_CHARS = 30;

// ── Primitives ───────────────────────────────────────────────────────────────

/** XML-escape. Everything user- or paper-derived goes through this. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, max = MAX_LABEL_CHARS): string {
  const t = String(s ?? '');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function text(
  x: number,
  y: number,
  s: string,
  opts: {
    size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number;
    /** Character cap. The default suits a table cell; a footer sentence needs the width. */
    max?: number;
  } = {},
): string {
  const { size = 11.5, fill = INK, anchor = 'start', weight = 400, max = 120 } = opts;
  return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${fill}"`
    + `${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}`
    + `${weight === 400 ? '' : ` font-weight="${weight}"`}>${esc(truncate(s, max))}</text>`;
}

/**
 * A footer sentence spans the figure. 888px of usable width at 10.5px system-ui
 * averages about 5.4px per character, so 160 is the honest cap — measured by
 * rendering, not guessed, after a 155-character line came back clipped at 152.
 */
const STAT_MAX_CHARS = 160;

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1, dash?: string): string {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" `
    + `stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── The figure ───────────────────────────────────────────────────────────────

export interface ForestSvgOptions {
  outcomeLabel: string;
  comparisonLabel: string;
  treatmentHeading: string;
  comparatorHeading: string;
  /** Shown bottom-left, so a figure pasted into a manuscript says where it came from. */
  footer?: string;
  /** Minimal important difference on the display scale; shades the trivial zone. */
  mid?: number | null;
}

export interface ForestSvg {
  svg: string;
  width: number;
  height: number;
}

export function buildForestSvg(result: MetaResult, opts: ForestSvgOptions): ForestSvg {
  const axis = buildAxis(result);
  const toPx = (v: number) => PLOT_X + (axis.toX(v) / 100) * PLOT_W;
  /** `axis.toX` clamps to 1/99, so a bound pinned there ran off the axis. */
  const clampedLow = (v: number) => axis.toX(v) <= 1.0001;
  const clampedHigh = (v: number) => axis.toX(v) >= 98.9999;
  const nullPx = PLOT_X + (axis.nullX / 100) * PLOT_W;

  const maxWeight = Math.max(...result.studies.map(s => s.weightPct), 1);

  const stats: string[] = [];
  if (result.heterogeneity) {
    const h = result.heterogeneity;
    stats.push(
      `Heterogeneity: tau² = ${h.tau2.toFixed(3)}; Q = ${h.q.toFixed(1)}, df = ${h.df} `
      + `(p = ${formatP(h.p)}); I² = ${h.i2.toFixed(0)}%`,
    );
  }
  if (result.glmm) {
    stats.push(
      `One-stage logit GLMM: tau² = ${result.glmm.tau2.toFixed(3)} (logit scale). No Cochran's Q or I², `
      + `no correction applied; each row is a Wilson interval on its own counts`,
    );
    if (result.glmm.seFallback) {
      stats.push(
        `The model's standard error came from a conservative fallback rather than the likelihood `
        + `curvature — read the pooled interval as approximate`,
      );
    }
  }
  if (result.prediction) {
    stats.push(
      `95% prediction interval ${formatMeasuredTick(result.measure, result.prediction.lo)} to `
      + `${formatMeasuredTick(result.measure, result.prediction.hi)} (t on ${result.prediction.df} df)`,
    );
  }
  if (result.hksj) {
    stats.push(
      `HKSJ 95% CI ${result.hksj.lo.toFixed(2)} to ${result.hksj.hi.toFixed(2)} `
      + `(t on ${result.hksj.df} df, q = ${result.hksj.q.toFixed(2)})`,
    );
  }
  if (result.absolute) {
    const a = result.absolute;
    const d = describeAbsolute(a);
    stats.push(
      `Absolute effect at ${(a.comparatorRisk * 100).toFixed(1)}% comparator risk `
      + `(${a.riskSource === 'corpus' ? 'this corpus' : 'supplied'}): ${d.headline} `
      + `(95% CI ${d.interval})${d.nnt ? `. ${d.nnt}` : ''}`,
    );
  }
  if (result.overallEffect) {
    stats.push(
      `Test for overall effect: Z = ${result.overallEffect.z.toFixed(2)} `
      + `(p = ${formatP(result.overallEffect.p)})`,
    );
  }
  if (result.poolingMethodRefusal) {
    stats.push(`No pooled estimate: ${result.poolingMethodRefusal}`);
  }
  if (result.correctedCount > 0) {
    stats.push(
      `* ${result.correctedCount} ${result.correctedCount === 1 ? 'study' : 'studies'} had a zero cell; `
      + `0.5 was added to each of its cells`
      + (result.model === 'mh' || result.model === 'peto'
        ? ` for its own row — the pooled estimate uses the raw counts`
        : ` before pooling`),
    );
  }
  if (result.notEstimable.length > 0) {
    stats.push(
      `${result.notEstimable.length} matched ${result.notEstimable.length === 1 ? 'study' : 'studies'} `
      + `could not be estimated and ${result.notEstimable.length === 1 ? 'is' : 'are'} not plotted`,
    );
  }

  if (opts.mid && opts.mid > 0) {
    const b = isRatioMeasure(result.measure)
      ? { lo: 1 / opts.mid, hi: opts.mid }
      : { lo: -Math.abs(opts.mid), hi: Math.abs(opts.mid) };
    stats.push(
      `Shaded: within the minimal important difference (${formatTick(b.lo)} to ${formatTick(b.hi)}) — `
      + `distinguishable from no effect there, but not clinically important`,
    );
  }

  // Vertical plan.
  const titleY = 26;
  const subtitleY = titleY + 17;
  const headY = subtitleY + 26;
  const rulesY = headY + 7;
  const firstRowY = rulesY + 18;
  const rowsEnd = firstRowY + result.studies.length * ROW_H;
  const pooledY = result.pooled ? rowsEnd + POOLED_H / 2 + 2 : rowsEnd;
  const piY = pooledY + 13;
  const axisY = (result.prediction ? piY : pooledY) + 20;
  const favoursY = axisY + 26;
  const statsY = favoursY + 20;
  const H = Math.round(statsY + stats.length * 15 + (opts.footer ? 20 : 6));

  const out: string[] = [];

  // Header.
  out.push(text(COL_LABEL_X, titleY, opts.outcomeLabel, { size: 15, weight: 700 }));
  out.push(text(
    COL_LABEL_X, subtitleY,
    `${opts.comparisonLabel} · ${EFFECT_LABEL[result.measure]}, ${MODEL_SHORT[result.model]}`,
    { size: 11.5, fill: MUTED },
  ));

  // Column headings.
  out.push(text(COL_LABEL_X, headY, 'Study', { size: 10, fill: MUTED, weight: 600 }));
  out.push(text(COL_D1_R, headY, opts.treatmentHeading, { size: 10, fill: MUTED, weight: 600, anchor: 'end' }));
  out.push(text(COL_D2_R, headY, opts.comparatorHeading, { size: 10, fill: MUTED, weight: 600, anchor: 'end' }));
  out.push(text(
    COL_EFFECT_X, headY, `${measureColumnLabel(result.measure)} (95% CI)`,
    { size: 10, fill: MUTED, weight: 600 },
  ));
  out.push(text(COL_WEIGHT_R, headY, 'Weight', { size: 10, fill: MUTED, weight: 600, anchor: 'end' }));
  out.push(line(PAD_X, rulesY, W - PAD_X, rulesY, RULE, 1));

  // The trivial zone, painted before anything else so the marks stay readable on
  // top of it. Multiplicative for a ratio measure: 1.25 bounds 1/1.25 to 1.25.
  const bandBounds = opts.mid && opts.mid > 0
    ? (isRatioMeasure(result.measure)
        ? { lo: 1 / opts.mid, hi: opts.mid }
        : { lo: -Math.abs(opts.mid), hi: Math.abs(opts.mid) })
    : null;
  if (bandBounds) {
    const bLo = toPx(bandBounds.lo);
    const bHi = toPx(bandBounds.hi);
    if (bHi > bLo) {
      out.push(
        `<rect x="${round(bLo)}" y="${round(rulesY + 4)}" width="${round(bHi - bLo)}" `
        + `height="${round(axisY - rulesY - 4)}" fill="${BAND_FILL}"/>`,
      );
      // Edge lines only when the band is wide enough for them to read as edges;
      // on a full-ladder log axis the zone can be a few pixels wide, where two
      // dashed rules print as one dark stripe and hide the fill they bound.
      if (bHi - bLo >= 14) {
        out.push(line(bLo, rulesY + 4, bLo, axisY, BAND_EDGE, 0.8, '2 2'));
        out.push(line(bHi, rulesY + 4, bHi, axisY, BAND_EDGE, 0.8, '2 2'));
      }
    }
  }

  // The no-effect line runs the height of the data, behind everything else — but
  // only where the measure has a null. A line at 0% on a prevalence axis would
  // assert a hypothesis the analysis never made.
  const showNull = hasNullValue(result.measure);
  if (showNull) out.push(line(nullPx, rulesY + 4, nullPx, axisY, GRID, 1.5));

  // Studies.
  result.studies.forEach((s, i) => {
    const y = firstRowY + i * ROW_H;
    const cy = y - 4;
    const cells = studyDataCells(s);
    const side = Math.max(5, Math.round(11 * Math.sqrt(s.weightPct / maxWeight)));

    out.push(text(COL_LABEL_X, y, `${truncate(s.label)}${s.corrected ? ' *' : ''}`));
    out.push(text(COL_D1_R, y, cells.left, { anchor: 'end' }));
    out.push(text(COL_D2_R, y, cells.right, { anchor: 'end' }));

    const loX = toPx(s.lo);
    const hiX = toPx(s.hi);
    out.push(line(loX, cy, hiX, cy, INK, 1.1));
    // A bound pinned at the axis edge gets an arrow rather than a cap, so a
    // clamped interval never reads as one that happened to stop there.
    if (clampedLow(s.lo)) out.push(`<path d="M${round(loX)} ${round(cy)} l5 -3.2 v6.4 z" fill="${INK}"/>`);
    else out.push(line(loX, cy - 3.2, loX, cy + 3.2, INK, 1.1));
    if (clampedHigh(s.hi)) out.push(`<path d="M${round(hiX)} ${round(cy)} l-5 -3.2 v6.4 z" fill="${INK}"/>`);
    else out.push(line(hiX, cy - 3.2, hiX, cy + 3.2, INK, 1.1));

    const estX = toPx(s.est);
    out.push(
      `<rect x="${round(estX - side / 2)}" y="${round(cy - side / 2)}" width="${side}" height="${side}" `
      + `fill="${INK}"/>`,
    );

    out.push(text(COL_EFFECT_X, y, formatMeasured(result.measure, s.est, s.lo, s.hi)));
    out.push(text(COL_WEIGHT_R, y, `${s.weightPct.toFixed(1)}%`, { anchor: 'end', fill: MUTED }));
  });

  // Pooled row.
  if (result.pooled) {
    const p = result.pooled;
    out.push(line(PAD_X, rowsEnd + 4, W - PAD_X, rowsEnd + 4, RULE, 1));
    const y = pooledY + 8;
    out.push(text(COL_LABEL_X, y, 'Total (95% CI)', { weight: 700 }));
    out.push(text(COL_D1_R, y, result.totals.treatment, { anchor: 'end', weight: 700 }));
    out.push(text(COL_D2_R, y, result.totals.comparator, { anchor: 'end', weight: 700 }));

    const loX = toPx(p.lo);
    const hiX = toPx(p.hi);
    const estX = toPx(p.est);
    const dy = 6.5;
    out.push(
      `<polygon points="${round(loX)},${round(pooledY)} ${round(estX)},${round(pooledY - dy)} `
      + `${round(hiX)},${round(pooledY)} ${round(estX)},${round(pooledY + dy)}" fill="${INK}"/>`,
    );

    if (result.hksj) {
      // Same centre, a different interval — drawn as brackets on the diamond's
      // own line so the comparison is immediate rather than a footnote.
      const hLo = toPx(result.hksj.lo);
      const hHi = toPx(result.hksj.hi);
      out.push(line(hLo, pooledY, hHi, pooledY, MUTED, 1));
      out.push(line(hLo, pooledY - 4, hLo, pooledY + 4, MUTED, 1));
      out.push(line(hHi, pooledY - 4, hHi, pooledY + 4, MUTED, 1));
    }

    if (result.prediction) {
      const pLo = toPx(result.prediction.lo);
      const pHi = toPx(result.prediction.hi);
      out.push(line(pLo, piY, pHi, piY, MUTED, 1, '3 2'));
      out.push(line(pLo, piY - 3, pLo, piY + 3, MUTED, 1));
      out.push(line(pHi, piY - 3, pHi, piY + 3, MUTED, 1));
      // Labelled at its own right end rather than in the margin, where it used to
      // sit on top of the comparator total.
      out.push(text(Math.min(pHi + 6, PLOT_R + 4), piY + 3.5, '95% PI', { size: 9, fill: MUTED }));
    }

    out.push(text(COL_EFFECT_X, y, formatMeasured(result.measure, p.est, p.lo, p.hi), { weight: 700 }));
    out.push(text(COL_WEIGHT_R, y, '100.0%', { anchor: 'end', weight: 700 }));
  }

  // Axis.
  out.push(line(PLOT_X, axisY, PLOT_R, axisY, INK, 1));
  // A log axis reaching the ladder's ends packs 0.01, 0.02 and 0.05 into a few
  // pixels, and overprinted numbers are worse than fewer numbers — so every tick
  // keeps its mark, and a label is dropped when it would collide with the last
  // one drawn. The end ticks always keep theirs: they are the axis's range.
  let lastLabelX = -Infinity;
  axis.ticks.forEach((t, i) => {
    const x = toPx(t);
    out.push(line(x, axisY, x, axisY + 4, INK, 1));
    const label = formatMeasuredTick(result.measure, t);
    const halfWidth = label.length * 2.6;
    const mustLabel = i === 0 || i === axis.ticks.length - 1
      || (showNull && (t === 1 || t === 0));
    if (mustLabel || x - lastLabelX >= halfWidth + 10) {
      out.push(text(x, axisY + 14, label, { size: 9.5, fill: MUTED, anchor: 'middle' }));
      lastLabelX = x;
    }
  });

  // Direction labels, worded exactly as the screen words them — and omitted
  // entirely when there is no comparison to have a direction.
  if (showNull) {
    const favoursLeft = opts.comparatorHeading.replace(/\s*n\/N$/i, '') || 'comparator';
    const favoursRight = opts.treatmentHeading.replace(/\s*n\/N$/i, '') || 'treatment';
    out.push(text(nullPx - 6, favoursY, `← Favours ${favoursLeft}`, { size: 9.5, fill: MUTED, anchor: 'end' }));
    out.push(text(nullPx + 6, favoursY, `Favours ${favoursRight} →`, { size: 9.5, fill: MUTED }));
  } else {
    out.push(text(
      PLOT_X, favoursY,
      `${EFFECT_LABEL[result.measure]} observed in each study — no comparison, so no direction to favour`,
      { size: 9.5, fill: MUTED },
    ));
  }

  // Statistics.
  stats.forEach((s, i) => out.push(
    text(COL_LABEL_X, statsY + i * 15, s, { size: 10.5, fill: MUTED, max: STAT_MAX_CHARS }),
  ));
  if (opts.footer) {
    out.push(text(COL_LABEL_X, statsY + stats.length * 15 + 5, opts.footer, { size: 9, fill: MUTED }));
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
    + `font-family="${FONT}">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`
    + out.join('')
    + `</svg>`;

  return { svg, width: W, height: H };
}
