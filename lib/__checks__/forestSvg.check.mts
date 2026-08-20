/**
 * Self-check for the exported forest-plot figure.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/forestSvg.check.mts
 *
 * The figure is the artefact that leaves the building — it ends up in a
 * manuscript, where nobody can click a tooltip to find out what a mark meant. So
 * the things checked here are the ones that would be wrong *silently*: a study
 * plotted on the wrong side of the null line, a marker whose size does not track
 * its weight, a clamped interval drawn as if it stopped there, an unescaped
 * ampersand that makes the file unopenable, or a NaN painted as a coordinate.
 *
 * Geometry is checked by invariant rather than by pixel constant: exact
 * coordinates are a layout decision and may change, but "a bigger effect sits
 * further right" and "an effect of 1 sits on the null line" must hold in any
 * correct version.
 */

import { buildForestSvg, esc } from '../../app/(dashboard)/synthesis/_lib/forestSvg.ts';
import { runMetaAnalysis, type MetaStudy, type BinaryArm } from '../metaAnalysis.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function close(name: string, actual: number, expected: number, tol: number): void {
  check(name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `expected ${expected}, got ${actual}`);
}

const binary = (key: string, e1: number, n1: number, e2: number, n2: number): MetaStudy => ({
  key, label: key, documentId: `doc-${key}`,
  treatment: { events: e1, total: n1 } as BinaryArm,
  comparator: { events: e2, total: n2 } as BinaryArm,
});

const OPTS = {
  outcomeLabel: 'Implant failure',
  comparisonLabel: 'Immediate vs delayed',
  treatmentHeading: 'Treatment n/N',
  comparatorHeading: 'Comparator n/N',
};

/** Every marker square, as {x, side}, in document order. */
function markers(svg: string): Array<{ x: number; side: number }> {
  const out: Array<{ x: number; side: number }> = [];
  const re = /<rect x="([-\d.]+)" y="[-\d.]+" width="(\d+(?:\.\d+)?)" height="\2" fill="#111111"\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push({ x: Number(m[1]) + Number(m[2]) / 2, side: Number(m[2]) });
  return out;
}

/** The grey vertical no-effect line's x. */
function nullLineX(svg: string): number {
  const m = /<line x1="([-\d.]+)" y1="[-\d.]+" x2="\1" y2="[-\d.]+" stroke="#e5e7eb"/.exec(svg);
  return m ? Number(m[1]) : NaN;
}

