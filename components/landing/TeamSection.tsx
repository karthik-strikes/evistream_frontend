'use client';

import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { Eyebrow, ExampleChip, NavyTopLine } from './shared';

const STAGES = [
  { name: 'Collect', count: '48/48', pct: 100, done: true, delay: '.2s' },
  { name: 'Extract', count: '44/48', pct: 92, delay: '.3s' },
  { name: 'Review', count: '31/48', pct: 65, delay: '.4s' },
  { name: 'Assess', count: '18/48', pct: 38, delay: '.5s' },
];

const QUEUE = [
  { study: 'Chen 2023', task: 'Manual extract', delay: '600ms' },
  { study: 'Patel 2025', task: 'RoB 2 · D3–D5', delay: '680ms' },
  { study: 'Okafor 2022', task: 'Verify figure', delay: '760ms' },
];

const PANE = 'flex flex-col gap-3 border-b border-r border-[#f4f4f5] px-[22px] py-5';
const PANE_TITLE_BASE = 'text-[11px] font-bold uppercase tracking-[0.1em]';
const PANE_TITLE = `${PANE_TITLE_BASE} text-[#5a5a5a]`;
const LIST = 'flex flex-col overflow-hidden rounded-[7px] border border-[#ececec]';
const ROW3 = 'grid items-center gap-[10px] px-3 py-[9px] text-[13px] [grid-template-columns:minmax(0,1fr)_auto_auto]';
const SEAT_ROW = 'grid items-center gap-[10px] px-3 py-[9px] text-[13px] [grid-template-columns:30px_minmax(0,1fr)_auto]';
const SEAT_PILL = 'inline-flex h-5 items-center justify-center rounded-full text-[11px] font-bold';

