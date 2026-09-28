'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

export interface QuickAction { label: string; href: string; color: string }

/** One menu, capability-filtered by the caller. Keyboard per the handoff:
 *  open focuses the first item, ↑/↓ cycle, Home/End, Tab and Esc close (Esc
 *  returns focus to the trigger), outside click closes. */
export function QuickActions({ heading, items }: { heading: string; items: QuickAction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!items.length) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => els[(n + els.length) % els.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focus(0); }
    else if (e.key === 'End') { e.preventDefault(); focus(els.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="relative flex-none">
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="inline-flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-[#0a0a0a] hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]">
        Quick actions <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Quick actions" onKeyDown={onKey}
          className="absolute right-0 top-11 z-30 flex w-60 flex-col rounded-lg border border-gray-200 bg-white p-1 shadow-[0_12px_40px_rgba(0,0,0,.1)] dark:border-[#2a2a2a] dark:bg-[#141414]">
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-400 dark:text-zinc-500">{heading}</div>
          {items.map(m => (
            <button key={m.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); router.push(m.href); }}
              className="flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-[#0a0a0a] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-zinc-100 dark:hover:bg-[#1f1f1f] dark:focus:bg-[#1f1f1f]">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: m.color }} />
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