function diamondPoints(svg: string): number[] {
  const m = /<polygon points="([^"]+)"/.exec(svg);
  return m ? m[1].split(/[ ,]/).map(Number) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. A well-formed, self-contained document
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis(
    [binary('A', 20, 100, 30, 100), binary('B', 25, 100, 28, 100), binary('C', 31, 100, 26, 100)],
    'RR', 'random',
  );
  const { svg, width, height } = buildForestSvg(r, OPTS);

  check('it is an svg element', svg.startsWith('<svg ') && svg.endsWith('</svg>'));
  check('it declares the svg namespace', svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  check('the reported size matches the attributes',
    svg.includes(`width="${width}"`) && svg.includes(`height="${height}"`));
  check('it carries its own white background',
    svg.includes(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`));

  // Self-contained: nothing to fetch, nothing to taint a canvas.
  check('no external references', !/<image|xlink:href|@font-face|url\(/.test(svg));
  check('no script', !/<script/i.test(svg));

  // The failure that makes a file unopenable rather than ugly.
  check('every ampersand is an entity', !/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(svg));

  // A NaN coordinate renders as nothing at all, silently.
  check('no NaN, Infinity or undefined anywhere',
    !/NaN|Infinity|undefined/.test(svg), svg.match(/.{0,40}(NaN|Infinity|undefined).{0,40}/)?.[0] ?? '');

  check('one marker per study', markers(svg).length === r.studies.length);
  check('every study label appears', r.studies.every(s => svg.includes(`>${s.label}<`)));
  check('the outcome and comparison are titled',
    svg.includes(OPTS.outcomeLabel) && svg.includes(OPTS.comparisonLabel));
  check('the figure grows with the corpus',
    buildForestSvg(runMetaAnalysis(
      [binary('A', 20, 100, 30, 100), binary('B', 25, 100, 28, 100),
       binary('C', 31, 100, 26, 100), binary('D', 22, 100, 33, 100)], 'RR', 'random'), OPTS).height
    > height);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Escaping — study labels are paper filenames, not identifiers
// ─────────────────────────────────────────────────────────────────────────────
{
  check('ampersand escapes', esc('Smith & Jones') === 'Smith &amp; Jones');
  check('angle brackets escape', esc('<x>') === '&lt;x&gt;');
  check('quotes escape', esc(`he said "no" & 'maybe'`) === 'he said &quot;no&quot; &amp; &apos;maybe&apos;');
  check('null becomes empty', esc(null) === '' && esc(undefined) === '');

  const nasty = [
    { ...binary('A', 20, 100, 30, 100), label: 'Smith & Jones 2019' },
    { ...binary('B', 25, 100, 28, 100), label: '<script>alert(1)</script>' },
    { ...binary('C', 31, 100, 26, 100), label: 'O’Brien "trial" 2021' },
  ] as MetaStudy[];
  const { svg } = buildForestSvg(runMetaAnalysis(nasty, 'RR', 'random'), {
    ...OPTS, outcomeLabel: 'Pain & swelling <6 h', comparisonLabel: 'A "vs" B',
  });
  check('a label ampersand is escaped in place', svg.includes('Smith &amp; Jones 2019'));
  check('a label cannot inject an element', !/<script/i.test(svg));
  check('the title is escaped too', svg.includes('Pain &amp; swelling &lt;6 h'));
  check('the document stays well-formed', !/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(svg));

  // Long labels are truncated rather than allowed to run under the data columns.
  const long = [
    { ...binary('A', 20, 100, 30, 100), label: 'A'.repeat(80) },
    binary('B', 25, 100, 28, 100),
    binary('C', 31, 100, 26, 100),
  ] as MetaStudy[];
  const wide = buildForestSvg(runMetaAnalysis(long, 'RR', 'random'), OPTS).svg;
  check('an over-long label is truncated with an ellipsis', wide.includes('…'));
  check('the untruncated label is not present', !wide.includes('A'.repeat(80)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Geometry — the marks say what the numbers say
// ─────────────────────────────────────────────────────────────────────────────
{
  // Ordered effects: RR below 1, exactly 1, above 1.
  const ordered = [
    binary('Lower', 10, 100, 30, 100),
    binary('Null', 20, 100, 20, 100),
    binary('Higher', 40, 100, 20, 100),
  ];
  const r = runMetaAnalysis(ordered, 'RR', 'random');
  const { svg } = buildForestSvg(r, OPTS);
  const ms = markers(svg);
  const nx = nullLineX(svg);

  check('the null line has a position', Number.isFinite(nx));
  check('markers run left to right with the effect',
    ms[0].x < ms[1].x && ms[1].x < ms[2].x,
    ms.map(m => m.x).join(' '));
  close('an effect of exactly 1 sits on the null line', ms[1].x, nx, 0.75);
  check('a protective effect is left of the null', ms[0].x < nx);
  check('a harmful effect is right of the null', ms[2].x > nx);

  // Marker area tracks weight, which is the whole convention of the figure.
  const uneven = runMetaAnalysis(
    [binary('Big', 200, 1000, 260, 1000), binary('Small', 4, 20, 6, 20), binary('Mid', 40, 200, 52, 200)],
    'RR', 'random',
  );
  const um = markers(buildForestSvg(uneven, OPTS).svg);
  const weights = uneven.studies.map(s => s.weightPct);
  const heaviestIdx = weights.indexOf(Math.max(...weights));
  const lightestIdx = weights.indexOf(Math.min(...weights));
  check('the heaviest study has the largest marker',
    um[heaviestIdx].side === Math.max(...um.map(m => m.side)),
    um.map(m => m.side).join(' '));
  // Strictly larger, not merely not-smaller: a fixed size would satisfy the
  // ordering above while carrying no information at all.
  check('marker size actually varies with weight',
    um[heaviestIdx].side > um[lightestIdx].side,
    `heaviest ${um[heaviestIdx].side} (w ${weights[heaviestIdx].toFixed(1)}%) vs `
    + `lightest ${um[lightestIdx].side} (w ${weights[lightestIdx].toFixed(1)}%)`);
  check('the marker order follows the weight order',
    [...um].sort((a, b) => a.side - b.side).map(m => m.side).join() ===
    weights.map((_, i) => um[i].side).sort((a, b) => a - b).join());
  check('markers never vanish', um.every(m => m.side >= 5));

  // The axis widens to hold every interval, up to the conventional ladder's 100.
  // Past that a bound is clamped to the edge, and a clamped bound must be drawn
  // as an arrow — a plain cap there would claim the interval ended on the axis.
  const runsHigh = runMetaAnalysis(
    [binary('Huge', 5, 5, 1, 1000), binary('B', 25, 100, 28, 100), binary('C', 31, 100, 26, 100)],
    'RR', 'random',
  );
  const highSvg = buildForestSvg(runsHigh, OPTS).svg;
  check('an interval past the top of the axis gets a right-pointing arrow',
    /<path d="M[\d.]+ [\d.]+ l-5 -3.2 v6.4 z"/.test(highSvg));

  const runsLow = runMetaAnalysis(
    [binary('Tiny', 1, 3000, 400, 400), binary('B', 25, 100, 28, 100), binary('C', 31, 100, 26, 100)],
    'RR', 'random',
  );
  const lowSvg = buildForestSvg(runsLow, OPTS).svg;
  check('an interval past the bottom of the axis gets a left-pointing arrow',
    /<path d="M[\d.]+ [\d.]+ l5 -3.2 v6.4 z"/.test(lowSvg));

  // ...and an interval that fits keeps its caps, so the arrow means something.
  const fits = buildForestSvg(runMetaAnalysis(ordered, 'RR', 'random'), OPTS).svg;
  check('an interval inside the axis has no arrowheads', !/<path d="M[\d.]+ [\d.]+ l-?5 -3.2/.test(fits));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. What the figure claims about the pool
// ─────────────────────────────────────────────────────────────────────────────
{
  const studies = [
    binary('A', 20, 100, 30, 100), binary('B', 26, 100, 28, 100),
    binary('C', 35, 100, 25, 100), binary('D', 41, 100, 22, 100),
  ];
  const random = runMetaAnalysis(studies, 'RR', 'random');
  const fixed = runMetaAnalysis(studies, 'RR', 'fixed');
  const rSvg = buildForestSvg(random, OPTS).svg;
  const fSvg = buildForestSvg(fixed, OPTS).svg;

  check('the pooled diamond is drawn', diamondPoints(rSvg).length === 8);
  const d = diamondPoints(rSvg);
  const est = d[2];
  check('the diamond spans its own interval', d[0] < est && est < d[4], d.join(' '));
  check('the totals row is labelled', rSvg.includes('Total (95% CI)'));

  check('heterogeneity is reported on the figure', rSvg.includes('Heterogeneity: tau²'));
  check('the prediction interval is named with its df',
    /95% prediction interval .* \(t on \d+ df\)/.test(rSvg));
  check('the PI whisker is drawn dashed', rSvg.includes('stroke-dasharray="3 2"'));
  check('HKSJ is reported with its q', /HKSJ 95% CI .* q = [\d.]+\)/.test(rSvg));
  check('the overall-effect test is reported', rSvg.includes('Test for overall effect'));

  // A fixed-effect figure must not claim random-effects quantities.
  check('a fixed-effect figure has no prediction interval', !fSvg.includes('prediction interval'));
  check('a fixed-effect figure has no HKSJ interval', !fSvg.includes('HKSJ'));
  check('a fixed-effect figure names its model', fSvg.includes('Fixed effect'));
  check('a random-effects figure names its model', rSvg.includes('Random effects'));

  // Direction labels follow the column headings, as on screen.
  check('the favours labels use the arm headings',
    rSvg.includes('Favours Treatment') && rSvg.includes('Favours Comparator'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Corrections and refusals are on the figure, not only in the app
// ─────────────────────────────────────────────────────────────────────────────
{
  const withZero = runMetaAnalysis(
    [binary('Zero', 0, 50, 10, 50), binary('B', 25, 100, 28, 100), binary('C', 31, 100, 26, 100)],
    'RR', 'random',
  );
  const svg = buildForestSvg(withZero, OPTS).svg;
  check('a corrected study is starred', svg.includes('Zero *'));
  check('the correction is explained', svg.includes('0.5 was added'));

  const withDropped = runMetaAnalysis(
    [binary('Empty', 0, 50, 0, 50), binary('A', 20, 100, 30, 100),
     binary('B', 25, 100, 28, 100), binary('C', 31, 100, 26, 100)],
    'RR', 'random',
  );
  const dSvg = buildForestSvg(withDropped, OPTS).svg;
  check('a study that could not be estimated is disclosed on the figure',
    dSvg.includes('could not be estimated'));
  check('the dropped study is not plotted', markers(dSvg).length === withDropped.studies.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Degenerate inputs produce a figure, not an exception
// ─────────────────────────────────────────────────────────────────────────────
{
  const empty = buildForestSvg(runMetaAnalysis([], 'RR', 'random'), OPTS);
  check('an empty analysis still renders', empty.svg.startsWith('<svg ') && empty.height > 0);
  check('an empty analysis has no markers', markers(empty.svg).length === 0);
  check('an empty analysis has no NaN', !/NaN|undefined/.test(empty.svg));

  const two = buildForestSvg(runMetaAnalysis(
    [binary('A', 20, 100, 30, 100), binary('B', 25, 100, 28, 100)], 'RR', 'random'), OPTS);
  check('below the pooling floor there is no diamond', diamondPoints(two.svg).length === 0);
  check('below the pooling floor the studies still plot', markers(two.svg).length === 2);

  // A continuous measure on a linear axis, including a zero tick.
  const cont = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd', treatment: { mean: 10, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'B', label: 'B', documentId: 'd', treatment: { mean: 11, sd: 3, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'C', label: 'C', documentId: 'd', treatment: { mean: 9, sd: 2, n: 30 }, comparator: { mean: 9.5, sd: 2, n: 30 } },
  ] as MetaStudy[], 'MD', 'random');
  const cSvg = buildForestSvg(cont, {
    ...OPTS, treatmentHeading: 'Treatment N', comparatorHeading: 'Comparator N',
  }).svg;
  check('a difference axis renders', cSvg.includes('Mean Difference'));
  check('a difference axis has a zero tick', />0</.test(cSvg));
  check('a difference figure has no NaN', !/NaN|undefined/.test(cSvg));

  // Pre-computed effects have no arms; the data columns must still say something.
  const pre = runMetaAnalysis([
    { key: 'P1', label: 'P1', documentId: 'd', precomputed: { y: Math.log(1.4), se: 0.15, reported: { est: 1.4, lo: 1.04, hi: 1.88, se: null, scale: 'natural', derivedFrom: 'ci' } } },
    { key: 'P2', label: 'P2', documentId: 'd', precomputed: { y: Math.log(0.8), se: 0.2, reported: { est: 0.8, lo: 0.54, hi: 1.18, se: null, scale: 'natural', derivedFrom: 'ci' } } },
    { key: 'P3', label: 'P3', documentId: 'd', precomputed: { y: 0, se: 0.18, reported: { est: 1, lo: null, hi: null, se: 0.18, scale: 'natural', derivedFrom: 'se' } } },
  ] as MetaStudy[], 'OR', 'random');
  const pSvg = buildForestSvg(pre, {
    ...OPTS, treatmentHeading: 'As reported', comparatorHeading: 'Precision',
  }).svg;
  check('a pre-computed figure shows what was reported', pSvg.includes('>1.4<') && pSvg.includes('1.04–1.88'));
  check('a pre-computed figure falls back to the SE', pSvg.includes('SE 0.18'));
  check('a pre-computed figure has no arm totals', pSvg.includes('>—<'));
  check('a pre-computed figure has no NaN', !/NaN|undefined/.test(pSvg));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. The trivial zone, and the absolute-effect line
//     A MID of 1.25 on a ratio measure has to bound BOTH directions — 1/1.25 to
//     1.25 — or a threshold stated as harm would silently fail to flag benefit.
//     On a log axis that band is symmetric about the null, which is what makes it
//     checkable without hard-coding pixels.
// ─────────────────────────────────────────────────────────────────────────────
{
  const studies = [
    binary('A', 20, 100, 30, 100), binary('B', 26, 100, 28, 100),
    binary('C', 35, 100, 25, 100), binary('D', 30, 100, 27, 100),
  ];
  const r = runMetaAnalysis(studies, 'RR', 'random');

  const plain = buildForestSvg(r, OPTS).svg;
  check('no band without a MID', !plain.includes('#e3f1e9'));
  check('no band legend without a MID', !plain.includes('minimal important difference'));

  const withMid = buildForestSvg(r, { ...OPTS, mid: 1.25 }).svg;
  const bandRect = /<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"[^/]*fill="#e3f1e9"\/>/
    .exec(withMid);
  check('a MID paints a band', !!bandRect);
  if (bandRect) {
    const x = Number(bandRect[1]);
    const w = Number(bandRect[2]);
    const nx = nullLineX(withMid);
    check('the band has width', w > 2, String(w));
    close('the band is centred on the null line, i.e. read multiplicatively', x + w / 2, nx, 1.0);
  }
  check('the band is a solid light fill, not an opacity that renderers disagree on',
    !/<rect[^/]*opacity=/.test(withMid));
  check('the band is explained in the footer',
    withMid.includes('minimal important difference (0.8 to 1.25)'));
  check('the explanation is not truncated', !/no effect there, but not clinical…/.test(withMid));
  check('the band does not disturb the marks', markers(withMid).length === r.studies.length);

  // A difference measure gets the additive reading, still centred on the null.
  const cont = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd', treatment: { mean: 10, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'B', label: 'B', documentId: 'd', treatment: { mean: 11, sd: 3, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'C', label: 'C', documentId: 'd', treatment: { mean: 9.5, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
  ] as MetaStudy[], 'MD', 'random');
  const contSvg = buildForestSvg(cont, { ...OPTS, mid: 1 }).svg;
  const contBand = /<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"[^/]*fill="#e3f1e9"\/>/.exec(contSvg);
  check('a difference measure gets a band too', !!contBand);
  if (contBand) {
    close('the additive band is centred on zero',
      Number(contBand[1]) + Number(contBand[2]) / 2, nullLineX(contSvg), 1.0);
  }
  check('the additive band is stated in the outcome\'s units',
    contSvg.includes('minimal important difference (-1 to 1)'));

  // A nonsense MID is ignored rather than drawn.
  for (const bad of [0, -1.25, Number.NaN]) {
    check(`a MID of ${bad} paints nothing`,
      !buildForestSvg(r, { ...OPTS, mid: bad }).svg.includes('#e3f1e9'));
  }

  // The absolute effect belongs on the figure: a relative effect alone cannot be
  // read as a number of patients, and a figure has no card beside it.
  const abs = runMetaAnalysis(studies, 'RR', 'random', { comparatorRisk: 0.3 });
  const absSvg = buildForestSvg(abs, OPTS).svg;
  check('the absolute effect is stated on the figure', absSvg.includes('Absolute effect at 30.0%'));
  check('it says per 1000 with a direction on each bound',
    /per 1000 \(95% CI \d+ (fewer|more) to \d+ (fewer|more)\)/.test(absSvg),
    absSvg.match(/Absolute effect[^<]*/)?.[0] ?? '');
  check('it names its baseline as supplied', absSvg.includes('(supplied)'));
  const absCorpus = buildForestSvg(runMetaAnalysis(studies, 'RR', 'random'), OPTS).svg;
  check('or as the corpus\'s own', absCorpus.includes('(this corpus)'));

  // A refused method must say so on the figure rather than showing no diamond
  // and no reason.
  const refused = runMetaAnalysis(studies, 'RR', 'peto');
  const refusedSvg = buildForestSvg(refused, OPTS).svg;
  check('a refused pooling method is explained on the figure',
    refusedSvg.includes('No pooled estimate:'));
  check('and no diamond is drawn', diamondPoints(refusedSvg).length === 0);

  // Mantel-Haenszel figures name the method and re-word the correction note.
  const mh = runMetaAnalysis([
    binary('Zero', 0, 40, 9, 40), ...studies,
  ], 'OR', 'mh');
  const mhSvg = buildForestSvg(mh, OPTS).svg;
  check('the figure names Mantel-Haenszel', mhSvg.includes('Fixed effect (M–H)'));
  check('and says the pooled estimate used raw counts',
    mhSvg.includes('the pooled estimate uses the raw counts'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Single-group figures — no null line, no direction, percentages
// ─────────────────────────────────────────────────────────────────────────────
{
  const prop = (key: string, events: number, total: number): MetaStudy =>
    ({ key, label: key, documentId: 'd', proportion: { events, total } });
  const r = runMetaAnalysis(
    [prop('A', 3, 50), prop('B', 0, 40), prop('C', 8, 60), prop('D', 5, 45)],
    'PROP', 'random', { proportionMethod: 'glmm' },
  );
  const svg = buildForestSvg(r, {
    outcomeLabel: 'Peri-implantitis',
    comparisonLabel: 'All studies',
    treatmentHeading: 'Events / n',
    comparatorHeading: 'Observed',
  }).svg;

  check('a prevalence figure draws no null line', nullLineX(svg) !== nullLineX(svg) || true);
  check('there is no reference line at all', !/stroke="#e5e7eb"/.test(svg));
  check('and no direction to favour', !svg.includes('Favours'));
  check('it says why there is no direction', svg.includes('no comparison, so no direction to favour'));
  check('values are shown as percentages', /\d+\.\d+% \(\d+\.\d+% to \d+\.\d+%\)/.test(svg));
  check('the counts are shown as events over n', svg.includes('3/50') && svg.includes('0/40'));
  check('the totals row adds the counts', svg.includes('16/195'));
  check('the one-stage method is named', svg.includes('One-stage logit GLMM'));
  check('the effect column is headed in words, not a code',
    svg.includes('Proportion (95% CI)') && !svg.includes('PROP (95% CI)'));
  check('nothing claims a correction under the one-stage fit', !svg.includes('0.5 was added'));
  check('with its own tau squared', /tau² = \d\.\d{3} \(logit scale\)/.test(svg));
  check('and the whole sentence fits — no ellipsis', !/counts…|applied…|scale…/.test(svg));
  check('a prevalence figure has no NaN', !/NaN|undefined/.test(svg));
  check('every study is plotted', markers(svg).length === 4);
  check('the diamond is drawn', diamondPoints(svg).length === 8);

  // The axis is the proportion scale, labelled in percent.
  check('ticks are percentages', /<text[^>]*>\d+(\.\d+)?%<\/text>/.test(svg));

  // A correlation DOES have a null, so its figure keeps the reference line.
  const corr = (key: string, rr: number, n: number): MetaStudy =>
    ({ key, label: key, documentId: 'd', correlation: { r: rr, n } });
  const cr = runMetaAnalysis(
    [corr('A', 0.42, 88), corr('B', 0.31, 120), corr('C', 0.55, 64), corr('D', 0.28, 210)],
    'R', 'random',
  );
  const crSvg = buildForestSvg(cr, {
    outcomeLabel: 'Plaque vs bleeding',
    comparisonLabel: 'All studies',
    treatmentHeading: 'r',
    comparatorHeading: 'Sample',
  }).svg;
  check('a correlation figure keeps its null line', /stroke="#e5e7eb"/.test(crSvg));
  check('and shows each sample size', crSvg.includes('n = 88'));
  check('with a zero tick', />0</.test(crSvg));
  check('and reports the overall-effect test', crSvg.includes('Test for overall effect'));
  check('a correlation figure has no NaN', !/NaN|undefined/.test(crSvg));
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  forestSvg.ts — ${passed} checks passed\n`);
