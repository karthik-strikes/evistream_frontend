'use client';

import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { Eyebrow, ExampleChip } from './shared';

type J = 'low' | 'some' | 'high' | null;

// Colours as drawn in the design reference (Core Landing Experience.dc.html).
function light(j: J) {
  if (j === 'low') return { c: '#011F5B', s: 'solid', f: '#011F5B' };
  if (j === 'some') return { c: '#0a0a0a', s: 'solid', f: '#0a0a0a' };
  if (j === 'high') return { c: '#990000', s: 'solid', f: '#990000' };
  return { c: '#8a8a8a', s: 'dashed', f: 'transparent' };
}

const ROWS: [string, J, J, J][] = [
  ['D1 · Randomization process', 'low', 'low', 'low'],
  ['D2 · Deviations from intervention', 'low', 'some', 'low'],
  ['D3 · Missing outcome data', 'some', 'some', 'some'],
  ['D4 · Measurement of the outcome', 'low', 'low', 'low'],
  ['D5 · Selection of reported result', 'some', 'high', null],
  ['Overall', 'some', 'high', null],
];

const GRID = '[grid-template-columns:minmax(0,1fr)_48px_48px_72px]';

function Dot({ j, shown, delay }: { j: J; shown: boolean; delay: string }) {
  const L = light(j);
  return (
    <span className="flex justify-center">
      <span
        className="box-border h-4 w-4 rounded-full border-2"
        style={{
          borderStyle: L.s as 'solid' | 'dashed',
          borderColor: L.c,
          background: L.f,
          transform: `scale(${shown ? 1 : 0})`,
          transition: `transform .5s ${EZ} ${delay}`,
        }}
      />
    </span>
  );
}

export function RobSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  return (
    <section id="rob" ref={ref} className="scroll-mt-[60px] border-t border-[#e4e4e7] bg-[#fafafa]">
      <div className="mx-auto grid max-w-[1248px] items-center gap-14 px-6 py-[72px] [grid-template-columns:minmax(0,1.15fr)_minmax(280px,380px)] max-[760px]:grid-cols-1">
        <div
          className="min-w-0 overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.10)]"
          style={{ opacity: rv.o, transform: `translateY(${rv.y})`, transition: `opacity .9s ${EZ}, transform 1s ${EZ}` }}
        >
          <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-[#e4e4e7] bg-[#fafafa] px-4 py-[10px]">
            <span className="text-[13px] font-bold">Risk of Bias · Smith 2024</span>
            <span className="inline-flex items-center gap-2">
              <span className={`${styles.mono} whitespace-nowrap rounded-[4px] border border-[#d4d4d8] px-[7px] py-[1px] text-[11px] text-[#0a0a0a]`}>
                RoB 2 · parallel-group RCT
              </span>
              <ExampleChip />
            </span>
          </div>
          <div className="px-4 pb-[14px] pt-[6px]">
            <div className={`grid gap-2 border-b border-[#e4e4e7] px-1 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a5a5a] ${GRID}`}>
              <span>Domain</span>
              <span className="text-center">R1</span>
              <span className="text-center">R2</span>
              <span className="text-center">Consensus</span>
            </div>
            {ROWS.map(([name, a, b, c], i) => (
              <div
                key={name}
                className={`grid items-center gap-2 border-b border-[#f4f4f5] px-1 py-[9px] text-[13px] text-[#0a0a0a] transition-[background] duration-300 hover:bg-[#fafafa] ${GRID}`}
                style={{ fontWeight: name === 'Overall' ? 700 : 400 }}
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
                <Dot j={a} shown={seen} delay={`${i * 70}ms`} />
                <Dot j={b} shown={seen} delay={`${i * 70 + 120}ms`} />
                <Dot j={c} shown={seen} delay={`${i * 70 + 240}ms`} />
              </div>
            ))}
            <div className="mt-[10px] flex flex-wrap items-start gap-2 border-l-2 border-[#d4d4d8] pl-[10px] text-[12px] leading-[1.5] text-[#3d3d3d]">
              <span className="italic">“Secondary outcomes were analysed post hoc”</span>
              <span className="whitespace-nowrap font-semibold text-[#0a0a0a]">D5 · R2 · p. 9</span>
            </div>
            <div className="mt-[10px] flex flex-wrap gap-[14px] text-[11px] text-[#5a5a5a]">
              <span className="inline-flex items-center gap-[5px]"><span className="h-[10px] w-[10px] rounded-full bg-[#011F5B]" />Low</span>
              <span className="inline-flex items-center gap-[5px]"><span className="h-[10px] w-[10px] rounded-full bg-[#0a0a0a]" />Some concerns</span>
              <span className="inline-flex items-center gap-[5px]"><span className="h-[10px] w-[10px] rounded-full bg-[#990000]" />High</span>
              <span className="inline-flex items-center gap-[5px]">
                <span className="box-border h-[10px] w-[10px] rounded-full border-[1.5px] border-dashed border-[#8a8a8a]" />
                Pending
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Eyebrow
            className="block"
            style={{ opacity: rv.o, transform: `translateX(${rv.x})`, transition: `opacity .8s ${EZ} .1s, transform .9s ${EZ} .1s` }}
          >
            Risk of bias
          </Eyebrow>
          <h2 className="m-0 text-[clamp(1.5rem,2.4vw,1.75rem)] font-extrabold leading-[1.1] tracking-[-0.035em]">
            Assess risk of bias with the evidence in view.
          </h2>
          <p className="m-0 text-[14.5px] leading-[1.65] text-[#3d3d3d]">
            Reviewers work through RoB 2 domains for parallel-group randomized trials with the supporting evidence visible, and resolve
            differences into a recorded assessment.
          </p>
        </div>
      </div>
    </section>
  );
}
