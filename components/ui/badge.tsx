import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge variants are named for INTENT, not colour.
 *
 * The rule, and the only rule:
 *   colour encodes required human action. Nothing else earns colour.
 *
 *   - a person must decide (accept / attach / choose)  → attention
 *   - a person must retry or remove                    → critical
 *   - the system is working on it                      → active
 *   - anything else: provenance, identity, user
 *     vocabulary, transient states, "done"             → neutral
 *
 * If a new state seems to need a sixth colour, it doesn't — it's one of the
 * four above, or it shouldn't be a badge. `positive` exists for genuinely
 * affirmative states elsewhere in the app; it is deliberately NOT used on
 * document rows, where "done" is the boring majority and should stay quiet.
 *
 * The colour-named variants below (`blue`, `success`, `warning`, …) are kept
 * as ALIASES so existing call sites keep working. Don't add more; reach for an
 * intent name. Note `Badge` is sometimes given a variant computed at runtime
 * (e.g. forms/page.tsx maps FormStatus → variant), so every historical key has
 * to stay present or it silently falls back to `default`.
 *
 * Every variant carries a border. Without one, a filled dark chip
 * (`dark:bg-[#1a1a1a]`) sits a single step off the row background
 * (`dark:bg-[#111111]`) and reads as a smudge rather than a chip. The dark
 * fills use the `<colour>-500/10` pattern — over #111111 that computes to a
 * visible tint, unlike the `-900/30` fills it replaces.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors',
  {
    variants: {
      variant: {
        // ── intent names ────────────────────────────────────────────────
        neutral:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        attention:
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300',
        critical:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300',
        active:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-300',
        positive:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-300',

        // ── aliases, mapped onto the five above ─────────────────────────
        default:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        secondary:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        draft:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        pending:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        info:
          'border-gray-200 bg-transparent text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-400',
        blue:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-300',
        processing:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-300',
        warning:
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300',
        error:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300',
        failed:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300',
        success:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-300',
        completed:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
