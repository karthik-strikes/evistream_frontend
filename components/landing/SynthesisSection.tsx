'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { ExampleChip } from './shared';

const LO = Math.log(0.5);
const HI = Math.log(4);
const toX = (v: number) => ((Math.log(v) - LO) / (HI - LO)) * 100;

const RAW = [
  { label: 'Smith 2024', t: '48/62', c: '30/60', est: 1.55, lo: 1.16, hi: 2.06, w: 27.6 },
  { label: 'Johnson 2023', t: '70/95', c: '44/92', est: 1.54, lo: 1.21, hi: 1.97, w: 37.8 },
  { label: 'Patel 2025', t: '55/80', c: '35/78', est: 1.53, lo: 1.15, hi: 2.04, w: 27.6 },
  { label: 'Okafor 2022', t: '15/30', c: '12/31', est: 1.29, lo: 0.73, hi: 2.28, w: 7.0 },
];
const MAX_W = Math.max(...RAW.map((s) => s.w));
const PLOT = RAW.map((s, i) => {
  const loX = toX(s.lo);
  const ciW = toX(s.hi) - loX;
  const estX = toX(s.est);
  return {
    ...s,
    wLabel: `${s.w.toFixed(1)}%`,
    ci: `${s.est.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]`,
    loX,
    ciW,
    estX,
    origin: ((estX - loX) / ciW) * 100,
    size: Math.max(7, Math.round(16 * Math.sqrt(s.w / MAX_W))),
    delay: `${i * 110}ms`,
  };
});
const POOLED = { est: 1.52, lo: 1.31, hi: 1.77 };
const NULL_X = toX(1);
const POOLED_ORIGIN = ((toX(POOLED.est) - toX(POOLED.lo)) / (toX(POOLED.hi) - toX(POOLED.lo))) * 100;
const POOLED_POINTS = `${toX(POOLED.lo).toFixed(1)},7 ${toX(POOLED.est).toFixed(1)},0 ${toX(POOLED.hi).toFixed(1)},7 ${toX(POOLED.est).toFixed(1)},14`;
const TICKS = [0.5, 1, 2, 4].map((v) => ({ x: toX(v), label: String(v) }));

const STUDIES = [
  { label: 'Smith 2024', t: '48/62', c: '30/60', status: 'consensus', tag: 'Eligible', excluded: false },
  { label: 'Johnson 2023', t: '70/95', c: '44/92', status: 'consensus', tag: 'Eligible', excluded: false },
  { label: 'Chen 2023', t: '22/40', c: '18/41', status: 'NaF comparator', tag: 'Excluded', excluded: true },
  { label: 'Patel 2025', t: '55/80', c: '35/78', status: 'consensus', tag: 'Eligible', excluded: false },
  { label: 'Okafor 2022', t: '15/30', c: '12/31', status: 'figure-verified', tag: 'Eligible', excluded: false },
];

const SWIM = [
  { label: 'Smith 2024', effect: 'Median VAS 1 (IQR 0–2) vs 1 (0–2)', dir: 'Median and IQR, no mean or SD', src: 'p. 8, Table 3' },
  { label: 'Johnson 2023', effect: '"No difference in reported pain"', dir: 'Narrative only, no numbers', src: 'p. 11' },
  { label: 'Patel 2025', effect: 'Mean VAS 1.2 vs 1.4, p = 0.41', dir: 'Means without SD or N per arm', src: 'p. 6' },
];

const PLOT_GRID =
  '[grid-template-columns:minmax(84px,124px)_minmax(52px,68px)_minmax(52px,68px)_minmax(120px,1fr)_minmax(104px,128px)_minmax(44px,56px)]';
const SWIM_GRID = '[grid-template-columns:minmax(84px,124px)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(90px,110px)]';
const NULL_LINE: React.CSSProperties = {
  background: 'linear-gradient(rgba(255,255,255,0.22), rgba(255,255,255,0.22)) no-repeat',
  backgroundSize: '1px 100%',
  backgroundPosition: `${NULL_X.toFixed(2)}% 0`,
};
const PANEL = 'rounded-[10px] border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]';

