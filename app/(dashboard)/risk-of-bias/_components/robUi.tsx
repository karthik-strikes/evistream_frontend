'use client';

/**
 * Small shared pieces of the Risk of Bias screens — one definition each, so the
 * traffic light, pills and headers read the same on every screen.
 *
 * Colours follow the design handoff (Cochrane traffic light) and the app's own
 * card language: white / #111 cards, gray-200 / #1f1f1f borders, rounded-xl.
 */

import { useCallback } from 'react';
import type React from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Judgement, Seat } from '../_lib/robModel';
import { JUDGEMENT_LABEL, SEAT_SHORT } from '../_lib/robModel';

// ── Navigation ───────────────────────────────────────────────────────────────

export type RobScreen = 'welcome' | 'protocol' | 'mapping' | 'dashboard' | 'new' | 'workspace' | 'comparisons' | 'consensus' | 'report';
export const ROB_SCREENS: RobScreen[] = ['welcome', 'protocol', 'mapping', 'dashboard', 'new', 'workspace', 'comparisons', 'consensus', 'report'];

/**
 * URL-backed position: `?screen=&study=&target=&domain=&form=&tab=&as=`.
 * Changing screen/study/target pushes history (Back undoes it); anything else
 * replaces, so tabs and domains don't flood the history.
 */
export function useRobNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = useCallback((key: string) => params.get(key) ?? '', [params]);
  const go = useCallback((next: Record<string, string | number | null | undefined>, opts?: { replace?: boolean }) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined || v === '') qs.delete(k);
      else qs.set(k, String(v));
    }
    const href = qs.toString() ? `${pathname}?${qs}` : pathname;
    const moved = ['screen', 'study', 'target'].some(k => k in next && String(next[k] ?? '') !== (params.get(k) ?? ''));
    if (moved && !opts?.replace) router.push(href, { scroll: true });
    else router.replace(href, { scroll: false });
  }, [router, pathname, params]);
  return { get, go };
}

// ── Traffic light ────────────────────────────────────────────────────────────

const LIGHT: Record<Judgement, { color: string; text: string }> = {
  low: { color: '#16a34a', text: 'text-[#15803d] dark:text-emerald-400' },
  some: { color: '#64748b', text: 'text-[#475569] dark:text-slate-400' },
  high: { color: '#dc2626', text: 'text-[#b91c1c] dark:text-red-400' },
};

export function judgementText(j: Judgement | null | undefined): string {
  return j ? JUDGEMENT_LABEL[j] : 'Not judged';
}

export function judgementTextClass(j: Judgement | null | undefined): string {
  return j ? LIGHT[j].text : 'text-gray-400 dark:text-zinc-500';
}

/**
 * The judgment marker: a coloured ring with a solid inner dot, no glyph.
 * Not judged is a dashed #d4d4d8 ring.
 *
 * - `thin` is the legend variant (1.5px ring, 40% dot).
 * - `muted` is "nothing may be shown here" — consensus pending, or hidden
 *   until both reviewers complete: a dashed #e5e7eb ring.
 * - `active` darkens an unjudged ring to #0a0a0a (the rail's current step).
 * - `neutral` is the rail's Preliminary step: #f3f4f6 fill, solid ring.
 */
export function Light({ j, size = 18, faded, title, thin, muted, active, neutral }: {
  j: Judgement | null | undefined; size?: number; faded?: boolean; title?: string;
  thin?: boolean; muted?: boolean; active?: boolean; neutral?: boolean;
}) {
  const ring = thin ? 1.5 : 2;
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', borderWidth: ring, boxSizing: 'border-box',
  };
  if (neutral) {
    return (
      <span title={title} style={{ ...base, borderStyle: 'solid', background: '#f3f4f6', borderColor: active ? '#0a0a0a' : '#e5e7eb' }}
        className="inline-flex shrink-0" />
    );
  }
  if (!j || muted) {
    return (
      <span title={title ?? (muted ? undefined : 'Not judged')}
        style={{ ...base, borderStyle: 'dashed', background: 'transparent', borderColor: active && !muted ? '#0a0a0a' : muted ? '#e5e7eb' : '#d4d4d8' }}
        className="inline-flex shrink-0" />
    );
  }
  const c = LIGHT[j].color;
  const [inner, outer] = thin ? ['40%', '42%'] : ['42%', '44%'];
  return (
    <span title={title ?? JUDGEMENT_LABEL[j]}
      style={{ ...base, borderStyle: 'solid', borderColor: c, background: `radial-gradient(circle,${c} 0 ${inner},transparent ${outer})` }}
      className={cn('inline-flex shrink-0', faded && 'opacity-55')} />
  );
}

