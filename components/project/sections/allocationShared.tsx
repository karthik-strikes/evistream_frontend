'use client';

/**
 * Pieces shared by the allocation screens — the set-up flow, the by-reviewer
 * list and the by-paper grid.
 *
 * All three used to carry private copies of the same avatar, initials and
 * role-pill code, which is how R1 ended up blue on one screen and orange on the
 * next. Role colours come from `lib/reviewerColors` and are never re-picked
 * here; avatars go through the shared `Avatar` so a reviewer keeps one colour
 * app-wide.
 */

import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { ROLE_COLORS } from '@/lib/reviewerColors';
import type { ProjectMember } from '@/types/api';

// ─── Roles ────────────────────────────────────────────────────────────────────

export type ReviewerRoleKey = 'reviewer_1' | 'reviewer_2' | 'adjudicator';

export interface RoleDef {
  key: ReviewerRoleKey;
  /** Dense tag for pills and column heads. */
  tag: string;
  /** Full name, for headings and prose. */
  name: string;
  /** Column head in the by-paper grid. */
  column: string;
  /** What the job is, in a reviewer's words. */
  desc: string;
  pill: string;
  /** Label colour on its own, for a column head with no pill behind it. */
  text: string;
  dot: string;
  /**
   * The `project_members` flag the assignee needs. The backend refuses the
   * whole payload when one person lacks it (`_validate_assignee_capabilities`),
   * so the pickers grey those people out instead of letting the save fail.
   */
  requires: 'can_run_manual_extractions' | 'can_adjudicate';
  /** Plain-English form of `requires`, for the "can't take this role" note. */
  blockedHint: string;
}

export const ROLE_DEFS: RoleDef[] = [
  {
    key: 'reviewer_1', tag: 'R1', name: 'Reviewer 1', column: 'Reviewer 1',
    desc: 'Reads each paper first, independently.',
    pill: ROLE_COLORS.reviewer_1.pill, text: ROLE_COLORS.reviewer_1.text, dot: ROLE_COLORS.reviewer_1.dot,
    requires: 'can_run_manual_extractions',
    blockedHint: 'are not allowed to fill in review forms on this project',
  },
  {
    key: 'reviewer_2', tag: 'R2', name: 'Reviewer 2', column: 'Reviewer 2',
    desc: 'Reads the same papers again, without seeing the first reader’s answers.',
    pill: ROLE_COLORS.reviewer_2.pill, text: ROLE_COLORS.reviewer_2.text, dot: ROLE_COLORS.reviewer_2.dot,
    requires: 'can_run_manual_extractions',
    blockedHint: 'are not allowed to fill in review forms on this project',
  },
  {
    key: 'adjudicator', tag: 'Cons', name: 'Consensus reviewer', column: 'Consensus',
    desc: 'Settles any disagreement between the two readers.',
    pill: ROLE_COLORS.adjudicator.pill, text: ROLE_COLORS.adjudicator.text, dot: ROLE_COLORS.adjudicator.dot,
    requires: 'can_adjudicate',
    blockedHint: 'are not allowed to settle disagreements on this project',
  },
];

export const ROLE_BY_KEY: Record<ReviewerRoleKey, RoleDef> =
  ROLE_DEFS.reduce((acc, r) => { acc[r.key] = r; return acc; }, {} as Record<ReviewerRoleKey, RoleDef>);

/**
 * Can this member hold this role? Owners bypass every flag, and an unknown
 * member (someone who kept assignments after being removed, or the legacy
 * project owner who has no `project_members` row) is left to the backend rather
 * than blocked here.
 */
export function canTakeRole(member: ProjectMember | undefined, role: ReviewerRoleKey): boolean {
  if (!member) return true;
  if (member.role === 'owner') return true;
  return !!member[ROLE_BY_KEY[role].requires];
}

export function memberDisplayName(m?: ProjectMember | null): string {
  return m?.full_name || m?.email || 'Unknown';
}

/**
 * First name only — the by-paper grid gives a reviewer cell ~110px. A member
 * with no full name falls back to their email, which has no space to split on,
 * so take the part before the @ (and before any +tag) instead of rendering
 * "evistreams+demo@exam…".
 */
export function firstName(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Unknown';
  if (trimmed.includes('@') && !trimmed.includes(' ')) {
    return trimmed.split('@')[0].split('+')[0] || trimmed;
  }
  return trimmed.split(/\s+/)[0];
}

// ─── Statuses ─────────────────────────────────────────────────────────────────

export type StatusKey = 'pending' | 'in_progress' | 'completed' | 'skipped';
/** A paper with a role still empty is not "pending" — nobody can start it. */
export type PaperStatusKey = StatusKey | 'unassigned';

/** What the shared status segmented control is set to. */
export type StatusFilter = 'all' | PaperStatusKey;

export const STATUS_LABEL: Record<PaperStatusKey, string> = {
  completed:   'Completed',
  in_progress: 'In progress',
  pending:     'Pending',
  skipped:     'Skipped',
  unassigned:  'Needs reviewers',
};

const STATUS_PILL: Record<PaperStatusKey, string> = {
  completed:   'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15',
  in_progress: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  pending:     'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-400/15',
  skipped:     'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
  unassigned:  'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
};

export function StatusPill({ status }: { status: PaperStatusKey }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap',
      STATUS_PILL[status] ?? STATUS_PILL.pending,
    )}>
      <span className="w-[5px] h-[5px] rounded-full bg-current" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── Small controls ───────────────────────────────────────────────────────────

export function RolePill({ role, className }: { role: ReviewerRoleKey; className?: string }) {
  const def = ROLE_BY_KEY[role];
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      def.pill, className,
    )}>
      {def.tag}
    </span>
  );
}

export function SegGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5 gap-0.5',
      className,
    )}>
      {children}
    </div>
  );
}

export function SegButton({
  active, onClick, children, disabled, title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all whitespace-nowrap',
        active
          ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A reviewer's avatar. `email` is what the shared `Avatar` hashes, so pass it
 * whenever the member is known — hashing the user id instead gives the same
 * person a different colour on a screen that happens to lack the email.
 */
export function ReviewerAvatar({
  userId, name, email, size = 'sm',
}: {
  userId: string;
  name?: string | null;
  email?: string | null;
  size?: 'xs' | 'sm' | 'md';
}) {
  return <Avatar email={email || userId} name={name ?? null} size={size} />;
}

/** Four hairline-divided tiles. Same shape as the stat rows on /results. */
export function StatTiles({ tiles }: {
  tiles: { label: string; value: React.ReactNode; sub: string; tone?: 'emerald' | 'blue' | 'amber' }[];
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-100 dark:bg-[#1f1f1f] rounded-xl overflow-hidden border border-gray-100 dark:border-[#1f1f1f]">
      {tiles.map(t => (
        <div key={t.label} className="bg-white dark:bg-[#111111] px-4 py-3.5">
          <p className="text-[11.5px] text-gray-400 dark:text-zinc-500">{t.label}</p>
          <p className={cn(
            'text-2xl font-bold tracking-tight tabular-nums mt-0.5',
            t.tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
            t.tone === 'blue'    ? 'text-blue-600 dark:text-blue-400'       :
            t.tone === 'amber'   ? 'text-amber-500'                          :
            'text-gray-900 dark:text-white',
          )}>
            {t.value}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-zinc-600">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}
