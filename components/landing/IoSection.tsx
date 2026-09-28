'use client';

import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { Eyebrow, NavyTopLine } from './shared';

const IN_ROWS = [
  { badge: 'PDF', label: 'Full-text papers', detail: 'upload or drag in', db: false },
  { badge: 'RIS', label: 'Reference libraries', detail: 'RIS and EndNote', db: false },
  { badge: 'DOI', label: 'Identifiers', detail: 'resolved to records', db: false },
  { badge: 'DB', label: 'Search', detail: 'PubMed, ClinicalTrials.gov', db: true },
];

const STAGES = [
  { label: 'Collect & configure', count: '48/48' },
  { label: 'Extract', count: '44/48' },
  { label: 'Review', count: '31/48' },
  { label: 'Assess · RoB 2', count: '18/48' },
];

const OUT_ROWS = [
  { title: 'Extraction results', line: 'Every field per study, with source page and quote columns when you want them', fmts: ['CSV', 'JSON'] },
  { title: 'Risk-of-bias table', line: 'Domain judgements for each study, plus a per-study report', fmts: ['CSV', 'Report'] },
  { title: 'Forest plot and study data', line: 'Publication-ready figure with the study-level table behind it', fmts: ['SVG', 'PNG', 'JPG', 'CSV'] },
];

