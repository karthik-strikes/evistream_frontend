'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { Eyebrow, ExampleChip, NavyTopLine } from './shared';

const ENTRIES = [
  { seat: 'AI', seatLabel: 'AI', value: '12', src: 'p.7', quote: 'The primary outcome was assessed at 12 months', seatFg: '#011F5B', seatBg: '#ffffff', seatPill: '#011F5B', seatBorder: '#c5d0e6' },
  { seat: 'R1', seatLabel: 'Reviewer 1', value: '12', src: 'p.7', quote: 'The primary outcome was assessed at 12 months', seatFg: '#0a0a0a', seatBg: '#0a0a0a', seatPill: '#ffffff', seatBorder: '#0a0a0a' },
  { seat: 'R2', seatLabel: 'Reviewer 2', value: '18', src: 'p.9', quote: 'Table 2. Caries arrest at 18 months follow-up', seatFg: '#0a0a0a', seatBg: '#e4e4e7', seatPill: '#0a0a0a', seatBorder: '#e4e4e7' },
];

const HISTORY_BASE = [
  { who: 'AI', what: 'extracted 12 · source p. 7', when: '13:20', dot: '#011F5B' },
  { who: 'R1', what: 'entered 12 · p. 7', when: '13:41', dot: '#0a0a0a' },
  { who: 'R2', what: 'entered 18 · Table 2, p. 9', when: '13:48', dot: '#5a5a5a' },
  { who: 'CR', what: 'opened R2 evidence in the PDF pane', when: '13:58', dot: '#011F5B' },
];
const HISTORY_DECIDED = { who: 'CR', what: 'accepted majority · 12 · AI + R1 agree (2/3)', when: '14:02', dot: '#011F5B' };

/** RingChart (36px, r 14, stroke 4): agreed arc draws in, then resolved + needs-decision segments. */
function RingChart({ drawn }: { drawn: boolean }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx="18" cy="18" r="14" fill="none" stroke="#e4e4e7" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="#011F5B"
        strokeWidth="4"
        strokeDasharray={`${drawn ? 66 : 0} 88`}
        style={{ transition: `stroke-dasharray 1.1s ${EZ} .3s` }}
      />
      <circle cx="18" cy="18" r="14" fill="none" stroke="#011F5B" strokeWidth="4" strokeDasharray="11 88" strokeDashoffset="-66" />
      <circle cx="18" cy="18" r="14" fill="none" stroke="#990000" strokeWidth="4" strokeDasharray="11 88" strokeDashoffset="-77" />
    </svg>
  );
}

