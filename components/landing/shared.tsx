import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Red editorial eyebrow label ("WORKFLOW", "RISK OF BIAS", …). */
export function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={cn('text-[11px] font-bold uppercase tracking-[0.15em] text-[#990000]', className)}
      style={style}
    >
      {children}
    </span>
  );
}

/** "Example data" chip every demo carries. */
export function ExampleChip({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span
      title="Illustrative review data, not a real study set"
      className={cn(
        'whitespace-nowrap rounded-[4px] border px-[7px] py-[2px] text-[11px] font-bold uppercase leading-[1.6] tracking-[0.08em]',
        dark ? 'border-white/[0.18] text-[#8fa3cf]' : 'border-[#e4e4e7] bg-white text-[#5a5a5a]',
        className,
      )}
    >
      Example data
    </span>
  );
}

/** 2px navy line across the top of every product window. */
export function NavyTopLine() {
  return <div className="h-[2px] bg-[#011F5B]" />;
}
