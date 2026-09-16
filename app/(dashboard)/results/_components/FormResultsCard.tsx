'use client';

import { ChevronDown, ArrowRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Person } from '@/hooks/useProjectPeople';
import type { FormActivityEntry } from '@/types/api';
import { AvatarStack, CompletionBadge, PersonChip, RoleTag, TimeAgo } from './ResultsPeople';
import { describeActivity } from './activityCopy';

export interface FormContribution {
  person: Person;
  role: string | null;
  /** Audit entries attributed to this person on this form. */
  edits: number;
}

export interface FormCardData {
  formId: string;
  displayName: string;
  /** Documents the project holds, for the "N papers" line. */
  papers: number | null;
  runs: number;
  /** Newest of: this form's last run, and its last human edit. */
  lastActivityAt: string | null;
  /** Document coverage, 0-100, or null when unknown. */
  pct: number | null;
  /** Papers this form has a result for, out of the project's papers. The bar's
   *  numerator and denominator, spelled out — see the label note below. */
  papersExtracted: number | null;
  /**
   * Tri-state, and it has to be: `null` means no manual row is visible for this
   * form, which is not the same as finished. Treating "no rows" as `false`
   * labelled a form with nothing in it "Complete" — caught on the live Demo
   * project, where one form's legacy rows carry no author.
   */
  completion: 'complete' | 'progress' | null;
  contributors: Person[];
  contributions: FormContribution[];
  events: FormActivityEntry[];
}

/** How many events an expanded card shows before it stops. */
const EVENT_LIMIT = 6;

/**
 * One form's results, with the people who produced them.
 *
 * The card the picker already had, plus the three things the design adds: who
 * worked on it, whether it is finished, and what changed recently. The activity
 * section is collapsed by default and opens itself when a filter is on —
 * filtering for a person and then having to click four cards to find their work
 * defeats the filter.
 *
 * Not a `<button>`, though the old picker card was: this one contains two
 * independent controls (open the form, expand the activity) and nesting
 * buttons is invalid HTML that swallows the inner click.
 */
