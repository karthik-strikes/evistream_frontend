import Link from 'next/link';
import styles from './landing.module.css';
import { PENN_CIGOH_URL, RESEARCH_URL } from './links';

const LINK = `${styles.footerLink} text-[13px] text-[#8a8a8a]`;
const HEAD = 'text-[11px] font-bold uppercase tracking-[0.1em] text-[#5a5a5a]';

export function LandingFooter() {
  return (
    <footer className="border-t-2 border-[#990000] bg-[#0a0a0a] text-[#8a8a8a]">
      <div className="mx-auto grid max-w-[1248px] gap-8 px-6 pb-5 pt-12 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-bold text-white">eviStreams</span>
          <p className="m-0 max-w-[280px] text-[12.5px] leading-[1.6]">
            Extraction, review, risk-of-bias assessment, and synthesis for systematic-review teams.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className={HEAD}>Product</span>
          <a href="#workflow" className={LINK}>Workflow</a>
          <a href="#review" className={LINK}>Review and consensus</a>
          <a href="#rob" className={LINK}>Risk of bias</a>
          <a href="#synthesis" className={LINK}>Synthesis</a>
          <a href="#faq" className={LINK}>FAQ</a>
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className={HEAD}>Research</span>
          <a href={RESEARCH_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            About the research
          </a>
          <a href={PENN_CIGOH_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            Center for Integrative Global Oral Health
          </a>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1248px] flex-wrap justify-between gap-3 border-t border-white/[0.08] px-6 pb-6 pt-4 text-[11.5px]">
        <span>© 2026 eviStreams · Example data shown is illustrative.</span>
        <span className="flex gap-[14px]">
          <Link href="/privacy" className="text-[#8a8a8a] transition-colors hover:text-white">Privacy</Link>
          <Link href="/terms" className="text-[#8a8a8a] transition-colors hover:text-white">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
