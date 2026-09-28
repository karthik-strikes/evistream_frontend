'use client';

/**
 * Small shared pieces for the Synthesis screens. Controls and pills come from
 * the Risk of Bias kit (one definition across the two modules); what lives
 * here is specific to this page: the screen header, the definition list, the
 * required-reason input and the derived status pill.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Banner, Card, Eyebrow, OutlineButton, PrimaryButton, Segmented, StatusPill,
} from '../../risk-of-bias/_components/robUi';
import type { DerivedStatus } from '../_lib/synthesisModel';
import { useSynthesisNav } from '../_lib/nav';
import { useSynthesis } from '../_lib/useSynthesisData';

export { Banner, Card, Eyebrow, OutlineButton, PrimaryButton, Segmented, StatusPill };

export function ScreenHeader({ active }: { active: 'dashboard' | 'workspace' | 'protocol' }) {
  const syn = useSynthesis();
  const { go, get } = useSynthesisNav();
  const lastGroup = get('id') || syn.groups[0]?.id || '';
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Eyebrow className="text-gray-400 dark:text-zinc-500">Synthesis · {syn.projectName}</Eyebrow>
      <Segmented
        value={active}
        onChange={v => {
          if (v === 'dashboard') go({ screen: 'dashboard', tab: null });
          else if (v === 'protocol') go({ screen: syn.protocolConfirmed ? 'protocol' : 'welcome', tab: null });
          else go({ screen: 'workspace', id: lastGroup });
        }}
        options={[
          { value: 'dashboard', label: 'Dashboard', disabled: !syn.protocolConfirmed },
          { value: 'workspace', label: 'Workspace', disabled: !syn.protocolConfirmed || !lastGroup },
          { value: 'protocol', label: 'Protocol' },
        ]}
        className="[&>button]:min-w-[96px] [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12.5px]"
      />
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-[#0a0a0a] dark:text-white">{children}</h1>
      {sub && <div className="mt-1 text-[13.5px] leading-[21px] text-gray-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-baseline justify-between gap-2', className)}>
      <h2 className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white">{children}</h2>
      {right}
    </div>
  );
}

/** 170px-label definition list; stacks at phone width. */
export function DefList({ rows, labelWidth = 170 }: { rows: Array<{ label: string; value: ReactNode }>; labelWidth?: number }) {
  return (
    <dl className="flex flex-col gap-[18px]">
      {rows.map(r => (
        <div key={r.label} className="grid grid-cols-1 gap-1 sm:grid-cols-[var(--lw)_1fr] sm:gap-4"
          style={{ ['--lw' as any]: `${labelWidth}px` }}>
          <dt className="text-[12.5px] font-medium text-gray-500 dark:text-zinc-500">{r.label}</dt>
          <dd className="min-w-0 text-[13.5px] leading-[21px] text-[#374151] dark:text-zinc-200">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Hairline({ className }: { className?: string }) {
  return <div className={cn('h-px bg-[#ececea] dark:bg-[#1f1f1f]', className)} />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] text-gray-600 dark:text-zinc-400', className)}>{children}</span>;
}

/** Every reason is typed by the reviewer; there is no pre-filled justification. */
export function ReasonInput({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      autoFocus={autoFocus}
      rows={2}
      placeholder={placeholder ?? 'Reason (required) — what you checked and why'}
      className="w-full resize-y rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-600"
    />
  );
}

export function TextInput({ value, onChange, placeholder, className, type = 'text', ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; type?: string; ariaLabel?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      aria-label={ariaLabel}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn('h-[38px] w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-600', className)}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, className, ariaLabel, disabled }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; className?: string; ariaLabel?: string; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={e => onChange(e.target.value as T)}
      className={cn('h-[38px] max-w-full rounded-[8px] border border-[#e5e7eb] bg-white px-2 text-[13px] text-gray-900 focus:outline-none disabled:opacity-60 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100', className)}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Fixed-column tables scroll inside themselves; the page body never does. */
export function TableFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-[10px] border border-[#ececea] dark:border-[#1f1f1f]', className)}>
      {children}
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500', className)}>{children}</div>
  );
}

export const STATUS_TONE: Record<DerivedStatus['key'], 'blue' | 'indigo' | 'green' | 'neutral'> = {
  draft: 'neutral',
  ready: 'neutral',
  in_progress: 'blue',
  awaiting: 'indigo',
  finalized: 'green',
  needs_review: 'indigo',
};

export function StatusBadge({ status }: { status: DerivedStatus }) {
  return <StatusPill tone={STATUS_TONE[status.key]}>{status.label}</StatusPill>;
}

/** Small coloured text state (Eligible / Needs decision / Ready …). */
export function StateText({ tone, children }: { tone: 'green' | 'indigo' | 'amber' | 'gray' | 'red' | 'muted'; children: ReactNode }) {
  const cls = {
    green: 'text-[#047857] dark:text-emerald-400',
    indigo: 'text-[#4338ca] dark:text-indigo-300',
    amber: 'text-[#92400e] dark:text-amber-300',
    gray: 'text-[#9ca3af] dark:text-zinc-500',
    red: 'text-[#b91c1c] dark:text-red-400',
    muted: 'text-[#6b7280] dark:text-zinc-400',
  }[tone];
  return <span className={cn('text-[12.5px] font-medium', cls)}>{children}</span>;
}

export function Chip({ tone = 'gray', children, className }: { tone?: 'gray' | 'indigo' | 'amber' | 'green' | 'teal'; children: ReactNode; className?: string }) {
  const cls = {
    gray: 'bg-[#f3f4f6] text-[#374151] dark:bg-[#1f1f1f] dark:text-zinc-300',
    indigo: 'bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/40 dark:text-indigo-300',
    amber: 'bg-[#fef3c7] text-[#92400e] dark:bg-amber-500/15 dark:text-amber-300',
    green: 'bg-[#ecfdf5] text-[#047857] dark:bg-emerald-950/30 dark:text-emerald-300',
    teal: 'bg-[#e0f2ef] text-[#1d6b5e] dark:bg-teal-950/30 dark:text-teal-300',
  }[tone];
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold', cls, className)}>{children}</span>;
}

export function Collapsible({ title, open, onToggle, children, right }: {
  title: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; right?: ReactNode;
}) {
  return (
    <div className="border-t border-[#ececea] pt-3 dark:border-[#1f1f1f]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="flex items-center gap-2 text-left text-[13.5px] font-semibold text-[#0a0a0a] hover:text-gray-700 dark:text-white">
          <span className="w-3 text-gray-400">{open ? '▾' : '▸'}</span>{title}
        </button>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function EmptyPanel({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-[#fafafa] px-5 py-6 dark:bg-[#141414]">
      <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white">{title}</div>
      {children && <div className="mt-1 text-[13px] leading-[20px] text-gray-500 dark:text-zinc-400">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function when(at: string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function day(at: string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