export function FormResultsCard({
  data,
  expanded,
  onToggle,
  onOpen,
  onOpenPerson,
  showPeople,
}: {
  data: FormCardData;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Open this form showing only one person's answers. Every line in the
   *  activity list names somebody, so that is what clicking one should do —
   *  before this, the lines were plain text and `Open` showed everyone. */
  onOpenPerson: (userId: string) => void;
  /** False on the AI tab: a model run has no contributor stack. */
  showPeople: boolean;
}) {
  const { pct } = data;
  const hasDetail = showPeople && (data.contributions.length > 0 || data.events.length > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white transition-colors hover:border-gray-300 dark:border-[#1f1f1f] dark:bg-[#111111] dark:hover:border-[#2a2a2a]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-[22px] py-4">
        <button
          type="button"
          onClick={hasDetail ? onToggle : onOpen}
          className="min-w-0 flex-1 cursor-pointer text-left"
          aria-expanded={hasDetail ? expanded : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {data.displayName}
            </span>
            {showPeople && data.completion && (
              <CompletionBadge completion={data.completion} />
            )}
            {hasDetail && (
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform dark:text-zinc-600',
                  expanded && 'rotate-180',
                )}
              />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-zinc-500">
            {data.papers != null && data.papers > 0 && (
              <span className="whitespace-nowrap">{data.papers} papers</span>
            )}
            <span className="whitespace-nowrap">{data.runs === 1 ? '1 run' : `${data.runs} runs`}</span>
            {data.lastActivityAt && (
              <span className="whitespace-nowrap">
                Last activity <TimeAgo at={data.lastActivityAt} />
              </span>
            )}
          </div>
        </button>

        {showPeople && data.contributors.length > 0 && (
          <AvatarStack people={data.contributors} size="sm" />
        )}

        {pct !== null && (
          <div className="flex w-[150px] flex-none flex-col items-end gap-1.5">
            {/*
              On the Manual tab this says "2/2 papers", not "100% complete".
              The word was actively misleading: this bar counts papers that have
              a result for THIS form, while Allocations' "0/2 done" counts
              papers whose reviewer has finished ALL of their forms. Both are
              right, and on the live calibration project they read 100% and 0%
              for the same person at the same moment. Only the AI tab keeps the
              percentage, where there is no reviewer progress to confuse it with.
            */}
            <span
              className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-gray-500 dark:text-zinc-400"
              title={showPeople
                ? 'Papers with a result for this form. Not the same as a reviewer finishing a paper — that needs every form, and Allocations counts it.'
                : 'Papers this form has been run over.'}
            >
              {showPeople && data.papersExtracted != null && data.papers != null
                ? `${data.papersExtracted}/${data.papers} papers`
                : `${pct}% complete`}
            </span>
            <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#1f1f1f]">
              {/* Green only past 80%, the threshold the rest of the app uses. */}
              <div
                className={cn('h-full rounded-full', pct >= 80 ? 'bg-green-500' : 'bg-gray-900 dark:bg-zinc-300')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-[#1f1f1f] dark:bg-[#111111] dark:text-zinc-400 dark:hover:border-[#2a2a2a] dark:hover:bg-[#1a1a1a]"
        >
          Open <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {hasDetail && expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-[22px] py-4 dark:border-[#1a1a1a] dark:bg-[#0d0d0d]">
          {data.contributions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {data.contributions.map(c => (
                <PersonChip
                  key={c.person.userId}
                  person={c.person}
                  role={c.role}
                  count={c.edits > 0 ? c.edits : undefined}
                  onClick={() => onOpenPerson(c.person.userId)}
                />
              ))}
            </div>
          )}
          {data.events.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 dark:text-zinc-500">
              No edits recorded yet for this form.
            </p>
          ) : (
            <div className="flex flex-col">
              {data.events.slice(0, EVENT_LIMIT).map(e => (
                <ActivityRow key={e.id} entry={e} onOpen={() => onOpenPerson(e.user_id)} />
              ))}
              {data.events.length > EVENT_LIMIT && (
                <p className="border-t border-gray-100 pt-2.5 text-[11px] text-gray-400 dark:border-[#1a1a1a] dark:text-zinc-500">
                  {data.events.length - EVENT_LIMIT} earlier{' '}
                  {data.events.length - EVENT_LIMIT === 1 ? 'edit' : 'edits'} — click any line to
                  open that person&apos;s answers and every cell&apos;s history.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry, onOpen }: { entry: FormActivityEntry; onOpen: () => void }) {
  const copy = describeActivity(entry);
  const name = entry.user_name || entry.user_email || 'Someone';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open this form showing only ${name}'s answers`}
      className="flex w-full cursor-pointer items-start gap-2.5 border-t border-gray-100 py-2.5 text-left text-xs transition-colors first:border-t-0 hover:bg-white dark:border-[#1a1a1a] dark:hover:bg-[#141414]">
      <Avatar
        email={entry.user_email || entry.user_id}
        name={entry.user_name}
        size="xs"
        className="mt-px"
      />
      <div className="min-w-0 flex-1">
        <p className="text-gray-600 dark:text-zinc-400">
          <span className="font-semibold text-gray-900 dark:text-white">{name}</span>{' '}
          {copy.summary}
          {entry.study_label && (
            <span className="text-gray-400 dark:text-zinc-500"> · {entry.study_label}</span>
          )}
        </p>
        {copy.diff && (
          <p className="mt-0.5 font-mono text-[11px]">
            {copy.diff.from && (
              <span className="text-gray-400 line-through dark:text-zinc-500">{copy.diff.from}</span>
            )}
            {copy.diff.from && copy.diff.to && <span className="mx-1 text-gray-300 dark:text-zinc-600">→</span>}
            {copy.diff.to && <span className="text-gray-700 dark:text-zinc-300">{copy.diff.to}</span>}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {copy.isDraft && (
          <span
            title="Saved as a draft — an autosave, not a submitted answer"
            className="rounded bg-gray-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-zinc-700/40 dark:text-zinc-400"
          >
            Draft
          </span>
        )}
        <RoleTag role={entry.reviewer_role} />
        <TimeAgo at={entry.created_at} className="text-[11px] text-gray-400 dark:text-zinc-500" />
      </div>
    </button>
  );
}
