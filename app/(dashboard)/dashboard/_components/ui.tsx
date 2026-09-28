'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import type { Workflow } from '@/types/home';
import { swatch } from '../_lib/tokens';

export { Card, PrimaryButton, OutlineButton, SeatBadge } from '../../risk-of-bias/_components/robUi';

export const useIsDark = () => useTheme().resolvedTheme === 'dark';

// ── Pills ────────────────────────────────────────────────────────────────────
// Home's own tones: robUi deliberately has no amber (the RoB page must stay
// amber-free), but the handoff uses amber for forms / R1-R2 work and rose for
// source material. So these live here, not in robUi.

export type HomeTone = 'green' | 'blue' | 'amber' | 'rose' | 'slate' | 'gray' | 'neutral';

const TONE: Record<HomeTone, string> = {
  green: 'border-[#bde9d3] bg-[#eaf8f1] text-[#177a4e] dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  blue: 'border-[#c5d8fc] bg-[#eef4fe] text-[#2a5fc9] dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  amber: 'border-[#fbdca8] bg-[#fff6e8] text-[#a8650a] dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  rose: 'border-[#f9c4cd] bg-[#fef1f3] text-[#c22d47] dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
  slate: 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300',
  gray: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-[#2a2a2a] dark:bg-[#161616] dark:text-zinc-500',
  neutral: 'border-gray-200 bg-white text-gray-600 dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-400',
};

export function Pill({ tone = 'neutral', children, className }: { tone?: HomeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-[6px] border px-2 py-px text-[11px] font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Swatch({ wf, outline }: { wf: Workflow; outline?: boolean }) {
  const dark = useIsDark();
  return outline
    ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px] border-[1.5px] border-[#cbd5e1] dark:border-slate-600" />
    : <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: swatch(wf, dark) }} />;
}

// ── Section chrome ───────────────────────────────────────────────────────────

export function SectionHeader({ id, title, right }: { id?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5 dark:border-[#1f1f1f]">
      <h2 id={id} className="m-0 text-[16px] font-semibold leading-6 text-[#0a0a0a] dark:text-zinc-100">{title}</h2>
      {right}
    </div>
  );
}

export function QuietLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('whitespace-nowrap text-[12px] font-medium text-gray-500 hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100', className)}>
      {children}
    </Link>
  );
}

/** Rows of pulsing bars sized to reserve the section's layout. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  const widths = ['55%', '70%', '45%', '60%', '50%', '65%'];
  return (
    <div aria-busy="true" className={cn('flex flex-col gap-[18px] p-4', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="home-pulse h-3 rounded bg-gray-100 dark:bg-[#1f1f1f]" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** A failed section says so and offers Retry. Never zeros. */
export function SectionError({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('m-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-[#f9c4cd] bg-[#fef1f3] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-[#c22d47] dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300', className)}>
      <span className="min-w-0 flex-1">Could not load {what}. Nothing is shown rather than zeros.</span>
      <button type="button" onClick={onRetry}
        className="inline-flex h-7 items-center rounded-[6px] border border-gray-200 bg-white px-2.5 text-[12px] font-medium text-gray-900 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]">
        Retry
      </button>
    </div>
  );
}

export function Restricted({ message }: { message?: string | null }) {
  return (
    <p className="m-0 px-4 py-4 text-[13px] text-gray-500 dark:text-zinc-400">
      {message || 'You do not have access to this summary in this project.'}
    </p>
  );
}

/** Small link styled as the handoff's 28px outline button. */
export function SmallLinkButton({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link href={href}
      className={cn('inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 text-[12px] font-medium',
        primary
          ? 'bg-[#0a0a0a] text-white hover:bg-gray-800 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white'
          : 'border border-gray-200 bg-white text-[#0a0a0a] hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]')}>
      {children}
    </Link>
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const SEAT_NAME: Record<string, string> = {
  reviewer_1: 'Reviewer 1',
  reviewer_2: 'Reviewer 2',
  adjudicator: 'Consensus reviewer',
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
