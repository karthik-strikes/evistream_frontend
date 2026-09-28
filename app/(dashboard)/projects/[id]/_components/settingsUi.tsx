'use client';

/**
 * Shared pieces for Project settings — tokens and small primitives lifted from
 * the handoff (zhandoffs/EviStreams Project Settings.dc.html). Dark variants
 * follow robUi's convention (#111111 cards, #1f1f1f borders, zinc text).
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ── Buttons (36px in-card, 38px header) ──────────────────────────────────────

export const btnPrimary =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white no-underline hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#0a0a0a] dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white';
export const btnOutline =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-[#0a0a0a] no-underline hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]';
export const btnDanger =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-[#f9c4cd] bg-white px-3.5 text-[13px] font-medium text-[#c22d47] hover:bg-[#fef1f3] dark:border-rose-900 dark:bg-[#111111] dark:text-rose-300 dark:hover:bg-rose-950/30';
export const linkBtn =
  'border-0 bg-transparent p-0 text-[13px] font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100';
export const inputCls =
  'box-border h-[38px] w-full rounded-[7px] border border-gray-200 bg-white px-3 text-[13px] text-[#0a0a0a] outline-none focus:border-[#0a0a0a] disabled:bg-[#f9fafb] disabled:text-gray-500 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:focus:border-zinc-300 dark:disabled:bg-[#0d0d0d] dark:disabled:text-zinc-500';

// ── Cards ────────────────────────────────────────────────────────────────────

export function SettingsCard({ id, title, count, sub, action, right, tone, children }: {
  id: string; title: string; count?: ReactNode; sub?: ReactNode; action?: ReactNode; right?: ReactNode;
  tone?: 'danger'; children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}
      className={cn('rounded-xl border bg-white dark:bg-[#111111]',
        tone === 'danger' ? 'border-[#f9c4cd] dark:border-rose-900/60' : 'border-gray-200 dark:border-[#1f1f1f]')}>
      <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5',
        tone === 'danger' ? 'border-[#fde8ec] dark:border-rose-950/60' : 'border-gray-100 dark:border-[#1f1f1f]')}>
        <div className="min-w-0">
          <h2 id={id} className="m-0 text-[16px] font-semibold leading-6 text-[#0a0a0a] dark:text-zinc-100">
            {title}
            {count !== undefined && count !== null && (
              <span className="ml-1.5 text-[13px] font-medium text-gray-500 dark:text-zinc-400">{count}</span>
            )}
          </h2>
          {sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-zinc-400">{sub}</p>}
        </div>
        {right}
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Pills ────────────────────────────────────────────────────────────────────

/** Role pills — from navbar.tsx ROLE_BADGE_STYLES. */
const ROLE_PILL: Record<string, string> = {
  owner: 'bg-[#fef3c7] text-[#b45309] dark:bg-amber-400/15 dark:text-amber-300',
  manager: 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-blue-400/15 dark:text-blue-300',
  member: 'bg-[#f3f4f6] text-[#4b5563] dark:bg-zinc-700/40 dark:text-zinc-300',
  viewer: 'bg-[#dcfce7] text-[#15803d] dark:bg-emerald-400/15 dark:text-emerald-300',
  admin: 'bg-[#f3f4f6] text-[#0a0a0a] dark:bg-zinc-700/40 dark:text-zinc-100',
};
export const ROLE_NAME: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer', admin: 'Admin',
};

export function RolePill({ role }: { role: string | null | undefined }) {
  const r = role || 'member';
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-[.06em]', ROLE_PILL[r] ?? ROLE_PILL.member)}>
      {ROLE_NAME[r] ?? r}
    </span>
  );
}

export function StatePill({ kind }: { kind: 'current' | 'not_current' | 'archived' }) {
  const cls = {
    current: 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900',
    not_current: 'border-gray-200 bg-white text-gray-500 dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-400',
    archived: 'border-gray-200 bg-gray-100 text-gray-500 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400',
  }[kind];
  const label = { current: 'Current', not_current: 'Not current', archived: 'Archived · read-only' }[kind];
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-[6px] border px-2 py-px text-[11px] font-medium', cls)}>
      {label}
    </span>
  );
}

// ── Confirm dialog (focus trap, Esc, focus return) ───────────────────────────

export function ConfirmDialog({ open, title, description, confirmLabel, danger, typeToConfirm, busy,
  typed, onTyped, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; danger?: boolean;
  typeToConfirm?: string; busy?: boolean; typed: string; onTyped: (v: string) => void;
  onCancel: () => void; onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) setTimeout(() => cancelRef.current?.focus(), 0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;

  const ok = !typeToConfirm || typed.trim() === typeToConfirm;
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, input')).filter(el => !(el as HTMLButtonElement).disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,10,10,.35)] p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc"
        onClick={e => e.stopPropagation()} onKeyDown={trap}
        className="flex w-full max-w-[440px] flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,.15)] dark:border-[#2a2a2a] dark:bg-[#141414]">
        <h2 id="confirm-title" className="m-0 text-[16px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{title}</h2>
        <p id="confirm-desc" className="m-0 text-[13px] leading-[18px] text-gray-600 dark:text-zinc-400">{description}</p>
        {typeToConfirm && (
          <>
            <label htmlFor="confirm-type" className="mb-1.5 mt-1 block text-[12px] font-medium text-gray-700 dark:text-zinc-300">
              Type the project name to confirm
            </label>
            <input id="confirm-type" type="text" value={typed} onChange={e => onTyped(e.target.value)}
              placeholder={typeToConfirm} className={inputCls} />
          </>
        )}
        <div className="mt-1.5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={btnOutline}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={!ok || busy}
            className={cn(btnPrimary, danger && 'bg-[#c22d47] hover:bg-[#a8233b] disabled:hover:bg-[#c22d47] dark:bg-[#c22d47] dark:text-white dark:hover:bg-[#a8233b]')}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
