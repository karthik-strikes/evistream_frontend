'use client';

import styles from './landing.module.css';
import { EZ, revealStyle, useReveal } from './motion';
import { Eyebrow } from './shared';

const STEPS: [string, string][] = [
  ['Collect & configure', 'Bring in studies and define the review.'],
  ['Extract', 'Structure results with AI assistance.'],
  ['Review', 'Check entries and resolve disagreements.'],
  ['Assess', 'Work through RoB 2 with evidence.'],
  ['Synthesize', 'Pool results or synthesize without pooling.'],
];

export function WorkflowRail({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  return (
    <section id="workflow" ref={ref} className="scroll-mt-[60px] border-y border-[#e4e4e7] bg-white">
      <div className="mx-auto max-w-[1248px] px-6 pt-[18px]">
        <Eyebrow>Workflow</Eyebrow>
      </div>
      <div className="mx-auto grid max-w-[1248px] gap-x-7 px-6 pb-[22px] pt-2 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {STEPS.map(([title, line], i) => (
          <div
            key={title}
            className="flex flex-col gap-[2px] border-t border-[#d4d4d8] pt-3 hover:border-[#011F5B]"
            style={{
              opacity: rv.o,
              transform: `translateY(${rv.y})`,
              transition: `opacity .7s ${EZ} ${i * 80}ms, transform .8s ${EZ} ${i * 80}ms, border-color .4s`,
            }}
          >
            <span className={`${styles.mono} text-[11px] font-medium text-[#990000]`}>{String(i + 1).padStart(2, '0')}</span>
            <span className="text-[14px] font-semibold">{title}</span>
            <span className="text-[12.5px] leading-[1.55] text-[#5a5a5a]">{line}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