// ── Text bits ────────────────────────────────────────────────────────────────

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500', className)}>
      {children}
    </div>
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100">
      <ChevronLeft className="h-3.5 w-3.5" />{children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]', className)}>
      {children}
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, disabled, className }: {
  value: T | null;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex overflow-hidden rounded-[7px] border border-gray-200 dark:border-[#2a2a2a]', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cn('min-w-[120px] px-4 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
              i > 0 && 'border-l border-gray-200 dark:border-[#2a2a2a]',
              on ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900'
                : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-[#111111] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]',
              (o.disabled || disabled) && !on && 'text-gray-300 dark:text-zinc-600')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Response / chip pill. `tone="muted"` is the selected "No information" look. */
export function Pill({ on, onClick, disabled, children, tone = 'solid', title, className }: {
  on?: boolean; onClick?: () => void; disabled?: boolean; children: ReactNode;
  tone?: 'solid' | 'muted'; title?: string; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cn('rounded-full border px-3 py-1 text-[13px] transition-colors disabled:cursor-not-allowed',
        on && tone === 'solid' && 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900',
        on && tone === 'muted' && 'border-gray-300 bg-gray-100 text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100',
        !on && 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300',
        disabled && !on && 'opacity-40 hover:border-gray-200',
        className)}>
      {children}
    </button>
  );
}

export function PrimaryButton({ children, onClick, disabled, className, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cn('inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[7px] bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400', className)}>
      {children}
    </button>
  );
}

export function OutlineButton({ children, onClick, disabled, className, small }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string; small?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center justify-center gap-1.5 border border-gray-200 bg-white font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a] dark:disabled:text-zinc-600',
        small ? 'h-7 rounded-[6px] px-2.5 text-[12px]' : 'h-[38px] rounded-[7px] px-4 text-[13px]', className)}>
      {children}
    </button>
  );
}

// ── Status ───────────────────────────────────────────────────────────────────

export type StatusTone = 'neutral' | 'blue' | 'slate' | 'red' | 'green' | 'indigo' | 'gray';

const TONE: Record<StatusTone, string> = {
  neutral: 'border-gray-200 text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
  blue: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  slate: 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300',
  red: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  green: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d] dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  indigo: 'border-[#c7d2fe] bg-[#eef2ff] text-[#4338ca] dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
  gray: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-[#2a2a2a] dark:bg-[#161616] dark:text-zinc-500',
};

export function StatusPill({ tone = 'neutral', children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-[6px] border px-2 py-0.5 text-[11px] font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Banner({ tone, icon, children, action, className }: {
  tone: 'green' | 'slate' | 'red' | 'blue' | 'indigo' | 'gray'; icon?: 'lock' | ReactNode;
  children: ReactNode; action?: ReactNode; className?: string;
}) {
  const cls = {
    green: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d] dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300',
    slate: 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-300',
    red: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] dark:border-red-900 dark:bg-red-950/20 dark:text-red-300',
    blue: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1e40af] dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
    indigo: 'border-[#c7d2fe] bg-[#eef2ff] text-[#4338ca] dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300',
    gray: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-[#242424] dark:bg-[#0d0d0d] dark:text-zinc-300',
  }[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-[18px]', cls, className)}>
      {icon === 'lock' ? <Lock className="mt-px h-3.5 w-3.5 shrink-0" /> : icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** R1 black · R2 gray · CR indigo outline. */
export function SeatBadge({ seat, size = 20 }: { seat: Seat; size?: number }) {
  const cls = seat === 'reviewer_1'
    ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900'
    : seat === 'reviewer_2'
      ? 'bg-gray-200 text-gray-700 dark:bg-zinc-700 dark:text-zinc-200'
      : 'border border-[#c7d2fe] bg-white text-[#4338ca] dark:border-indigo-800 dark:bg-transparent dark:text-indigo-300';
  return (
    <span style={{ minWidth: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold', cls)}>
      {SEAT_SHORT[seat]}
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-[3px] w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#1f1f1f]', className)}>
      <div className="h-full rounded-full bg-[#0a0a0a] dark:bg-zinc-300" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}
