'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, FileText, ClipboardList, Scale, Layers, Loader2, Check, CircleDot, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Document, Form, ReviewAssignment } from '@/types/api';
import { ROLE_COLORS } from '@/lib/reviewerColors';

export type FormState = 'done' | 'partial' | 'todo';

interface MyQueueViewProps {
  assignments: ReviewAssignment[];
  documents: Document[];
  /** Project-wide study IDs — see ExtractionView. */
  docLabels: Record<string, string>;
  forms: Form[];
  // (docId, formId) → state for the *current* user, scoped by reviewer_role
  perDocFormStatus: Map<string, Map<string, FormState>>;
  loading: boolean;
  starting: boolean;
  startingKey: string | null; // `${docId}:${formId}` while opening
  onStartForm: (doc: Document, form: Form) => void;
  onBrowseAll: () => void;
  hasBrowseAll: boolean;
}

// Role hues come from lib/reviewerColors so R2 is the same purple here as on the
// consensus screen. It used to be emerald, which is also the app's "done" colour.
const ROLE_META: Record<string, { label: string; pill: string; icon: typeof ClipboardList; section: string }> = {
  reviewer_1:  { label: 'R1',  pill: ROLE_COLORS.reviewer_1.pill,  icon: ClipboardList, section: 'R1 work' },
  reviewer_2:  { label: 'R2',  pill: ROLE_COLORS.reviewer_2.pill,  icon: ClipboardList, section: 'R2 work' },
  adjudicator: { label: 'Adjudicator', pill: ROLE_COLORS.adjudicator.pill, icon: Scale, section: 'Adjudication waiting' },
};

const STATUS_PILL: Record<string, string> = {
  pending:     'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a]',
  in_progress: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  completed:   'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15',
  skipped:     'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
};

function FormsStrip({ total, done }: { total: number; done: number }) {
  if (total === 0) return <span className="text-[11px] text-gray-300 dark:text-zinc-700 italic">no forms</span>;
  if (total > 8) {
    const pct = Math.round((done / total) * 100);
    return (
      <span className="inline-flex items-center" aria-label={`${done} of ${total} forms`}>
        <span className="relative inline-block w-6 h-1.5 rounded-full bg-gray-200 dark:bg-[#2a2a2a] overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 bg-emerald-500 dark:bg-emerald-400 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`${done} of ${total} forms`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'inline-block w-1 h-3 rounded-[1px]',
            i < done ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-gray-200 dark:bg-[#2a2a2a]',
          )}
        />
      ))}
    </span>
  );
}