function StepCircle({ children, state }: { children: React.ReactNode; state: 'done' | 'current' | 'todo' }) {
  const cls =
    state === 'done'
      ? 'border border-[rgba(183,198,242,0.5)] text-[#b7c6f2]'
      : state === 'current'
        ? 'bg-white font-bold text-[#0b1533]'
        : 'border border-white/[0.18]';
  return <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${cls}`}>{children}</span>;
}

export function SynthesisSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  const [approach, setApproach] = useState<'ma' | 'swim'>('ma');
  const [paneIn, setPaneIn] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const switchPane = (a: 'ma' | 'swim') => {
    if (a === approach) return;
    if (rm) {
      setApproach(a);
      return;
    }
    setPaneIn(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setApproach(a);
      setPaneIn(true);
    }, 220);
  };

  const plotSx = seen ? 1 : 0;
  const paneStyle: React.CSSProperties = {
    opacity: paneIn ? 1 : 0,
    transform: `translateY(${paneIn ? '0px' : '6px'})`,
    transition: `opacity .4s ${EZ}, transform .4s ${EZ}`,
  };
  const tabCls = (active: boolean) =>
    `-mb-px cursor-pointer leading-[normal] whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-0 pb-[10px] pt-0 text-[13px] font-semibold transition-[color,border-color] duration-[400ms] ${
      active ? 'border-white text-white' : 'border-transparent text-[#8fa3cf]'
    }`;

  return (
    <section
      id="synthesis"
      ref={ref}
      className="relative scroll-mt-[60px] overflow-hidden text-white"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #16295c 0%, #0b1533 48%, #070d22 100%)' }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[62%] top-[66%] h-[560px] w-[1000px] -translate-x-1/2 -translate-y-1/2"
        style={{ background: 'radial-gradient(ellipse, rgba(123,150,230,0.26) 0%, rgba(123,150,230,0) 65%)', filter: 'blur(64px)' }}
      />
      <div className="relative mx-auto flex max-w-[1248px] flex-col gap-11 px-6 pb-28 pt-[104px]">
        <div className="grid items-end gap-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          <div className="flex flex-col gap-[14px]">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#ff9b9b]">Synthesis</span>
            <h2 className="m-0 text-[clamp(1.9rem,3.2vw,2.5rem)] font-extrabold leading-[1.02] tracking-[-0.045em]">
              Reviewed evidence becomes synthesis.
            </h2>
          </div>
          <p className="m-0 max-w-[480px] text-[14.5px] leading-[1.65] text-[#b7c6f2]">
            Map fields to outcomes and comparisons, confirm eligible studies, then pool with a forest plot and diagnostics, or synthesize
            without pooling when pooling is not appropriate.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-y-5">
          {/* recessed evidence + mapping panels */}
          <div
            className="relative z-[1] mt-7 flex max-w-[320px] flex-[1_1_280px] flex-col gap-[14px] max-[900px]:max-w-none"
            style={{ opacity: rv.o, transform: `translateX(${rv.nx})`, transition: `opacity .9s ${EZ}, transform 1s ${EZ}` }}
          >
            <div className={`${PANEL} py-[14px] pl-4 pr-11 max-[900px]:pr-4`}>
              <div className="flex items-baseline justify-between gap-2 border-b border-white/[0.08] pb-2">
                <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-[#8fa3cf]">1 · Reviewed evidence</span>
                <span className="whitespace-nowrap text-[11px] text-[#8fa3cf]">5 studies</span>
              </div>
              {STUDIES.map((s, i) => {
                const delay = `${200 + i * 80}ms`;
                return (
                  <div
                    key={s.label}
                    className="grid items-center gap-2 border-b border-white/[0.06] py-2 [grid-template-columns:minmax(0,1fr)_auto]"
                    style={{ opacity: rv.o, transform: `translateX(${rv.nx})`, transition: `opacity .6s ${EZ} ${delay}, transform .7s ${EZ} ${delay}` }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[#eef2fb]">{s.label}</div>
                      <div className={`${styles.mono} overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[#8fa3cf]`}>
                        {s.t} · {s.c} · {s.status}
                      </div>
                    </div>
                    <span
                      className="whitespace-nowrap rounded-full border px-2 py-[1px] text-[11px] font-bold uppercase tracking-[0.06em]"
                      style={
                        s.excluded
                          ? { color: '#c7d2ea', borderColor: 'rgba(199,210,234,0.35)' }
                          : { color: '#b7c6f2', borderColor: 'rgba(183,198,242,0.4)' }
                      }
                    >
                      {s.tag}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={`${PANEL} ml-5 py-[14px] pl-4 pr-11 max-[900px]:ml-0 max-[900px]:pr-4`}>
              <div className="border-b border-white/[0.08] pb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#8fa3cf]">
                2 · Eligibility and mapping
              </div>
              <div className="flex flex-col gap-[7px] pt-2 text-[12.5px] leading-[1.5] text-[#dfe6f5]">
                <div>
                  <span className={`${styles.mono} text-[12px] text-[#b7c6f2]`}>caries_arrest</span> → events ·{' '}
                  <span className={`${styles.mono} text-[12px] text-[#b7c6f2]`}>sample_size</span> → N
                </div>
                <div>Comparison: SDF 38% vs placebo</div>
                <div>Chen 2023 excluded — comparator is NaF, not placebo</div>
                <div>Okafor 2022 events read from Figure 2, reviewer-verified</div>
              </div>
            </div>
          </div>

          {/* plot card, overlapping the panels */}
          <div
            className="relative z-[2] -ml-7 min-w-0 flex-[1_1_560px] overflow-hidden rounded-[10px] border border-[rgba(183,198,242,0.22)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_40px_100px_-24px_rgba(0,0,0,0.7),0_0_0_1px_rgba(0,0,0,0.3)] max-[900px]:ml-0"
            style={{
              background: 'linear-gradient(180deg, rgba(22,41,92,0.96), rgba(11,21,51,0.98))',
              opacity: rv.o,
              transform: `translateY(${rv.y})`,
              transition: `opacity 1s ${EZ}, transform 1.1s ${EZ}`,
            }}
          >
            <div className="h-px bg-[linear-gradient(90deg,rgba(183,198,242,0)_0%,rgba(183,198,242,0.8)_50%,rgba(183,198,242,0)_100%)]" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-[11px] text-[12px] text-[#8fa3cf]">
              <div className="flex flex-wrap items-center gap-[18px] whitespace-nowrap">
                <span className="text-[13px] font-bold text-white">3 · Synthesis</span>
                <span className="inline-flex items-center gap-[6px]"><StepCircle state="done">✓</StepCircle>Map fields</span>
                <span className="inline-flex items-center gap-[6px]"><StepCircle state="done">✓</StepCircle>Choose comparison</span>
                <span className="inline-flex items-center gap-[6px] font-semibold text-white"><StepCircle state="current">3</StepCircle>Plot</span>
                <span className="inline-flex items-center gap-[6px] text-[#6b7fae]"><StepCircle state="todo">4</StepCircle>Diagnostics</span>
              </div>
              <ExampleChip dark className="px-2 py-[3px] text-[#8fa3cf]" />
            </div>
            <div className="flex flex-wrap gap-[22px] border-b border-white/[0.08] px-5 pt-3">
              <span className="self-center whitespace-nowrap pb-[10px] text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b7fae]">Outcome</span>
              <button type="button" onClick={() => switchPane('ma')} aria-pressed={approach === 'ma'} className={tabCls(approach === 'ma')}>
                Caries arrest · 12 mo
              </button>
              <button type="button" onClick={() => switchPane('swim')} aria-pressed={approach === 'swim'} className={tabCls(approach === 'swim')}>
                Parent-reported pain · 12 mo
              </button>
            </div>

            {approach === 'ma' ? (
              <div className="px-5 pb-[18px] pt-4" style={paneStyle}>
                <div className="overflow-x-auto">
                  <div className="min-w-[620px]">
                    <div className="flex flex-wrap items-baseline gap-[10px]">
                      <span className="text-[15px] font-semibold">Caries arrest at 12 months</span>
                      <span className="text-[12.5px] text-[#8fa3cf]">SDF 38% vs placebo · Risk ratio · random effects (DL)</span>
                      <span className="ml-auto flex shrink-0 items-center gap-[5px] whitespace-nowrap text-[11px] text-[#8fa3cf]">
                        Export <span className="rounded-[4px] border border-white/[0.18] px-[7px] py-[2px] font-semibold text-white">CSV</span>
                        <span className="rounded-[4px] border border-white/[0.18] px-[7px] py-[2px] font-semibold text-white">SVG</span>
                      </span>
                    </div>
                    <div
                      className={`mt-[14px] grid gap-x-3 whitespace-nowrap border-b border-white/[0.12] pb-[6px] text-[11px] font-bold uppercase tracking-[0.06em] text-[#8fa3cf] ${PLOT_GRID}`}
                    >
                      <span>Study</span>
                      <span className="text-right">SDF n/N</span>
                      <span className="text-right">Plac. n/N</span>
                      <span />
                      <span>RR [95% CI]</span>
                      <span className="text-right">Weight</span>
                    </div>
                    {PLOT.map((p) => (
                      <div key={p.label} className={`grid h-9 items-center gap-x-3 rounded-[5px] hover:bg-white/[0.04] ${PLOT_GRID}`}>
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap pl-1 text-[13px] text-[#eef2fb]">{p.label}</span>
                        <span className={`${styles.mono} text-right text-[12px] text-[#c7d2ea]`}>{p.t}</span>
                        <span className={`${styles.mono} text-right text-[12px] text-[#c7d2ea]`}>{p.c}</span>
                        <div className="relative h-9" style={NULL_LINE}>
                          <span
                            className="absolute top-1/2 h-[1.5px] bg-[#b7c6f2]"
                            style={{
                              left: `${p.loX.toFixed(2)}%`,
                              width: `${p.ciW.toFixed(2)}%`,
                              transformOrigin: `${p.origin.toFixed(1)}% 50%`,
                              transform: `translateY(-50%) scaleX(${plotSx})`,
                              transition: `transform .9s ${EZ} ${p.delay}`,
                            }}
                          />
                          <span
                            className="absolute top-1/2 bg-white"
                            style={{
                              left: `${p.estX.toFixed(2)}%`,
                              width: p.size,
                              height: p.size,
                              transform: `translate(-50%, -50%) scale(${plotSx})`,
                              transition: `transform .7s ${EZ} ${p.delay}`,
                              boxShadow: '0 0 0 2px #0f1c3d, 0 0 12px rgba(123,150,230,0.7)',
                            }}
                          />
                        </div>
                        <span className={`${styles.mono} overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[#c7d2ea]`}>{p.ci}</span>
                        <span className={`${styles.mono} text-right text-[12px] text-[#8fa3cf]`}>{p.wLabel}</span>
                      </div>
                    ))}
                    <div className={`mt-1 grid h-10 items-center gap-x-3 border-t border-white/[0.12] ${PLOT_GRID}`}>
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap pl-1 text-[13px] font-bold">Total (95% CI)</span>
                      <span className={`${styles.mono} text-right text-[12px] font-semibold`}>188/267</span>
                      <span className={`${styles.mono} text-right text-[12px] font-semibold`}>121/261</span>
                      <div className="relative h-10" style={NULL_LINE}>
                        <svg
                          width="100%"
                          height="14"
                          viewBox="0 0 100 14"
                          preserveAspectRatio="none"
                          className="absolute left-0 top-[13px] block"
                          style={{
                            filter: 'drop-shadow(0 0 8px rgba(123,150,230,0.9))',
                            opacity: plotSx,
                            transform: `scaleX(${plotSx})`,
                            transformOrigin: `${POOLED_ORIGIN.toFixed(1)}% 50%`,
                            transition: `opacity .8s ${EZ} .7s, transform .9s ${EZ} .7s`,
                          }}
                          aria-hidden="true"
                        >
                          <polygon points={POOLED_POINTS} fill="#9db3f0" />
                        </svg>
                      </div>
                      <span className={`${styles.mono} overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold`}>1.52 [1.31, 1.77]</span>
                      <span className={`${styles.mono} text-right text-[12px] font-semibold`}>100%</span>
                    </div>
                    <div className={`grid gap-x-3 ${PLOT_GRID}`}>
                      <span />
                      <span />
                      <span />
                      <div className={`${styles.mono} relative h-8 text-[11px] text-[#8fa3cf]`}>
                        {TICKS.map((t) => (
                          <span key={t.label} className="absolute -translate-x-1/2" style={{ left: `${t.x.toFixed(2)}%` }}>
                            {t.label}
                          </span>
                        ))}
                        <span className="absolute top-[15px] whitespace-nowrap" style={{ right: `${(100 - NULL_X + 2).toFixed(2)}%` }}>
                          ← favours placebo
                        </span>
                        <span className="absolute top-[15px] whitespace-nowrap" style={{ left: `${(NULL_X + 2).toFixed(2)}%` }}>
                          favours SDF →
                        </span>
                      </div>
                      <span />
                      <span />
                    </div>
                    <div className={`${styles.mono} mt-2 flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-[10px] text-[12px] text-[#c7d2ea]`}>
                      <span className="whitespace-nowrap">τ² = 0.00 · Q = 0.34, df = 3 (p = 0.95) · I² = 0%</span>
                      <span className="whitespace-nowrap rounded-full bg-[rgba(183,198,242,0.16)] px-[9px] py-[1px] font-sans text-[11px] font-bold text-[#b7c6f2]">
                        Low heterogeneity
                      </span>
                      <span className="ml-auto whitespace-nowrap text-[#8fa3cf]">Z = 5.46 (p &lt; 0.001)</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-[14px] px-5 py-[18px]" style={paneStyle}>
                <div className="flex flex-wrap items-baseline gap-[10px]">
                  <span className="text-[15px] font-semibold">Parent-reported pain at 12 months</span>
                  <span className="text-[12.5px] text-[#8fa3cf]">SDF 38% vs placebo · reported by 3 studies</span>
                </div>
                <div className="flex flex-col gap-[6px] rounded-[8px] border border-white/[0.12] bg-white/[0.04] px-4 py-[14px]">
                  <div className="text-[14px] font-semibold">Parent-reported pain has nothing to pool</div>
                  <p className="m-0 text-[12.5px] leading-[1.55] text-[#c7d2ea]">
                    A meta-analysis needs, for each group, either an event count with a denominator or a mean with a spread and a sample
                    size. None of the three studies reports pain that way. The evidence is intact and extractable; no pooled estimate is
                    shown.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[520px]">
                    <div
                      className={`grid gap-[10px] whitespace-nowrap border-b border-white/[0.12] px-1 pb-[6px] text-[11px] font-bold uppercase tracking-[0.06em] text-[#8fa3cf] ${SWIM_GRID}`}
                    >
                      <span>Study</span>
                      <span>As reported</span>
                      <span>Why not poolable</span>
                      <span>Source</span>
                    </div>
                    {SWIM.map((s) => (
                      <div
                        key={s.label}
                        className={`grid items-center gap-[10px] border-b border-white/[0.06] px-1 py-[7px] text-[12.5px] text-[#dfe6f5] ${SWIM_GRID}`}
                      >
                        <span className="font-medium text-[#eef2fb]">{s.label}</span>
                        <span className={`${styles.mono} text-[12px]`}>{s.effect}</span>
                        <span>{s.dir}</span>
                        <span className={`${styles.mono} text-[12px] text-[#b7c6f2]`}>{s.src}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-[12.5px] leading-[1.5] text-[#8fa3cf]">
                  Reported values stay in the results table with their sources. Export: CSV.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
