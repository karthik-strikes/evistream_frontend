/**
 * The two Review summary figures — a robvis-style traffic-light plot and the
 * summary bar chart — each as ONE self-contained SVG string.
 *
 * The screen renders the very same string it downloads, so the figure a
 * reviewer checks on screen is the figure that lands in the manuscript. Same
 * rules as `synthesis/_lib/forestSvg.ts`:
 *
 *  1. It recomputes nothing: judgements come from `ReportRow`, counts from
 *     `distribution()`.
 *  2. Every string is XML-escaped — one "Smith & Jones" in a study label would
 *     otherwise produce a file no renderer opens.
 *  3. System fonts only and no external references, so rasterizing to PNG never
 *     taints the canvas or swaps the font.
 *
 * Colour is never the only cue: each marker carries a symbol (Low "+", Some
 * concerns "−", High "×"), so a greyscale print still reads. Some
 * concerns is slate, per the Risk of Bias palette in CLAUDE.md.
 */

import { DOMAIN_SHORT, DOMAIN_TITLE, JUDGEMENT_LABEL, type Judgement } from './robModel';
import type { Distribution, ReportRow } from './robReport';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = '#111111';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const NONE_RING = '#d4d4d8';
const NONE_FILL = '#e5e7eb';

export const JUDGEMENT_COLOR: Record<Judgement, string> = {
  low: '#16a34a', some: '#64748b', high: '#dc2626',
};

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Cut to `max` characters with an ellipsis; the full text goes in a <title>. */
function clip(s: string, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * A text element; with `tip`, wrapped in a `<g>` carrying a `<title>`. The
 * title never goes INSIDE the `<text>`: renderers outside browsers
 * (ImageMagick, some editors) then drop the whole label.
 */
function text(x: number, y: number, body: string, attrs = '', tip = ''): string {
  const el = `<text x="${x}" y="${y}" ${attrs}>${esc(body)}</text>`;
  return tip ? `<g><title>${esc(tip)}</title>${el}</g>` : el;
}

/** One judgement marker centred at (cx, cy): filled circle + white symbol, or a hollow ring. */
export function marker(cx: number, cy: number, j: Judgement | null, r = 9, title = ''): string {
  const tip = title ? `<title>${esc(title)}</title>` : '';
  if (!j) {
    return `<g>${tip}<circle cx="${cx}" cy="${cy}" r="${r - 0.75}" fill="#ffffff" stroke="${NONE_RING}" stroke-width="1.5"/></g>`;
  }
  const a = r * 0.45;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`;
  const glyph = j === 'low'
    ? line(cx - a, cy, cx + a, cy) + line(cx, cy - a, cx, cy + a)
    : j === 'some'
      ? line(cx - a, cy, cx + a, cy)
      : line(cx - a * 0.8, cy - a * 0.8, cx + a * 0.8, cy + a * 0.8) + line(cx - a * 0.8, cy + a * 0.8, cx + a * 0.8, cy - a * 0.8);
  return `<g>${tip}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${JUDGEMENT_COLOR[j]}"/>${glyph}</g>`;
}

export interface Figure {
  svg: string;
  width: number;
  height: number;
}

function wrap(width: number, height: number, body: string, label: string): Figure {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" `
    + `font-family="${esc(FONT)}" role="img" aria-label="${esc(label)}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`;
  return { svg, width, height };
}

const LEGEND_KEYS: Array<[Judgement | null, string]> = [
  ['low', 'Low risk of bias'], ['some', 'Some concerns'], ['high', 'High risk of bias'], [null, 'Not yet judged'],
];

// ── Traffic light ────────────────────────────────────────────────────────────

const PAD = 16;
const HEAD_H = 34;
const ROW_H = 24;
const STUDY_W = 150;
const COL_W = 34;
const OVERALL_GAP = 10;

/**
 * One row per study × target, columns D1–D5 + Overall. The study label is
 * printed on the first row of each study; a rule separates studies.
 */
export function trafficLightSvg(rows: ReportRow[], opts: { targetHeading: string; footer: string }): Figure {
  const targetW = rows.some(r => r.kind === 'result') ? 340 : 240;
  const targetChars = Math.floor(targetW / 6.1);
  const colX = (i: number) => PAD + STUDY_W + targetW + COL_W / 2 + i * COL_W + (i === 5 ? OVERALL_GAP : 0);
  const width = Math.round(colX(5) + COL_W / 2 + PAD);
  const parts: string[] = [];

  // Header
  const hy = PAD + 18;
  parts.push(text(PAD, hy, 'Study', `font-size="11" font-weight="600" fill="${INK}"`));
  parts.push(text(PAD + STUDY_W, hy, opts.targetHeading, `font-size="11" font-weight="600" fill="${INK}"`));
  for (let i = 0; i < 6; i++) {
    parts.push(text(colX(i), hy, i === 5 ? 'Overall' : `D${i + 1}`,
      `text-anchor="middle" font-size="11" font-weight="${i === 5 ? 700 : 600}" fill="${INK}"`,
      i === 5 ? 'Overall risk of bias' : DOMAIN_TITLE[i]));
  }
  parts.push(`<line x1="${PAD}" y1="${PAD + HEAD_H - 4}" x2="${width - PAD}" y2="${PAD + HEAD_H - 4}" stroke="${INK}" stroke-width="1"/>`);

  // Rows
  let y = PAD + HEAD_H;
  rows.forEach((r, idx) => {
    const first = idx === 0 || rows[idx - 1].documentId !== r.documentId;
    if (first && idx > 0) {
      parts.push(`<line x1="${PAD}" y1="${y}" x2="${width - PAD}" y2="${y}" stroke="${RULE}" stroke-width="1"/>`);
    }
    const cy = y + ROW_H / 2;
    if (first) {
      parts.push(text(PAD, cy + 4, clip(r.studyLabel, 24), `font-size="11" font-weight="600" fill="${INK}"`,
        r.citation || r.studyLabel));
    }
    parts.push(text(PAD + STUDY_W, cy + 4, clip(r.title, targetChars), 'font-size="11" fill="#374151"', r.title));
    for (let i = 0; i < 6; i++) {
      const j = i === 5 ? r.overall : r.domains[i];
      const name = i === 5 ? 'Overall' : `D${i + 1}`;
      parts.push(marker(colX(i), cy, j, 9, `${r.studyLabel} · ${name} · ${j ? JUDGEMENT_LABEL[j] : r.status || 'Not yet judged'}`));
    }
    y += ROW_H;
  });
  parts.push(`<line x1="${PAD}" y1="${y + 2}" x2="${width - PAD}" y2="${y + 2}" stroke="${INK}" stroke-width="1"/>`);

  // Legend: domain names, then the judgement key.
  y += 22;
  parts.push(text(PAD, y, 'Domains', `font-size="10.5" font-weight="600" fill="${INK}"`));
  for (let i = 0; i < 5; i++) {
    y += 15;
    parts.push(text(PAD, y, `D${i + 1}`, `font-size="10.5" font-weight="600" fill="${INK}"`));
    parts.push(text(PAD + 26, y, DOMAIN_TITLE[i], `font-size="10.5" fill="#374151"`));
  }
  y += 22;
  let kx = PAD;
  for (const [j, label] of LEGEND_KEYS) {
    parts.push(marker(kx + 7, y - 4, j, 7));
    parts.push(text(kx + 20, y, label, `font-size="10.5" fill="#374151"`));
    kx += 20 + label.length * 5.5 + 20;
  }
  y += 22;
  parts.push(text(PAD, y, opts.footer, `font-size="9.5" fill="${MUTED}"`));
  return wrap(width, Math.round(y + PAD), parts.join(''), 'Risk of bias traffic-light plot');
}

// ── Summary bars ─────────────────────────────────────────────────────────────

const BAR_LABEL_W = 230;
const BAR_W = 420;
const BAR_ROW_H = 30;
const BAR_H = 18;

/** One horizontal 100% stacked bar per domain + Overall. */
export function summaryBarsSvg(dist: Distribution[], opts: { footer: string }): Figure {
  const barX = PAD + BAR_LABEL_W;
  const width = barX + BAR_W + 70 + PAD;
  const parts: string[] = [];
  let y = PAD + 6;

  // Gridlines are drawn once the rows are placed, and unshifted beneath them.
  const top = y;
  dist.forEach(d => {
    if (d.domain === 5) y += 8;
    const cy = y + BAR_ROW_H / 2;
    const label = d.domain === 5 ? 'Overall risk of bias' : `D${d.domain + 1}  ${DOMAIN_SHORT[d.domain]}`;
    parts.push(text(PAD, cy + 4, label, `font-size="11" font-weight="${d.domain === 5 ? 700 : 500}" fill="${INK}"`,
      d.domain === 5 ? 'Overall risk of bias' : DOMAIN_TITLE[d.domain]));
    let x = barX;
    const segs: Array<[Judgement | null, number]> = [['low', d.low], ['some', d.some], ['high', d.high], [null, d.none]];
    for (const [j, count] of segs) {
      if (!d.n || !count) continue;
      const w = (count / d.n) * BAR_W;
      const pct = Math.round((count / d.n) * 100);
      const name = j ? JUDGEMENT_LABEL[j] : 'Not yet judged';
      parts.push(`<rect x="${x.toFixed(2)}" y="${cy - BAR_H / 2}" width="${w.toFixed(2)}" height="${BAR_H}" `
        + `fill="${j ? JUDGEMENT_COLOR[j] : NONE_FILL}"><title>${esc(`${name}: ${count} of ${d.n} (${pct}%)`)}</title></rect>`);
      if (w >= 30) {
        parts.push(`<text x="${(x + w / 2).toFixed(2)}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="600" `
          + `fill="${j ? '#ffffff' : '#4b5563'}">${pct}%</text>`);
      }
      x += w;
    }
    if (!d.n) {
      parts.push(`<rect x="${barX}" y="${cy - BAR_H / 2}" width="${BAR_W}" height="${BAR_H}" fill="#ffffff" stroke="${NONE_RING}" stroke-dasharray="3 3"/>`);
    }
    parts.push(text(barX + BAR_W + 12, cy + 4, `n = ${d.n}`, `font-size="10.5" fill="${MUTED}"`));
    y += BAR_ROW_H;
  });

  // Axis
  const axisY = y + 4;
  for (const t of [0, 25, 50, 75, 100]) {
    const x = barX + (t / 100) * BAR_W;
    parts.unshift(`<line x1="${x}" y1="${top}" x2="${x}" y2="${axisY}" stroke="${RULE}" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${axisY + 13}" text-anchor="middle" font-size="10" fill="${MUTED}">${t}%</text>`);
  }
  y = axisY + 36;

  let kx = PAD;
  for (const [j, label] of LEGEND_KEYS) {
    parts.push(`<rect x="${kx}" y="${y - 9}" width="11" height="11" rx="2" fill="${j ? JUDGEMENT_COLOR[j] : NONE_FILL}"/>`);
    parts.push(text(kx + 17, y, label, `font-size="10.5" fill="#374151"`));
    kx += 17 + label.length * 5.5 + 20;
  }
  y += 22;
  parts.push(text(PAD, y, opts.footer, `font-size="9.5" fill="${MUTED}"`));
  return wrap(width, Math.round(y + PAD), parts.join(''), 'Risk of bias summary bar chart');
}
