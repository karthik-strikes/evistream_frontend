'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './landing.module.css';
import { EvidenceFlowDiagram } from './EvidenceFlowDiagram';
import { ExampleChip, NavyTopLine } from './shared';
import { GET_STARTED_HREF, RESEARCH_URL } from './links';

type HlKey = 'n' | 'age' | 'sdf' | 'plc' | 'clin' | 'rnd' | 'fu' | 'ltf';

interface FieldDef {
  name: string;
  value: string;
  chip: string;
  page: 4 | 7;
  hl: HlKey;
  kind: string;
  quote: string;
  ref: string;
  status: string;
}

const FIELDS: FieldDef[] = [
  { name: 'sample_size', value: '124', chip: 'p.4', page: 4, hl: 'n', kind: 'Verbatim · p. 4', quote: 'We enrolled 124 patients aged 3–6 years from four community clinics and randomised them to 38% SDF or placebo varnish.', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:02' },
  { name: 'age_range', value: '3–6 years', chip: 'p.4', page: 4, hl: 'age', kind: 'Verbatim · p. 4', quote: 'We enrolled 124 patients aged 3–6 years from four community clinics…', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:02' },
  { name: 'intervention', value: 'SDF 38%', chip: 'p.4', page: 4, hl: 'sdf', kind: 'Verbatim · p. 4', quote: '…randomised them to 38% SDF or placebo varnish.', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:03' },
  { name: 'comparator', value: 'Placebo varnish', chip: 'p.4', page: 4, hl: 'plc', kind: 'Verbatim · p. 4', quote: '…randomised them to 38% SDF or placebo varnish.', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:03' },
  { name: 'follow_up_months', value: '12', chip: 'p.7', page: 7, hl: 'fu', kind: 'Verbatim · p. 7', quote: 'The primary outcome was assessed at 12 months after varnish application.', ref: 'smith-2024.pdf · page 7 · Results 3.1', status: 'Awaiting check' },
  { name: 'randomisation', value: 'Sealed envelopes', chip: 'p.4', page: 4, hl: 'rnd', kind: 'Verbatim · p. 4', quote: 'Allocation was concealed using sequentially numbered opaque envelopes prepared by a statistician not involved in recruitment.', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:04' },
  { name: 'setting', value: '4 community clinics', chip: 'p.4', page: 4, hl: 'clin', kind: 'Verbatim · p. 4', quote: '…from four community clinics…', ref: 'smith-2024.pdf · page 4 · Methods 2.1', status: 'Checked · 14:04' },
  { name: 'lost_to_follow_up', value: '6', chip: 'p.7', page: 7, hl: 'ltf', kind: 'Verbatim · p. 7', quote: 'Of 124 children randomised, 118 (95%) attended the final examination; six were lost to follow-up after relocating.', ref: 'smith-2024.pdf · page 7 · Results 3.1', status: 'Awaiting check' },
];

const HL_ON = 'rgba(1,31,91,0.14)';
const HL_OFF = 'rgba(1,31,91,0)';
const MARK_TRANSITION = 'background .5s cubic-bezier(.22,1,.36,1), box-shadow .5s cubic-bezier(.22,1,.36,1)';

function Mark({ on, children }: { on: boolean; children: React.ReactNode }) {
  const c = on ? HL_ON : HL_OFF;
  return (
    <mark
      className="rounded-[1px] text-inherit"
      style={{ background: c, boxShadow: `0 0 0 2px ${c}`, transition: MARK_TRANSITION }}
    >
      {children}
    </mark>
  );
}

export function Hero({ rm }: { rm: boolean }) {
  // 0 = entering, 1 = in (window at rest), 2 = settled (evidence pane has faded in)
  const [hero, setHero] = useState<0 | 1 | 2>(0);
  const [field, setField] = useState(0);
  const [evIn, setEvIn] = useState(true);
  const [pageIn, setPageIn] = useState(true);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rm) {
      setHero(2);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setHero((h) => (h === 0 ? 1 : h)));
    });
    const settle = setTimeout(() => setHero(2), 900);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(settle);
    };
  }, [rm]);

  useEffect(() => () => {
    if (swapTimer.current) clearTimeout(swapTimer.current);
  }, []);

  const selectField = (i: number) => {
    if (i === field) return;
    const flip = FIELDS[i].page !== FIELDS[field].page;
    if (rm) {
      setField(i);
      return;
    }
    setEvIn(false);
    setPageIn(!flip);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => {
      setField(i);
      setEvIn(true);
      setPageIn(true);
    }, flip ? 320 : 180);
  };

  const sel = FIELDS[field];
  const hin = hero >= 1 || rm;
  const hl = (k: HlKey) => sel.hl === k && (k !== 'n' || hero >= 1);
  const evShown = hero >= 1 && evIn;
  const evDelay = hero >= 2 || rm ? '0s' : '.9s';
  const EZ = 'cubic-bezier(.22,1,.36,1)';

  return (
    <header className="relative overflow-hidden bg-white pb-14">
      {/* single localized navy light behind the window */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[74%] h-[480px] w-[1200px]"
        style={{
          transform: `translate(-50%, -50%) scale(${hin ? 1 : 0.7})`,
          opacity: hin ? 1 : 0,
          transition: `opacity 1.6s ${EZ} .3s, transform 1.8s ${EZ} .3s`,
          background: 'radial-gradient(ellipse, rgba(1,31,91,0.20) 0%, rgba(1,31,91,0) 68%)',
          filter: 'blur(44px)',
        }}
      />
      <div className="relative mx-auto flex max-w-[1248px] flex-col gap-11 px-6 pt-[72px]">
        <div className="grid items-center gap-x-14 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))]">
          <div
            className="flex max-w-[560px] flex-col items-start gap-[18px]"
            style={{
              opacity: hin ? 1 : 0,
              transform: `translateY(${hin ? '0px' : '14px'})`,
              transition: `opacity .8s ${EZ}, transform .9s ${EZ}`,
            }}
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#990000]">For systematic-review teams</span>
            <h1
              className={`${styles.serif} m-0 text-[clamp(2.6rem,4.6vw,4rem)] font-normal leading-[1.02] tracking-[-0.02em] text-[#0a0a0a] [text-wrap:balance]`}
            >
              From research papers to reviewed <em className="italic text-[#990000]">evidence.</em>
            </h1>
            <p className="m-0 max-w-[560px] text-[17px] leading-[1.6] text-[#3d3d3d] [text-wrap:pretty]">
              Collect studies, extract structured data with AI, resolve reviewer disagreements, assess risk of bias, and build
              your synthesis in one workspace.
            </p>
            <div className="flex flex-nowrap items-center gap-2">
              <Link
                href={GET_STARTED_HREF}
                className={`${styles.primaryBtn} inline-flex h-11 items-center whitespace-nowrap rounded-[7px] bg-[#011F5B] px-[22px] text-[14px] font-semibold text-white hover:text-white`}
              >
                Get started
              </Link>
              <a
                href="#workflow"
                className="inline-flex h-11 items-center whitespace-nowrap rounded-[7px] border border-[#d4d4d8] bg-white px-[22px] text-[14px] font-medium text-[#0a0a0a] hover:bg-[#fafafa]"
              >
                See the workflow
              </a>
            </div>
            <span className="text-[13px] text-[#5a5a5a]">AI assists. Your team reviews and decides.</span>
            <div className="mt-1 flex flex-wrap items-center gap-x-[14px] gap-y-2 text-[12px] text-[#5a5a5a]">
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <Image
                  src="/upenn-logo.png"
                  alt="University of Pennsylvania"
                  width={0}
                  height={0}
                  sizes="100px"
                  className="block h-[18px] w-auto opacity-80"
                  unoptimized
                />
                Developed within Penn Dental Medicine
              </span>
              <span className="text-[#d4d4d8]">·</span>
              <a
                href={RESEARCH_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-[#3d3d3d] transition-colors hover:text-[#990000]"
              >
                Learn about the research →
              </a>
            </div>
          </div>
          <div
            className="flex min-w-0 justify-end"
            style={{ opacity: hin ? 1 : 0, transition: `opacity .8s ${EZ} .2s` }}
          >
            <EvidenceFlowDiagram rm={rm} />
          </div>
        </div>

        <figure className="m-0 flex min-w-0 flex-col gap-3">
          <div style={{ perspective: 1400 }}>
            <div
              className={`${styles.heroWindow} overflow-hidden rounded-[10px] border border-[#d4d4d8] bg-white`}
              style={
                hero === 0
                  ? { transform: 'perspective(1800px) rotateX(8deg) translateY(24px) scale(0.985)', opacity: 0 }
                  : { opacity: 1 }
              }
            >
              <NavyTopLine />
              <div className="flex items-center justify-between gap-4 border-b border-[#e4e4e7] bg-[#fafafa] px-5 py-3">
                <div className="flex min-w-0 items-center gap-[10px] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[#5a5a5a]">
                  <span className="font-bold text-[#0a0a0a]">Smith 2024</span>
                  <span className="text-[#c4c4c4]">/</span>
                  <span>smith-2024.pdf</span>
                  <span className="text-[#c4c4c4]">/</span>
                  <span>patient_population_form</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-[12px] text-[#5a5a5a]">Study 12 of 24 in your queue</span>
                  <span className="whitespace-nowrap rounded-full bg-[#e8edf5] px-[9px] py-[2px] text-[11px] font-semibold text-[#011F5B]">
                    Review · R1
                  </span>
                  <ExampleChip />
                </div>
              </div>

              <div className="grid h-[300px] items-stretch overflow-hidden [grid-template-columns:minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)]">
                {/* 1 · PDF pane */}
                <div className="relative flex min-h-0 flex-col overflow-hidden border-r border-[#e4e4e7] bg-[#efefed] px-[18px] pt-[14px]">
                  <div className="mb-[10px] flex items-center justify-between text-[11px] text-[#5a5a5a]">
                    <span className="inline-flex gap-1">
                      <span className="rounded-[4px] border border-[#d4d4d8] bg-white px-[7px] leading-[18px]">‹</span>
                      <span className="rounded-[4px] border border-[#d4d4d8] bg-white px-[7px] leading-[18px]">›</span>
                    </span>
                    <span className={`${styles.mono} whitespace-nowrap`}>page {sel.page} / 12</span>
                  </div>
                  <div
                    className={`${styles.serif} flex-1 rounded-t-[3px] border border-b-0 border-[#dededc] bg-white px-[22px] pt-5 leading-[1.42] text-[#1a1a1a] shadow-[0_1px_2px_rgba(0,0,0,0.05)]`}
                    style={{ opacity: pageIn ? 1 : 0, transition: `opacity .35s ${EZ}` }}
                  >
                    {sel.page === 4 ? (
                      <>
                        <div className="mb-[14px] flex justify-between font-sans text-[10.5px] text-[#8a8a8a]">
                          <span>Smith et al. · Journal of Dental Research</span>
                          <span>4</span>
                        </div>
                        <div className="mb-[6px] font-sans text-[12.5px] font-bold">2. Methods</div>
                        <div className="mb-1 font-sans text-[11.5px] font-semibold text-[#3d3d3d]">2.1 Participants and randomisation</div>
                        <p className="m-0 mb-2 text-[12.5px]">
                          We enrolled <Mark on={hl('n')}>124 patients</Mark> aged <Mark on={hl('age')}>3–6 years</Mark> from{' '}
                          <Mark on={hl('clin')}>four community clinics</Mark> and randomised them to <Mark on={hl('sdf')}>38% SDF</Mark> or{' '}
                          <Mark on={hl('plc')}>placebo varnish</Mark>.{' '}
                          <Mark on={hl('rnd')}>Allocation was concealed using sequentially numbered opaque envelopes</Mark> prepared by a
                          statistician not involved in recruitment.
                        </p>
                        <p className="m-0 text-[12.5px] text-[#3d3d3d]">
                          Children were eligible if they presented with at least one active carious lesion in a primary tooth…
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="mb-[14px] flex justify-between font-sans text-[10.5px] text-[#8a8a8a]">
                          <span>Smith et al. · Journal of Dental Research</span>
                          <span>7</span>
                        </div>
                        <div className="mb-[6px] font-sans text-[12.5px] font-bold">3. Results</div>
                        <div className="mb-1 font-sans text-[11.5px] font-semibold text-[#3d3d3d]">3.1 Follow-up</div>
                        <p className="m-0 mb-2 text-[12.5px]">
                          <Mark on={hl('fu')}>The primary outcome was assessed at 12 months</Mark> after varnish application. Of 124 children
                          randomised, 118 (95%) attended the final examination; <Mark on={hl('ltf')}>six were lost to follow-up</Mark> after
                          relocating.
                        </p>
                        <p className="m-0 text-[12.5px] text-[#3d3d3d]">
                          Baseline characteristics were balanced between arms (Table 1). No serious adverse events were reported…
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* 2 · Field table */}
                <div className="flex min-h-0 flex-col overflow-hidden border-r border-[#e4e4e7] bg-white">
                  <div className="grid gap-2 border-b border-[#e4e4e7] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a5a5a] [grid-template-columns:minmax(0,1fr)_auto]">
                    <span>Field</span>
                    <span>Value</span>
                  </div>
                  {FIELDS.map((f, i) => {
                    const a = i === field;
                    return (
                      <button
                        key={f.name}
                        type="button"
                        onClick={() => selectField(i)}
                        aria-pressed={a}
                        className="box-border grid w-full shrink-0 cursor-pointer items-center gap-2 border-0 border-b border-solid border-[#f4f4f5] px-4 py-2 text-left [grid-template-columns:minmax(0,1fr)_auto]"
                        style={{
                          background: a ? '#e8edf5' : 'transparent',
                          boxShadow: `inset 3px 0 0 ${a ? '#011F5B' : 'transparent'}`,
                          transition: `background .4s ${EZ}, box-shadow .4s ${EZ}`,
                        }}
                      >
                        <span className={`${styles.mono} overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[#0a0a0a]`}>{f.name}</span>
                        <span
                          className="inline-flex items-center gap-[6px] whitespace-nowrap text-[13px] text-[#0a0a0a]"
                          style={{ fontWeight: a ? 600 : 400 }}
                        >
                          {f.value}
                          <span
                            className={`${styles.mono} rounded-[4px] border bg-white px-[5px] text-[11px] leading-[17px]`}
                            style={{ color: a ? '#011F5B' : '#5a5a5a', borderColor: a ? 'rgba(1,31,91,0.35)' : '#e4e4e7' }}
                          >
                            {f.chip}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 3 · Source evidence */}
                <div className="flex flex-col bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-[#c5d0e6] bg-[#e8edf5] px-[14px] py-2">
                    <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em] text-[#011F5B]">Source evidence</span>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-[#011F5B]">{sel.kind}</span>
                  </div>
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-3"
                    style={{
                      opacity: evShown ? 1 : 0,
                      transform: `translateY(${evShown ? '0px' : '8px'})`,
                      transition: `opacity .45s ${EZ} ${evDelay}, transform .45s ${EZ} ${evDelay}`,
                    }}
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={`${styles.mono} text-[12px] text-[#5a5a5a]`}>{sel.name}</span>
                      <span className="text-[22px] font-bold tracking-[-0.02em] text-[#0a0a0a]">{sel.value}</span>
                    </div>
                    <p className={`${styles.serif} ${styles.lineClamp4} m-0 border-l-2 border-[#011F5B] pl-[10px] text-[13px] leading-[1.38] text-[#0a0a0a]`}>
                      “{sel.quote}”
                    </p>
                    <div className="text-[12px] text-[#5a5a5a]">{sel.ref}</div>
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#f4f4f5] pt-[10px] text-[12px] text-[#3d3d3d]">
                      <span className="inline-flex items-center gap-[6px]">
                        <span className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full bg-[#0a0a0a] text-[10.5px] font-bold text-white">
                          R1
                        </span>
                        {sel.status}
                      </span>
                      <span className="inline-flex gap-[6px]">
                        <span className="whitespace-nowrap rounded-[6px] border border-[#d4d4d8] px-[10px] py-1 text-[12px] font-semibold text-[#0a0a0a]">Edit</span>
                        <span className="whitespace-nowrap rounded-[6px] bg-[#011F5B] px-[10px] py-1 text-[12px] font-semibold text-white">Confirm</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="text-[12.5px] text-[#5a5a5a]">
            Select a field. Its available source text, table, figure, or page context opens beside it.
          </figcaption>
        </figure>
        <div className="h-10 flex-[1_1_100%]" />
      </div>
    </header>
  );
}