export function MyQueueView({
  assignments,
  documents,
  docLabels,
  forms,
  perDocFormStatus,
  loading,
  starting,
  startingKey,
  onStartForm,
  onBrowseAll,
  hasBrowseAll,
}: MyQueueViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'done'>('all');
  const [query, setQuery] = useState('');

  // Study IDs for the queue rows — sorting, search and display all use them,
  // so the list is alphabetical by study ("Black 2002" before "Chang 2004")
  // rather than by whatever the file happened to be called.

  const docById = useMemo(() => {
    const m = new Map<string, Document>();
    for (const d of documents) m.set(d.id, d);
    return m;
  }, [documents]);

  const grouped = useMemo(() => {
    const order: Array<keyof typeof ROLE_META> = ['reviewer_1', 'reviewer_2', 'adjudicator'];
    const out: Record<string, ReviewAssignment[]> = {};
    for (const r of order) out[r] = [];
    for (const a of assignments) {
      if (a.status === 'skipped') continue;
      const role = a.reviewer_role as keyof typeof ROLE_META;
      if (!out[role]) continue;
      out[role].push(a);
    }
    for (const r of order) {
      out[r].sort((x, y) => {
        // pending/in_progress before completed
        const rank = (s: string) => (s === 'completed' ? 1 : 0);
        if (rank(x.status) !== rank(y.status)) return rank(x.status) - rank(y.status);
        return (docLabels[x.document_id] ?? '').localeCompare(docLabels[y.document_id] ?? '');
      });
    }
    return out;
  }, [assignments, docById, docLabels]);

  const stats = useMemo(() => {
    let pending = 0, inProgress = 0, done = 0;
    for (const a of assignments) {
      if (a.status === 'skipped') continue;
      if (a.status === 'completed') done++;
      else if (a.status === 'in_progress') inProgress++;
      else pending++;
    }
    return { total: assignments.filter(a => a.status !== 'skipped').length, pending, inProgress, done };
  }, [assignments]);

  const filteredGrouped = useMemo(() => {
    const matchesStatus = (s: string) =>
      filter === 'all' ||
      (filter === 'pending' && s === 'pending') ||
      (filter === 'in_progress' && s === 'in_progress') ||
      (filter === 'done' && s === 'completed');
    const q = query.trim().toLowerCase();
    const out: Record<string, ReviewAssignment[]> = {};
    for (const role of Object.keys(grouped)) {
      out[role] = grouped[role].filter(a => {
        if (!matchesStatus(a.status)) return false;
        if (q && !(docLabels[a.document_id] ?? '').toLowerCase().includes(q)) return false;
        return true;
      });
    }
    return out;
  }, [grouped, filter, query, docById, docLabels]);

  const toggleExpand = (docId: string, role: string) => {
    const key = `${role}:${docId}`;
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-12 flex items-center justify-center text-gray-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading your queue…</span>
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <ClipboardList size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No work assigned to you yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Ask the project manager to allocate papers, or browse all docs below.</div>
        {hasBrowseAll && (
          <button
            onClick={onBrowseAll}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
          >
            <Layers size={12} />
            Browse all documents
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-[#1f1f1f] rounded-xl overflow-hidden">
        {([
          { label: 'Assigned',    value: stats.total,      color: 'text-gray-700 dark:text-zinc-300',           bar: 'bg-gray-400' },
          { label: 'Pending',     value: stats.pending,    color: 'text-blue-500 dark:text-blue-400',           bar: 'bg-blue-500' },
          { label: 'In progress', value: stats.inProgress, color: 'text-amber-500 dark:text-amber-400',         bar: 'bg-amber-500' },
          { label: 'Done',        value: stats.done,       color: 'text-emerald-600 dark:text-emerald-400',     bar: 'bg-emerald-500' },
        ] as { label: string; value: number; color: string; bar: string }[]).map(({ label, value, color, bar }) => {
          const hasValue = value > 0;
          return (
            <div key={label} className="relative flex flex-col items-start gap-1.5 px-6 py-5">
              <div className={cn('absolute inset-x-0 top-0 h-[3px]', hasValue ? bar : 'bg-transparent')} />
              <span className={cn('text-2xl font-bold tabular-nums leading-none', hasValue ? color : 'text-gray-300 dark:text-zinc-700')}>{value}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>

      {/* Filter + search */}
      {assignments.length > 4 && (
        <div className="flex items-center gap-2 py-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents..."
              className="h-8 pl-8 pr-3 text-xs rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-zinc-600 w-48"
            />
          </div>
          <div className="flex items-center gap-1">
            {([
              { key: 'all',         label: 'All',         count: stats.total },
              { key: 'pending',     label: 'Pending',     count: stats.pending },
              { key: 'in_progress', label: 'In progress', count: stats.inProgress },
              { key: 'done',        label: 'Done',        count: stats.done },
            ] as const).map(p => (
              <button
                key={p.key}
                onClick={() => setFilter(p.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  filter === p.key
                    ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900'
                    : 'bg-transparent text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a]',
                )}
              >
                {p.label} {p.count}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {(() => {
        const flat: Array<{ a: ReviewAssignment; role: keyof typeof ROLE_META }> = [];
        for (const role of ['reviewer_1', 'reviewer_2', 'adjudicator'] as const) {
          for (const a of filteredGrouped[role] ?? []) flat.push({ a, role });
        }
        const rankStatus = (s: string) => s === 'in_progress' ? 0 : s === 'pending' ? 1 : 2;
        flat.sort((x, y) => {
          const r = rankStatus(x.a.status) - rankStatus(y.a.status);
          if (r !== 0) return r;
          return (docLabels[x.a.document_id] ?? '').localeCompare(docLabels[y.a.document_id] ?? '');
        });

        return (
          <>
            <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
              {/* Header */}
              <div
                className="grid gap-3 px-5 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a]"
                style={{ gridTemplateColumns: '1fr 60px 130px 80px' }}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Document</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Role</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Status</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Action</span>
              </div>

              {flat.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-sm text-gray-400 dark:text-zinc-600">
                  No documents match this filter
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                  {flat.map(({ a, role }) => {
                    const doc = docById.get(a.document_id);
                    if (!doc) return null;
                    const key = `${role}:${a.document_id}`;
                    const isExpanded = expanded.has(key);
                    const meta = ROLE_META[role];
                    const formStatus = perDocFormStatus.get(a.document_id) ?? new Map<string, FormState>();
                    const formsTotal = a.forms_total ?? forms.length;
                    const formsDone = a.forms_completed ?? 0;
                    return (
                      <div key={key}>
                        <button
                          onClick={() => toggleExpand(a.document_id, role)}
                          className={cn(
                            'w-full grid gap-3 items-center px-5 py-3.5 text-left transition-colors hover:bg-gray-50/40 dark:hover:bg-[rgba(255,255,255,0.01)] border-l-2',
                            a.status === 'in_progress' ? 'border-amber-500' :
                            a.status === 'completed'   ? 'border-emerald-500' :
                            'border-transparent',
                          )}
                          style={{ gridTemplateColumns: '1fr 60px 130px 80px' }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
                            <span className="text-sm text-gray-800 dark:text-zinc-200 truncate" title={doc.filename}>{docLabels[doc.id] ?? doc.filename}</span>
                          </div>
                          <span className={cn('inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 w-fit', meta.pill)}>
                            {meta.label}
                          </span>
                          <span className={cn('inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 w-fit capitalize', STATUS_PILL[a.status] ?? STATUS_PILL.pending)}>
                            {a.status.replace('_', ' ')}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">
                            <span className="tabular-nums">{formsDone}/{formsTotal}</span>
                            <ChevronRight size={12} className={cn('text-gray-400 dark:text-zinc-600 transition-transform flex-shrink-0', isExpanded && 'rotate-90')} />
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50/60 dark:bg-[#0d0d0d] px-5 py-3">
                            {forms.length === 0 ? (
                              <div className="text-xs text-gray-400 dark:text-zinc-500 italic py-2">No active forms in this project.</div>
                            ) : (
                              <div className="space-y-1">
                                {forms.map(f => {
                                  const state: FormState = formStatus.get(f.id) ?? 'todo';
                                  const k = `${a.document_id}:${f.id}`;
                                  const isStarting = starting && startingKey === k;
                                  return (
                                    <button
                                      key={f.id}
                                      disabled={starting}
                                      onClick={(e) => { e.stopPropagation(); onStartForm(doc, f); }}
                                      className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-60 disabled:cursor-wait text-left"
                                    >
                                      {state === 'done' ? (
                                        <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-400/15 flex items-center justify-center shrink-0">
                                          <Check size={10} className="text-emerald-600 dark:text-emerald-400" />
                                        </span>
                                      ) : state === 'partial' ? (
                                        <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                                          <CircleDot size={10} className="text-blue-600 dark:text-blue-400" />
                                        </span>
                                      ) : (
                                        <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-[#2a2a2a] shrink-0" />
                                      )}
                                      <span className="text-sm text-gray-700 dark:text-zinc-300 truncate flex-1 min-w-0">{f.form_name}</span>
                                      {state !== 'todo' && (
                                        <span className={cn(
                                          'text-[10px] font-semibold uppercase tracking-wide',
                                          state === 'done'    && 'text-emerald-600 dark:text-emerald-400',
                                          state === 'partial' && 'text-blue-600 dark:text-blue-400',
                                        )}>
                                          {state === 'done' ? 'Saved' : 'Partial'}
                                        </span>
                                      )}
                                      <span className="text-xs font-medium text-gray-400 dark:text-zinc-600 group-hover:text-gray-700 dark:group-hover:text-zinc-300 transition-colors shrink-0">
                                        {isStarting ? <Loader2 size={12} className="animate-spin" /> : '→'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {hasBrowseAll && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={onBrowseAll}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors"
                >
                  <Layers size={12} />
                  Browse all documents
                </button>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