export function IoSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  const col = 'max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:border-[#e4e4e7]';

  return (
    <section id="io" ref={ref} className="scroll-mt-[60px] bg-white">
      <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-6 py-20">
        <div className="grid items-end gap-x-12 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          <div className="flex flex-col gap-[10px]">
            <Eyebrow>Inputs and outputs</Eyebrow>
            <h2 className="m-0 text-[clamp(1.6rem,2.6vw,1.9rem)] font-extrabold leading-[1.08] tracking-[-0.04em]">
              Bring evidence in. Take reviewed work out.
            </h2>
          </div>
          <p className="m-0 max-w-[520px] text-[14.5px] leading-[1.65] text-[#3d3d3d]">
            Records arrive from the sources review teams already use. What leaves carries the review with it: values with their source
            pages, judgements with their evidence, and plots with the study-level data behind them.
          </p>
        </div>

        <div
          className="grid items-stretch overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] [grid-template-columns:minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.25fr)] max-[820px]:grid-cols-1"
          style={{ opacity: rv.o, transform: `translateY(${rv.y})`, transition: `opacity .9s ${EZ}, transform .9s ${EZ}` }}
        >
          {/* IN */}
          <div className={`flex flex-col gap-[14px] border-r border-[#e4e4e7] bg-[#fafafa] px-6 py-[22px] ${col}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#5a5a5a]">In</span>
              <span className={`${styles.mono} text-[11px] text-[#8a8a8a]`}>Documents</span>
            </div>
            <div className="flex flex-col gap-[6px]">
              {IN_ROWS.map((r, i) => (
                <div
                  key={r.badge}
                  className="grid items-center gap-[10px] rounded-[7px] border border-[#ececec] bg-white px-[10px] py-2 [grid-template-columns:34px_minmax(0,1fr)] hover:border-[#011F5B]"
                  style={{
                    opacity: rv.o,
                    transform: `translateX(${rv.nx})`,
                    transition: `opacity .6s ${EZ} ${i * 80}ms, transform .7s ${EZ} ${i * 80}ms, border-color .3s`,
                  }}
                >
                  <span
                    className={`${styles.mono} rounded-[4px] py-[3px] text-center text-[10.5px] font-bold ${
                      r.db ? 'bg-[#e8edf5] text-[#011F5B]' : 'bg-[#0a0a0a] text-white'
                    }`}
                  >
                    {r.badge}
                  </span>
                  <span className="text-[13px] font-medium text-[#0a0a0a]">
                    {r.label} <span className="font-normal text-[#5a5a5a]">· {r.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* PROJECT */}
          <div className={`relative flex flex-col justify-center gap-[14px] border-r border-[#e4e4e7] px-6 py-[22px] ${col}`}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[360px] -translate-x-1/2 -translate-y-1/2"
              style={{ background: 'radial-gradient(ellipse, rgba(1,31,91,0.12) 0%, rgba(1,31,91,0) 70%)', filter: 'blur(28px)' }}
            />
            <div
              className="relative overflow-hidden rounded-[8px] border border-[#d4d4d8] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_-16px_rgba(1,31,91,0.28),inset_0_1px_0_#ffffff]"
              style={{
                transform: `scale(${seen ? 1 : 0.92})`,
                opacity: rv.o,
                transition: `transform .9s ${EZ} .35s, opacity .7s ${EZ} .35s`,
              }}
            >
              <NavyTopLine />
              <div className="flex items-center justify-between gap-2 border-b border-[#f4f4f5] px-[14px] pb-[10px] pt-3">
                <span className="text-[13px] font-bold text-[#0a0a0a]">Silver diamine fluoride review</span>
                <span className={`${styles.mono} whitespace-nowrap text-[11px] text-[#5a5a5a]`}>48 studies</span>
              </div>
              <ol className="m-0 flex list-none flex-col px-[14px] pb-[10px] pt-[6px]">
                {STAGES.map((s) => (
                  <li
                    key={s.label}
                    className="grid items-center gap-[10px] border-b border-[#f4f4f5] py-[6px] text-[12.5px] text-[#0a0a0a] [grid-template-columns:14px_minmax(0,1fr)_auto]"
                  >
                    <span className="h-2 w-2 rounded-full bg-[#011F5B]" />
                    <span>{s.label}</span>
                    <span className={`${styles.mono} text-[11px] text-[#5a5a5a]`}>{s.count}</span>
                  </li>
                ))}
                <li className="grid items-center gap-[10px] py-[6px] text-[12.5px] text-[#8a8a8a] [grid-template-columns:14px_minmax(0,1fr)_auto]">
                  <span className="box-border h-2 w-2 rounded-full border-[1.5px] border-dashed border-[#8a8a8a]" />
                  <span>Synthesize</span>
                  <span className={`${styles.mono} text-[11px] text-[#8a8a8a]`}>—</span>
                </li>
              </ol>
            </div>
            <span className="relative text-center text-[12px] text-[#5a5a5a]">Everything below is produced from this one project.</span>
          </div>

          {/* OUT */}
          <div className="flex flex-col gap-[14px] px-6 py-[22px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#5a5a5a]">Out</span>
              <span className={`${styles.mono} text-[11px] text-[#8a8a8a]`}>Export</span>
            </div>
            <div className="flex flex-col overflow-hidden rounded-[7px] border border-[#ececec]">
              {OUT_ROWS.map((r, i) => {
                const delay = `${0.5 + i * 0.08}s`;
                return (
                  <div
                    key={r.title}
                    className={`grid items-center gap-3 px-3 py-[10px] [grid-template-columns:minmax(0,1fr)_auto] hover:bg-[#fafafa] ${
                      i < OUT_ROWS.length - 1 ? 'border-b border-[#f4f4f5]' : ''
                    }`}
                    style={{
                      opacity: rv.o,
                      transform: `translateX(${rv.x})`,
                      transition: `opacity .6s ${EZ} ${delay}, transform .7s ${EZ} ${delay}, background .3s`,
                    }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#0a0a0a]">{r.title}</div>
                      <div className="text-[12px] text-[#5a5a5a]">{r.line}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.fmts.map((f) => (
                        <span
                          key={f}
                          className={`${styles.mono} rounded-[4px] border border-[#d4d4d8] px-[6px] py-[1px] text-[11px] font-semibold text-[#0a0a0a]`}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="text-[12px] text-[#5a5a5a]">Exports keep the link back to the reviewed record.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
