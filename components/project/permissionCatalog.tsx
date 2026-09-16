'use client';

/**
 * Single source of truth for the member-permission UI.
 *
 * The permission KEYS here mirror the boolean columns on `project_members`
 * exactly — nothing is invented client-side. Only the seven that are grantable
 * from the project UI are listed; `can_manage_members`, `can_manage_assignments`
 * and `can_qa_review` stay out on purpose (they are role-driven today), which is
 * the same set the previous checkbox grid rendered.
 *
 * Both surfaces that edit permissions — the Members access drawer and the invite
 * modal — render from this file, so the two can never drift apart again.
 *
 * Styling follows the app's own tokens, not a mockup's: white / #111111 cards,
 * hairline gray borders, rounded-xl, no shadow, and a monochrome ON state
 * (`bg-gray-900 dark:bg-zinc-100`) — the same token the pills, primary buttons
 * and progress bars use on /results. Colour is reserved for meaning elsewhere.
 */

import type { LucideIcon } from 'lucide-react';
import {
  FileText, Upload, FileCheck, PlayCircle, Edit,
  BarChart3, CheckSquare2, FolderOpen, Layers, ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionKey =
  | 'can_view_docs'
  | 'can_upload_docs'
  | 'can_create_forms'
  | 'can_run_extractions'
  | 'can_run_manual_extractions'
  | 'can_view_results'
  | 'can_adjudicate';

export interface PermissionItem {
  key: PermissionKey;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface PermissionGroup {
  id: string;
  title: string;
  caption: string;
  icon: LucideIcon;
  items: PermissionItem[];
}

// Shared micro-label token — matches app/(dashboard)/results/page.tsx:170.
export const MICRO_LABEL =
  'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600';

// ── Catalogue ────────────────────────────────────────────────────────────────

// Each permission carries the SAME icon the sidebar uses for the screen it
// unlocks (components/layout/sidebar.tsx:56-68) — Documents=FileText,
// Forms=FileCheck, Run Extraction=PlayCircle, Manual Extract=Edit,
// Consensus=CheckSquare2, Results=BarChart3. Granting "Run AI extractions"
// then shows the reader exactly the nav item it turns on, instead of a
// decorative icon nothing else in the app uses.
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'documents',
    title: 'Documents',
    caption: 'Corpus and study records',
    icon: FolderOpen,
    items: [
      {
        key: 'can_view_docs',
        label: 'View documents',
        description: 'Open PDFs and study records in this project.',
        icon: FileText,
      },
      {
        key: 'can_upload_docs',
        label: 'Upload documents',
        description: 'Add PDFs or imported references to the corpus.',
        icon: Upload,
      },
    ],
  },
  {
    id: 'extraction',
    title: 'Forms & extraction',
    caption: 'Build schemas and run the work',
    icon: Layers,
    items: [
      {
        key: 'can_create_forms',
        label: 'Create forms',
        description: 'Build and edit extraction forms and their fields.',
        icon: FileCheck,
      },
      {
        key: 'can_run_extractions',
        label: 'Run AI extractions',
        description: 'Start model-based extraction jobs across documents.',
        icon: PlayCircle,
      },
      {
        key: 'can_run_manual_extractions',
        label: 'Run manual extractions',
        description: 'Enter reviewer data by hand as R1 or R2.',
        icon: Edit,
      },
    ],
  },
  {
    id: 'review',
    title: 'Review & results',
    caption: 'Verification and adjudication',
    icon: ClipboardCheck,
    items: [
      {
        key: 'can_view_results',
        label: 'View results',
        description: 'See extraction results allowed by the project privacy rules.',
        icon: BarChart3,
      },
      {
        key: 'can_adjudicate',
        label: 'Consensus & adjudication',
        description: 'Resolve disagreements between reviewers and sign off.',
        icon: CheckSquare2,
      },
    ],
  },
];

/** Flat list of the grantable keys, in display order. */
export const PERMISSION_KEYS: PermissionKey[] =
  PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key));

export const PERMISSION_LABELS: Record<PermissionKey, string> =
  Object.fromEntries(
    PERMISSION_GROUPS.flatMap(g => g.items.map(i => [i.key, i.label])),
  ) as Record<PermissionKey, string>;

/** How many of the grantable permissions a record currently holds. */
export function grantedCount(source: Partial<Record<PermissionKey, boolean | undefined>>): number {
  return PERMISSION_KEYS.filter(k => !!source[k]).length;
}

// ── Switch ───────────────────────────────────────────────────────────────────

export function PermissionSwitch({
  checked, onChange, disabled, label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-zinc-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-gray-900 dark:bg-zinc-100' : 'bg-gray-200 dark:bg-[#2a2a2a]',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-transform',
          // The dark ON track is near-white, so the knob has to invert with it.
          checked ? 'bg-white dark:bg-[#111111]' : 'bg-white',
        )}
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

// ── Grouped permission list ──────────────────────────────────────────────────

export function PermissionGroupList({
  value, onChange, disabled, className,
}: {
  value: Partial<Record<PermissionKey, boolean | undefined>>;
  onChange: (key: PermissionKey, next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {PERMISSION_GROUPS.map(group => {
        const GroupIcon = group.icon;
        const on = group.items.filter(i => !!value[i.key]).length;
        return (
          <section
            key={group.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]"
          >
            {/* Group header */}
            <header className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-3.5 py-2.5 dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-400">
                  <GroupIcon size={13} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-tight text-gray-800 dark:text-zinc-200">
                    {group.title}
                  </p>
                  <p className="truncate text-[11px] text-gray-400 dark:text-zinc-600">
                    {group.caption}
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-400 dark:text-zinc-600">
                {on}/{group.items.length}
              </span>
            </header>

            {/* Permissions */}
            {group.items.map((item, i) => {
              const ItemIcon = item.icon;
              const checked = !!value[item.key];
              return (
                <div
                  key={item.key}
                  className={cn(
                    'flex items-center justify-between gap-4 px-3.5 py-3 transition-colors',
                    i > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]',
                    !disabled && 'hover:bg-gray-50 dark:hover:bg-[#0d0d0d]',
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    {/* Bare icon, no tile. The tiles made a column of gray squares
                        that read as inconsistent, and the off-state tile sat at
                        text-gray-300 — faint enough to look like a render bug. */}
                    <ItemIcon
                      size={15}
                      className={cn(
                        'mt-0.5 shrink-0 transition-colors',
                        checked
                          ? 'text-gray-600 dark:text-zinc-300'
                          : 'text-gray-400 dark:text-zinc-600',
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-700 dark:text-zinc-200">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400 dark:text-zinc-500">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <PermissionSwitch
                    checked={checked}
                    disabled={disabled}
                    label={item.label}
                    onChange={next => onChange(item.key, next)}
                  />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
