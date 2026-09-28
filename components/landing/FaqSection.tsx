'use client';

import { EZ, revealStyle, useReveal } from './motion';

const FAQ: [string, string][] = [
  ['Where does AI fit into the review?', 'AI can assist with extraction and suggestions. Reviewers inspect the evidence and make the recorded decisions.'],
  ['What can I import?', 'PDFs, RIS and EndNote files, DOIs, and records found through PubMed and ClinicalTrials.gov search.'],
  ['Which risk-of-bias tool is supported?', 'RoB 2 for parallel-group randomized trials.'],
  [
    'Do I have to pool studies?',
    'No. When pooling is not appropriate, eviStreams can retain the reported results and their sources for structured synthesis without a pooled estimate.',
  ],
];

export function FaqSection({ rm }: { rm: boolean }) {
  const [ref, seen] = useReveal<HTMLElement>(rm);
  const rv = revealStyle(seen);
  return (
    <section id="faq" ref={ref} className="scroll-mt-[60px] border-t border-[#e4e4e7] bg-[#fbfbfa]">
      <div className="mx-auto flex max-w-[1248px] flex-col gap-6 px-6 pb-20 pt-[72px]">
        <div className="flex flex-wrap items-baseline gap-4">
          <h2 className="m-0 text-[clamp(1.5rem,2.4vw,1.75rem)] font-extrabold leading-[1.1] tracking-[-0.035em]">Questions teams ask first.</h2>
        </div>
        <dl className="m-0 grid border-l border-t border-[#e4e4e7] bg-white [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          {FAQ.map(([q, a], i) => (
            <div
              key={q}
              className="border-b border-r border-[#e4e4e7] px-6 py-[22px] hover:bg-[#fafafa]"
              style={{
                opacity: rv.o,
                transform: `translateY(${rv.y})`,
                transition: `opacity .7s ${EZ} ${i * 90}ms, transform .8s ${EZ} ${i * 90}ms, background .3s`,
              }}
            >
              <dt className="mb-[6px] text-[15px] font-semibold">{q}</dt>
              <dd className="m-0 text-[14px] leading-[1.6] text-[#3d3d3d]">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