export function ReviewSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  const [tab, setTab] = useState<'review' | 'history'>('review');
  const [decided, setDecided] = useState(false);
  const [histIn, setHistIn] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafs = useRef<number[]>([]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      rafs.current.forEach(cancelAnimationFrame);
    },
    [],
  );

  const acceptMajority = () => {
    setDecided(true);
    if (rm) {
      setTab('history');
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTab('history');
      setHistIn(false);
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => setHistIn(true));
        rafs.current.push(r2);
      });
      rafs.current.push(r1);
    }, 650);
  };

  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    setDecided(false);
    setTab('review');
  };

  const history = (decided ? [...HISTORY_BASE, HISTORY_DECIDED] : HISTORY_BASE).map((h, i) => ({ ...h, delay: `${i * 70}ms` }));
  const tabBtn = (active: boolean) =>
    `cursor-pointer leading-[normal] whitespace-nowrap rounded-[5px] border-0 px-3 py-[5px] text-[12px] font-semibold transition-[background] duration-[400ms] ${
      active ? 'bg-[#0a0a0a] text-white' : 'bg-transparent text-[#3d3d3d]'
    }`;

  return (
    <section id="review" ref={ref} className="scroll-mt-[60px] bg-[linear-gradient(#ffffff,#fafafa)]">
      <div className="mx-auto grid max-w-[1248px] items-start gap-14 px-6 py-24 [grid-template-columns:minmax(280px,360px)_minmax(0,1fr)] max-[700px]:grid-cols-1">
        <div
          className="sticky top-[92px] flex flex-col gap-4 pt-2 max-[700px]:static"
          style={{ opacity: rv.o, transform: `translateX(${rv.x})`, transition: `opacity .8s ${EZ}, transform .9s ${EZ}` }}
        >
          <Eyebrow>Review and consensus</Eyebrow>
          <h2 className="m-0 text-[clamp(1.9rem,3vw,2.3rem)] font-extrabold leading-[1.05] tracking-[-0.045em]">
            Independent reviews. One recorded decision.
          </h2>
          <p className="m-0 text-[14.5px] leading-[1.65] text-[#3d3d3d]">
            Reviewers enter values independently. Where they differ, the adjudicator sees every entry with its evidence, a majority
            suggestion when two agree, and records one decision.
          </p>
        </div>

        <div
          className={`${styles.windowShadow} min-w-0 overflow-hidden rounded-[10px] border border-[#d4d4d8] bg-white`}
          style={{ opacity: rv.o, transform: `translateY(${rv.y})`, transition: `opacity .9s ${EZ}, transform 1s ${EZ}` }}
        >
          <NavyTopLine />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e4e4e7] bg-[#fafafa] px-[18px] py-3">
            <div className="flex min-w-0 items-center gap-3">
              <RingChart drawn={seen} />
              <div className="min-w-0 leading-[1.35]">
                <div className="text-[14px] font-bold tracking-[-0.01em]">Consensus · Smith 2024</div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[#3d3d3d]">
                  24 fields · <span className="font-semibold text-[#011F5B]">18 agreed</span> · 3 resolved ·{' '}
                  <span className="font-semibold text-[#990000]">{decided ? 2 : 3} need decision</span> · adjudicator{' '}
                  <span className="inline-flex h-[17px] min-w-[22px] items-center justify-center rounded-full bg-[#011F5B] px-[5px] align-[1px] text-[11px] font-bold text-white">
                    CR
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-[2px] rounded-[7px] border border-[#e4e4e7] bg-white p-[2px]">
                <button type="button" onClick={() => setTab('review')} aria-pressed={tab === 'review'} className={tabBtn(tab === 'review')}>
                  Review
                </button>
                <button type="button" onClick={() => setTab('history')} aria-pressed={tab === 'history'} className={tabBtn(tab === 'history')}>
                  Decision history
                </button>
              </div>
              <ExampleChip className="px-2 py-[3px]" />
            </div>
          </div>

          {/* agreed row */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#f4f4f5] px-[18px] py-[9px] text-[12.5px] text-[#3d3d3d] shadow-[inset_3px_0_0_#c5d0e6]">
            <span className={`${styles.mono} min-w-[150px] text-[12px] text-[#0a0a0a]`}>sample_size</span>
            <span className="text-[#0a0a0a]">124</span>
            <span className="text-[11px] text-[#8a8a8a]">AI · R1 · R2 match</span>
            <span className="ml-auto rounded-full bg-[#e8edf5] px-2 py-[1px] text-[11px] font-semibold text-[#011F5B]">Agreed</span>
          </div>

          {/* disputed field card */}
          <div
            style={{
              boxShadow: `inset 3px 0 0 ${decided ? '#011F5B' : '#990000'}`,
              background: decided ? '#ffffff' : 'rgba(251,238,238,0.5)',
              transition: 'background .5s',
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 px-[18px] pt-[14px]">
              <div>
                <div className={`${styles.mono} text-[13px] font-medium text-[#0a0a0a]`}>follow_up_months</div>
                <div className="mt-[2px] text-[12px] text-[#5a5a5a]">
                  Months from randomisation to the primary outcome ·{' '}
                  <span className="rounded-[3px] bg-[#f4f4f5] px-[5px] text-[11px] font-bold uppercase tracking-[0.06em] text-[#8a8a8a]">number</span>
                </div>
              </div>
              <span
                className="whitespace-nowrap rounded-full px-[9px] py-[2px] text-[11px] font-semibold"
                style={{ background: decided ? '#e8edf5' : '#fbeeee', color: decided ? '#011F5B' : '#990000' }}
              >
                {decided ? '✓ Majority accepted' : 'Needs decision'}
              </span>
            </div>

            {tab === 'review' ? (
              <div className="flex flex-col gap-3 px-[18px] pb-[18px] pt-[14px]">
                <div className="grid gap-[10px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                  {ENTRIES.map((e, i) => {
                    const delay = `${150 + i * 90}ms`;
                    return (
                      <div
                        key={e.seat}
                        className={`${styles.entryCard} flex cursor-pointer flex-col gap-[6px] rounded-[8px] border border-[#e4e4e7] bg-white px-[14px] py-3`}
                        style={{
                          opacity: rv.o,
                          ...(seen ? {} : { transform: `translateY(${rv.y})` }),
                          transition: `opacity .6s ${EZ} ${delay}, transform .7s ${EZ} ${seen ? '0ms' : delay}, box-shadow .4s`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-[6px]">
                          <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: e.seatFg }}>
                            {e.seatLabel}
                          </span>
                          <span
                            className="inline-flex h-[17px] min-w-[22px] items-center justify-center rounded-full border px-[5px] text-[11px] font-bold"
                            style={{ background: e.seatBg, color: e.seatPill, borderColor: e.seatBorder }}
                          >
                            {e.seat}
                          </span>
                        </div>
                        <div className="text-[22px] font-bold tracking-[-0.02em] text-[#0a0a0a]">{e.value}</div>
                        <a
                          href="#review"
                          title="Show this passage in the PDF"
                          className="flex items-start gap-[6px] border-l-2 border-[#d4d4d8] pl-2 text-[12px] italic leading-[1.45] text-[#5a5a5a] hover:border-[#5a5a5a] hover:text-[#0a0a0a]"
                        >
                          {`“${e.quote}” `}
                          <span className="whitespace-nowrap font-semibold not-italic" style={{ color: e.seatFg }}>
                            {e.src}
                          </span>
                        </a>
                      </div>
                    );
                  })}
                </div>
                <div
                  className="flex items-center gap-[10px] rounded-[8px] border border-[#c5d0e6] bg-[#e8edf5] py-2 pl-[14px] pr-2"
                  style={{
                    opacity: rv.o,
                    transform: `translateY(${rv.y})`,
                    transition: `opacity .6s ${EZ} .45s, transform .7s ${EZ} .45s`,
                  }}
                >
                  <span className="flex-1 text-[12.5px] font-semibold text-[#011F5B]">AI + R1 agree (2/3) · 12</span>
                  {!decided ? (
                    <button
                      type="button"
                      onClick={acceptMajority}
                      className="cursor-pointer leading-[normal] whitespace-nowrap rounded-[6px] border-0 bg-[#011F5B] px-[11px] py-[6px] text-[12px] font-semibold text-white"
                    >
                      Accept majority
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-[6px] whitespace-nowrap text-[12px] font-semibold text-[#011F5B]">
                      ✓ Majority accepted{' '}
                      <button
                        type="button"
                        onClick={undo}
                        className="cursor-pointer leading-[normal] rounded-[5px] border border-[#d4d4d8] bg-transparent px-[7px] py-[2px] text-[11px] font-medium text-[#3d3d3d]"
                      >
                        Reset
                      </button>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#5a5a5a]">
                  <span>Or pick a source box above, or</span>
                  <span className="inline-block whitespace-nowrap rounded-[6px] border border-[#d4d4d8] bg-white px-[10px] py-[5px] text-[12px] font-semibold text-[#0a0a0a]">
                    Enter a different answer
                  </span>
                  <span className="ml-auto whitespace-nowrap">Quotes open the PDF pane at the cited page.</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-[18px] pb-[18px] pt-[14px]">
                {decided ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#c5d0e6] bg-[#e8edf5] px-[14px] py-3">
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#011F5B]">Recorded decision</span>
                      <span className="text-[22px] font-bold tracking-[-0.02em]">12</span>
                    </div>
                    <div className="text-right text-[12px] leading-[1.5] text-[#0a0a0a]">
                      Majority accepted by <span className="font-semibold">CR</span> · 14:02
                      <br />
                      AI + R1 agree (2/3) · source p. 7
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[8px] border border-dashed border-[#d4d4d8] px-[14px] py-3 text-[12.5px] text-[#5a5a5a]">
                    No decision recorded yet. Accept the majority suggestion, pick a source, or enter a different answer in the Review tab.
                  </div>
                )}
                <ol className="m-0 ml-2 flex list-none flex-col border-l border-[#e4e4e7] p-0">
                  {history.map((h) => (
                    <li
                      key={`${h.who}-${h.when}`}
                      className="relative pb-[10px] pl-[18px] text-[12.5px] leading-[1.5] text-[#0a0a0a]"
                      style={{
                        opacity: histIn ? 1 : 0,
                        transform: `translateX(${histIn ? '0px' : '-8px'})`,
                        transition: `opacity .5s ${EZ} ${h.delay}, transform .6s ${EZ} ${h.delay}`,
                      }}
                    >
                      <span
                        className="absolute left-[-4px] top-[6px] h-[7px] w-[7px] rounded-full shadow-[0_0_0_2px_#ffffff]"
                        style={{ background: h.dot }}
                      />
                      <span className="font-semibold text-[#0a0a0a]">{h.who}</span> {h.what} <span className="text-[#8a8a8a]">· {h.when}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* second needs-decision row */}
          <div className="flex flex-wrap items-center gap-3 border-t border-[#f4f4f5] px-[18px] py-[9px] text-[12.5px] text-[#3d3d3d] shadow-[inset_3px_0_0_#e9c2c2]">
            <span className={`${styles.mono} min-w-[150px] text-[12px] text-[#0a0a0a]`}>caries_arrest_pct</span>
            <span className="text-[#0a0a0a]">68.4 · 68.4 · 71.0</span>
            <span className="ml-auto whitespace-nowrap rounded-full bg-[#fbeeee] px-2 py-[1px] text-[11px] font-semibold text-[#990000]">Needs decision</span>
          </div>
        </div>
      </div>
    </section>
  );
}