export function TeamSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  const barS = seen ? 1 : 0;
  const paneFade = (d: string) => ({ opacity: rv.o, transition: `opacity .7s ${EZ} ${d}` });

  return (
    <section id="team" ref={ref} className="relative scroll-mt-[60px] overflow-hidden border-b border-[#e4e4e7] bg-[#f7f8fa]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[70%] h-[420px] w-[900px] -translate-x-1/2 -translate-y-1/2"
        style={{ background: 'radial-gradient(ellipse, rgba(1,31,91,0.10) 0%, rgba(1,31,91,0) 68%)', filter: 'blur(48px)' }}
      />
      <div className="relative mx-auto flex max-w-[1248px] flex-col gap-7 px-6 pb-24 pt-[88px]">
        <div className="grid items-end gap-x-12 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          <div className="flex flex-col gap-[10px]">
            <Eyebrow>Team coordination</Eyebrow>
            <h2 className="m-0 text-[clamp(1.6rem,2.6vw,1.9rem)] font-extrabold leading-[1.08] tracking-[-0.04em]">
              One workspace for the review team.
            </h2>
          </div>
          <p className="m-0 max-w-[520px] text-[14.5px] leading-[1.65] text-[#3d3d3d]">
            Project owners define the scope and assign reviewer seats. Each reviewer sees the studies waiting on them; leads see progress
            across extraction, consensus and appraisal.
          </p>
        </div>

        <div
          className={`${styles.windowShadow} ${styles.teamWindow} overflow-hidden rounded-[10px] border border-[#d4d4d8] bg-white`}
          style={seen ? { opacity: 1 } : { opacity: 0, transform: `translateY(${rv.y})` }}
        >
          <NavyTopLine />
          {/* project header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e4e4e7] bg-[#fafafa] px-5 py-[14px]">
            <div className="flex min-w-0 items-center gap-[14px]">
              <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] bg-[#011F5B] text-[12px] font-bold tracking-[0.02em] text-white">
                SDF
              </span>
              <div className="min-w-0 leading-[1.3]">
                <div className="text-[15px] font-bold tracking-[-0.01em]">Silver diamine fluoride review</div>
                <div className="whitespace-nowrap text-[12px] text-[#5a5a5a]">48 studies · 3 reviewer seats · owner: project lead</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-[18px] text-[12.5px] text-[#5a5a5a]">
              <span className="border-b-2 border-[#011F5B] pb-[3px] font-semibold text-[#0a0a0a]">Overview</span>
              <span>Documents</span>
              <span>Forms</span>
              <span>Consensus</span>
              <span>Risk of Bias</span>
              <span>Synthesis</span>
              <ExampleChip className="text-inherit" />
            </div>
          </div>

          {/* project-level stage bar */}
          <div className="grid grid-cols-5 border-b border-[#e4e4e7]">
            {STAGES.map((s) => (
              <div key={s.name} className="flex min-w-0 flex-col gap-[6px] border-r border-[#f4f4f5] px-4 py-[10px] max-[600px]:px-2">
                <div className="flex flex-wrap justify-between gap-x-1 text-[12px]">
                  <span className="font-semibold text-[#0a0a0a]">{s.name}</span>
                  <span className={styles.mono} style={{ color: s.done ? '#011F5B' : '#3d3d3d' }}>
                    {s.count}
                  </span>
                </div>
                <span className="block h-[3px] overflow-hidden rounded-[2px] bg-[#ececec]">
                  <span
                    className="block h-full bg-[#011F5B]"
                    style={{
                      width: `${s.pct}%`,
                      transform: `scaleX(${barS})`,
                      transformOrigin: '0 50%',
                      transition: `transform 1.1s ${EZ} ${s.delay}`,
                    }}
                  />
                </span>
              </div>
            ))}
            <div className="flex min-w-0 flex-col gap-[6px] px-4 py-[10px] max-[600px]:px-2">
              <div className="flex flex-wrap justify-between gap-x-1 text-[12px]">
                <span className="font-semibold text-[#8a8a8a]">Synthesize</span>
                <span className={`${styles.mono} text-[#8a8a8a]`}>—</span>
              </div>
              <span className="block h-[3px] rounded-[2px] bg-[#ececec]" />
            </div>
          </div>

          {/* panes */}
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
            <div className={PANE} style={paneFade('.25s')}>
              <div className="flex items-baseline justify-between">
                <span className={PANE_TITLE}>Review scope</span>
                <span className="text-[12px] text-[#8a8a8a]">Edit</span>
              </div>
              <dl className="m-0 grid gap-x-[10px] gap-y-2 text-[13px] leading-[1.45] [grid-template-columns:26px_1fr]">
                {[
                  ['P', 'Children 3–6 with active caries'],
                  ['I', 'Silver diamine fluoride 38%'],
                  ['C', 'Placebo varnish'],
                  ['O', 'Caries arrest at 12 months'],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className={`${styles.mono} pt-[2px] text-[11px] font-medium text-[#990000]`}>{k}</dt>
                    <dd className="m-0 text-[#0a0a0a]">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-[6px] border-t border-[#f4f4f5] pt-[10px]">
                <span className={`${styles.mono} rounded-[4px] border border-[#e4e4e7] px-2 py-[2px] text-[12px] text-[#0a0a0a]`}>
                  patient_population_form
                </span>
                <span className="self-center text-[12px] text-[#5a5a5a]">24 fields · RoB 2 enabled</span>
              </div>
            </div>

            <div className={PANE} style={paneFade('.4s')}>
              <div className="flex items-baseline justify-between">
                <span className={PANE_TITLE}>Assignments</span>
                <span className="text-[12px] text-[#8a8a8a]">Manage seats</span>
              </div>
              <div className={LIST}>
                <div className={`${SEAT_ROW} border-b border-[#f4f4f5]`}>
                  <span className={`${SEAT_PILL} bg-[#0a0a0a] text-white`}>R1</span>
                  <span className="font-medium text-[#0a0a0a]">Reviewer 1</span>
                  <span className="whitespace-nowrap text-[12px] text-[#5a5a5a]">extraction · RoB 2 · 24 studies</span>
                </div>
                <div className={`${SEAT_ROW} border-b border-[#f4f4f5]`}>
                  <span className={`${SEAT_PILL} bg-[#e4e4e7] text-[#0a0a0a]`}>R2</span>
                  <span className="font-medium text-[#0a0a0a]">Reviewer 2</span>
                  <span className="whitespace-nowrap text-[12px] text-[#5a5a5a]">extraction · RoB 2 · 24 studies</span>
                </div>
                <div className={SEAT_ROW}>
                  <span className={`${SEAT_PILL} bg-[#011F5B] text-white`}>CR</span>
                  <span className="font-medium text-[#0a0a0a]">Consensus reviewer</span>
                  <span className="whitespace-nowrap text-[12px] text-[#5a5a5a]">adjudication · all fields</span>
                </div>
              </div>
              <span className="text-[12px] text-[#5a5a5a]">Two independent extractions per study; one adjudicator records decisions.</span>
            </div>

            <div className={`${PANE} bg-[#fafafa] shadow-[inset_3px_0_0_#011F5B]`} style={paneFade('.55s')}>
              <div className="flex items-baseline justify-between">
                <span className={`${PANE_TITLE_BASE} text-[#011F5B]`}>My queue · R1</span>
                <span className="rounded-full bg-[#fbeeee] px-2 py-[1px] text-[12px] font-semibold text-[#990000]">3 waiting</span>
              </div>
              <div className={`${LIST} bg-white`}>
                {QUEUE.map((q) => (
                  <div
                    key={q.study}
                    className={`${ROW3} cursor-pointer border-b border-[#f4f4f5] hover:bg-[#fafafa]`}
                    style={{
                      opacity: rv.o,
                      transform: `translateX(${rv.x})`,
                      transition: `opacity .6s ${EZ} ${q.delay}, transform .7s ${EZ} ${q.delay}, background .3s`,
                    }}
                  >
                    <span className="font-medium text-[#0a0a0a]">{q.study}</span>
                    <span className="whitespace-nowrap rounded-[4px] bg-[#f4f4f5] px-[7px] py-[1px] text-[11px] font-semibold text-[#0a0a0a]">{q.task}</span>
                    <span className="whitespace-nowrap text-[12px] font-semibold text-[#011F5B]">Open →</span>
                  </div>
                ))}
              </div>
              <span className="text-[12px] text-[#5a5a5a]">Only the studies assigned to you, in the order they were queued.</span>
            </div>

            <div className="flex flex-col gap-3 border-b border-[#f4f4f5] px-[22px] py-5" style={paneFade('.7s')}>
              <div className="flex items-baseline justify-between">
                <span className={PANE_TITLE}>Jobs</span>
                <span className="text-[12px] text-[#8a8a8a]">Last run 14:12</span>
              </div>
              <div className={LIST}>
                <div className={`${ROW3} border-b border-[#f4f4f5]`}>
                  <span className="font-medium text-[#0a0a0a]">Extraction · batch 3</span>
                  <span className={`${styles.mono} text-[12px] text-[#3d3d3d]`}>16/16</span>
                  <span className="rounded-full bg-[#e8edf5] px-2 py-[1px] text-[11px] font-semibold text-[#011F5B]">Done</span>
                </div>
                <div className={`${ROW3} border-b border-[#f4f4f5]`}>
                  <span className="font-medium text-[#0a0a0a]">Extraction · batch 4</span>
                  <span className={`${styles.mono} text-[12px] text-[#3d3d3d]`}>14/16</span>
                  <span className="rounded-full bg-[#fbeeee] px-2 py-[1px] text-[11px] font-semibold text-[#990000]">2 failed</span>
                </div>
                <div className={ROW3}>
                  <span className="font-medium text-[#0a0a0a]">RoB 2 · signalling questions</span>
                  <span className={`${styles.mono} text-[12px] text-[#3d3d3d]`}>18/48</span>
                  <span className="rounded-full bg-[#f4f4f5] px-2 py-[1px] text-[11px] font-semibold text-[#0a0a0a]">Running</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-[10px]">
                <span className="text-[12px] text-[#5a5a5a]">Failed items keep their inputs and can be retried in place.</span>
                <span className="whitespace-nowrap rounded-[6px] border border-[#d4d4d8] bg-white px-[10px] py-1 text-[12px] font-semibold text-[#0a0a0a]">
                  Retry 2
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
