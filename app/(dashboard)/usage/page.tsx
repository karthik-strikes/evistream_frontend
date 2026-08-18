'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import {
  Card, CardHeader, CardTitle, CardContent,
  Badge, EmptyState, Spinner,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui';
import { DollarSign, Hash, Database, AlertCircle, Inbox, Sparkles, Clock, FolderKanban, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { cn, formatModelName } from '@/lib/utils';
import { typography } from '@/lib/typography';
import { usageService, type UsageBreakdownRow, type UsageByRunRow, type UsageByProjectRow, type UsageCallRow } from '@/services/usage.service';

type GroupBy = 'model' | 'source' | 'day' | 'schema';

const RANGES = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

export default function UsagePage() {
  const [days, setDays] = useState(30);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['usage', 'summary', days],
    queryFn: () => usageService.getSummary(days),
  });

  const { data: byModel } = useQuery({
    queryKey: ['usage', 'breakdown', 'model', days],
    queryFn: () => usageService.getBreakdown('model', days),
  });

  const { data: bySource } = useQuery({
    queryKey: ['usage', 'breakdown', 'source', days],
    queryFn: () => usageService.getBreakdown('source', days),
  });

  const { data: byRun } = useQuery({
    queryKey: ['usage', 'by-run', days],
    queryFn: () => usageService.getByRuns(days),
  });

  const { data: byProject } = useQuery({
    queryKey: ['usage', 'by-project', days],
    queryFn: () => usageService.getByProject({ days }),
  });

  const totalCost = summary?.total_cost_usd ?? 0;
  const totalTokens = summary?.total_tokens ?? 0;
  const cacheHit = summary?.cache_hit_rate_pct ?? 0;
  const cacheSavings = summary?.cache_savings_usd ?? 0;
  const cacheRead = summary?.total_cache_read_input_tokens ?? 0;
  const cacheWrite = summary?.total_cache_creation_input_tokens ?? 0;
  const unpriced = summary?.unpriced_calls ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={cn(typography.heading.h1, 'dark:text-white')}>LLM Usage</h1>
            <p className={cn(typography.meta.large, 'mt-1')}>
              Token spend and cost across extraction and code generation
            </p>
          </div>
          <div className="flex gap-1 rounded-md border border-gray-200 dark:border-[#2a2a2a] p-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setDays(r.value)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-colors',
                  days === r.value
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {summaryLoading ? (
          <div className="flex h-64 items-center justify-center"><Spinner /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <StatCard
                icon={<DollarSign className="h-4 w-4" />}
                label="Total spend"
                value={`$${totalCost.toFixed(2)}`}
                hint={`${summary?.total_calls.toLocaleString() ?? 0} calls`}
              />
              <StatCard
                icon={<Hash className="h-4 w-4" />}
                label="Total tokens"
                value={formatTokens(totalTokens)}
                hint={`${formatTokens(summary?.total_prompt_tokens ?? 0)} in · ${formatTokens(summary?.total_completion_tokens ?? 0)} out`}
              />
              <StatCard
                icon={<Sparkles className="h-4 w-4" />}
                label="Cache savings"
                value={`$${cacheSavings.toFixed(2)}`}
                hint="vs uncached pricing"
              />
              <StatCard
                icon={<Database className="h-4 w-4" />}
                label="Cache hit rate"
                value={`${cacheHit.toFixed(1)}%`}
                hint={`${formatTokens(cacheRead)} read · ${formatTokens(cacheWrite)} write`}
              />
              <StatCard
                icon={<AlertCircle className="h-4 w-4" />}
                label="Unpriced calls"
                value={unpriced.toLocaleString()}
                hint="model not in pricing table"
                warn={unpriced > 0}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BreakdownCard
                title="By model"
                rows={byModel?.rows ?? []}
                emptyHint="No LLM calls in this window."
              />
              <BreakdownCard
                title="By source (extraction vs codegen)"
                rows={bySource?.rows ?? []}
                emptyHint="No LLM calls in this window."
              />
            </div>

            <ByProjectCard rows={byProject?.rows ?? []} />

            <ByRunCard rows={byRun?.rows ?? []} days={days} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function ByRunCard({ rows, days }: { rows: UsageByRunRow[]; days: number }) {
  const [drillRow, setDrillRow] = useState<UsageByRunRow | null>(null);

  // For drilldown: compute the upper bound by finding the next run of the same schema.
  const upperBoundByExtraction = (() => {
    const sortedBySchema: Record<string, UsageByRunRow[]> = {};
    rows.forEach((r) => {
      const k = r.schema_name ?? '';
      if (!k) return;
      (sortedBySchema[k] = sortedBySchema[k] ?? []).push(r);
    });
    Object.values(sortedBySchema).forEach((list) =>
      list.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
    );
    const out: Record<string, string | undefined> = {};
    Object.values(sortedBySchema).forEach((list) => {
      list.forEach((r, i) => {
        out[r.extraction_id] = list[i + 1]?.started_at ?? undefined;
      });
    });
    return out;
  })();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">By run</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={Inbox} title="No runs" description="No extraction runs in this window." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-gray-100 dark:border-[#1a1a1a]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-[#141414]">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Form</th>
                    <th className="px-3 py-2 font-medium">Models</th>
                    <th className="px-3 py-2 font-medium text-right" title="Number of PDFs processed in this run">PDFs</th>
                    <th className="px-3 py-2 font-medium text-right">Calls</th>
                    <th className="px-3 py-2 font-medium text-right">Tokens</th>
                    <th className="px-3 py-2 font-medium text-right" title="Total tokens / PDFs in this run">Avg tok/PDF</th>
                    <th className="px-3 py-2 font-medium text-right" title="Wall clock from run start to its last LLM call">Time</th>
                    <th className="px-3 py-2 font-medium text-right" title="Cost of calls whose answer was discarded and re-asked">Waste</th>
                    <th className="px-3 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                  {rows.map((r) => (
                    <tr key={r.extraction_id} className="hover:bg-gray-50 dark:hover:bg-[#141414]">
                      <td className="px-3 py-2 whitespace-nowrap text-xs dark:text-zinc-300">{formatTime(r.started_at)}</td>
                      <td className="px-3 py-2 dark:text-zinc-300">{r.project_name}</td>
                      <td
                        className={cn(
                          'px-3 py-2 max-w-[260px] truncate',
                          r.has_table_field
                            ? 'text-orange-600 dark:text-orange-400 font-medium'
                            : 'dark:text-zinc-300'
                        )}
                        title={r.has_table_field
                          ? `${r.form_name} — table-typed form (two-stage extraction, costlier per paper)`
                          : r.form_name}
                      >
                        {r.form_name}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.models.map((m) => (
                            <Badge key={m} variant="secondary" className="text-[10px] font-mono">
                              {shortModel(m)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{r.pdf_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <button
                          onClick={() => setDrillRow(r)}
                          className="text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                          title="Click to view individual calls"
                          disabled={r.calls === 0}
                        >
                          {r.calls.toLocaleString()}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{formatTokens(r.total_tokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">
                        {r.avg_tokens_per_pdf === null ? '—' : formatTokens(Math.round(r.avg_tokens_per_pdf))}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums dark:text-zinc-300"
                        title={r.model_time_seconds ? `${formatDuration(r.model_time_seconds)} of model time across all calls` : undefined}
                      >
                        {formatDuration(r.elapsed_seconds ?? 0)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          r.wasted_calls ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-600'
                        )}
                        title={r.wasted_calls ? `${r.wasted_calls} call${r.wasted_calls === 1 ? '' : 's'} discarded and re-asked` : 'No discarded calls'}
                      >
                        {r.wasted_calls ? `$${(r.wasted_cost_usd ?? 0).toFixed(3)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium dark:text-white">${r.cost_usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <CallsDrillDialog
        open={!!drillRow}
        onClose={() => setDrillRow(null)}
        schemaName={drillRow?.schema_name ?? null}
        extractionId={drillRow?.extraction_id ?? null}
        formName={drillRow?.form_name ?? null}
        projectName={drillRow?.project_name ?? null}
        startedAt={drillRow?.started_at ?? null}
        since={drillRow?.started_at ?? null}
        until={drillRow ? (upperBoundByExtraction[drillRow.extraction_id] ?? null) : null}
        pdfCount={drillRow?.pdf_count ?? 0}
        days={days}
      />
    </>
  );
}

// Pipeline steps of the keyed (Rigorous) table path. Their presence in a run is
// what tells us a paper with a single first-pass call *stopped* rather than
// simply being a scalar form. Named per the Aug 2026 terminology — record
// discovery, recall audit, slot fill, refill — never "Stage 1 / Stage 2".
const KEYED_STEPS = new Set(['record_discovery', 'recall_audit', 'slot_fill', 'slot_fill_row', 'refill']);

const STEP_LABEL: Record<string, string> = {
  record_discovery: 'record discovery',
  recall_audit: 'recall audit',
  slot_fill: 'slot fill',
  slot_fill_row: 'slot fill · per record',
  refill: 'refill',
  extract: 'extract',
};

type CallGroup = {
  key: string;
  title: string;
  subtitle?: string;
  calls: UsageCallRow[];
  cost: number;
  savings: number;
  ms: number;
  wastedCost: number;
  wastedCalls: number;
  note?: string;
  /** More than one form field in this paper's calls — show the field per row. */
  multiField?: boolean;
};

/** Group a run's calls by the paper they were about, in pipeline order. */
function buildCallGroups(rows: UsageCallRow[]): { groups: CallGroup[]; keyed: boolean } {
  const keyed = rows.some((r) => !!r.step && KEYED_STEPS.has(r.step));
  const map = new Map<string, CallGroup>();

  rows.forEach((r) => {
    const key = r.filename || r.document_id || (r.transport === 'langchain' ? '__codegen' : '__unlabeled');
    const title = r.filename
      || (r.transport === 'langchain' ? 'Form generation' : null)
      || (r.document_id ? `Document ${r.document_id.slice(0, 8)}` : 'Unattributed calls');
    let g = map.get(key);
    if (!g) {
      g = { key, title, calls: [], cost: 0, savings: 0, ms: 0, wastedCost: 0, wastedCalls: 0 };
      map.set(key, g);
    }
    g.calls.push(r);
    g.cost += r.cost_usd || 0;
    g.savings += r.cache_savings_usd || 0;
    g.ms += r.duration_ms || 0;
    if (r.superseded) {
      g.wastedCalls += 1;
      g.wastedCost += r.cost_usd || 0;
    }
  });

  const groups = Array.from(map.values());
  groups.forEach((g) => {
    g.calls.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    // The backend decides this from the form's schema: a table field whose paper
    // produced only record discovery had no rows to fill. It must not be inferred
    // here from "one call in a keyed run" — on a mixed form that label lands on
    // every scalar field.
    const stopped = g.calls.filter((c) => c.stopped);
    if (stopped.length) {
      const which = Array.from(new Set(stopped.map((c) => c.field_name).filter(Boolean)));
      g.note = which.length === 1
        ? `no rows found for ${which[0]}`
        : 'no rows found';
    }
    const fields = Array.from(new Set(g.calls.map((c) => c.field_name).filter(Boolean) as string[]));
    if (fields.length === 1) g.subtitle = fields[0];
    g.multiField = fields.length > 1;
  });
  groups.sort((a, b) => b.cost - a.cost);
  return { groups, keyed };
}

function CallsDrillDialog({
  open, onClose, schemaName, extractionId, formName, projectName, startedAt, since, until, pdfCount, days,
}: {
  open: boolean;
  onClose: () => void;
  schemaName: string | null;
  extractionId?: string | null;
  formName: string | null;
  projectName?: string | null;
  startedAt?: string | null;
  since?: string | null;
  until?: string | null;
  pdfCount?: number;
  days: number;
}) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['usage', 'calls', extractionId, schemaName, since, until, days],
    queryFn: () => usageService.getCalls({
      schemaName: schemaName ?? undefined,
      // Exact when the run's calls carry its id; the backend falls back to the
      // since/until window for runs recorded before that was stamped.
      extractionId: extractionId ?? undefined,
      since: since ?? undefined,
      until: until ?? undefined,
      days,
      limit: 500,
    }),
    enabled: !!schemaName && open,
  });

  const rows = data?.rows ?? [];
  const labelled = rows.some((r) => !!r.step);
  const { groups, keyed } = buildCallGroups(rows);

  const totals = rows.reduce(
    (acc, r) => ({
      cost: acc.cost + (r.cost_usd || 0),
      savings: acc.savings + (r.cache_savings_usd || 0),
      ms: acc.ms + (r.duration_ms || 0),
      wastedCost: acc.wastedCost + (r.superseded ? r.cost_usd || 0 : 0),
      wastedCalls: acc.wastedCalls + (r.superseded ? 1 : 0),
    }),
    { cost: 0, savings: 0, ms: 0, wastedCost: 0, wastedCalls: 0 }
  );

  // Wall clock ≠ the sum of call durations: papers run in parallel, so showing
  // one as the other would misstate both.
  const elapsedSeconds = (() => {
    if (!startedAt || rows.length === 0) return null;
    const last = rows.reduce((m, r) => ((r.timestamp ?? '') > m ? (r.timestamp ?? '') : m), '');
    if (!last) return null;
    const secs = (new Date(last).getTime() - new Date(startedAt).getTime()) / 1000;
    return Number.isFinite(secs) && secs >= 0 ? secs : null;
  })();

  const papersSeen = new Set(rows.map((r) => r.document_id || r.filename).filter(Boolean)).size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader title={schemaName ?? undefined}>
          <DialogTitle className="text-lg font-semibold">
            {formName ?? 'Run details'}
          </DialogTitle>
          <div className="text-sm text-gray-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2">
            {projectName && <span>{projectName}</span>}
            {projectName && startedAt && <span className="text-gray-300 dark:text-zinc-600">·</span>}
            {startedAt && <span>{formatFriendlyTime(startedAt)}</span>}
          </div>
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm text-gray-700 dark:text-zinc-300">
              <span>
                <span className="tabular-nums font-semibold">{rows.length}</span> call{rows.length === 1 ? '' : 's'}
              </span>
              <span className="text-gray-300 dark:text-zinc-600">·</span>
              <span className="tabular-nums font-semibold">${totals.cost.toFixed(4)}</span>
              {papersSeen > 0 && (
                <>
                  <span className="text-gray-300 dark:text-zinc-600">·</span>
                  <span className="tabular-nums">
                    {papersSeen}
                    {pdfCount ? `/${pdfCount}` : ''} paper{papersSeen === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {elapsedSeconds !== null && (
                <>
                  <span className="text-gray-300 dark:text-zinc-600">·</span>
                  <span
                    className="tabular-nums"
                    title="Wall clock for the run. Model time is the sum of every call's duration — larger, because papers run in parallel."
                  >
                    {formatDuration(elapsedSeconds)} elapsed
                    {totals.ms > 0 && ` (${formatDuration(totals.ms / 1000)} model time)`}
                  </span>
                </>
              )}
              {totals.savings > 0 && (
                <>
                  <span className="text-gray-300 dark:text-zinc-600">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400 tabular-nums" title="Saved by prompt caching versus paying full input price">
                    ${totals.savings.toFixed(3)} saved by cache
                  </span>
                </>
              )}
              {totals.wastedCalls > 0 && (
                <>
                  <span className="text-gray-300 dark:text-zinc-600">·</span>
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums" title="Answers that were discarded and re-asked">
                    ${totals.wastedCost.toFixed(3)} wasted on {totals.wastedCalls} discarded call{totals.wastedCalls === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          )}
          {rows.length > 0 && data?.exact === false && (
            <p className="pt-1 text-[11px] text-gray-400 dark:text-zinc-500">
              Matched by time window — this run predates per-call labels, so a concurrent run of the same form may appear here.
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md border border-gray-100 dark:border-[#1a1a1a]">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Spinner /></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title="No calls" description="No LLM calls recorded for this form." />
          ) : labelled ? (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#141414] sticky top-0 z-10">
                <tr className="text-left uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                  <th className="px-3 py-2 font-medium">Paper / step</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium text-right">In</th>
                  <th className="px-3 py-2 font-medium text-right">Out</th>
                  <th className="px-3 py-2 font-medium text-right" title="How long the model took to answer">Took</th>
                  <th className="px-3 py-2 font-medium text-right" title="Tokens written to (✎) and read from (✓) the prompt cache">Cache</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              {groups.map((g) => {
                const isOpen = toggled[g.key] ?? g.calls.length > 1;
                return (
                  <tbody key={g.key} className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                    <tr
                      className="bg-gray-50/60 dark:bg-[#141414]/60 cursor-pointer hover:bg-gray-100/70 dark:hover:bg-[#1a1a1a]"
                      onClick={() => setToggled((t) => ({ ...t, [g.key]: !isOpen }))}
                    >
                      <td className="px-3 py-2" colSpan={2}>
                        <div className="flex items-center gap-1.5">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 shrink-0" />}
                          <span className="font-medium text-gray-800 dark:text-zinc-100 truncate max-w-[280px]" title={g.title}>
                            {g.title}
                          </span>
                          {g.subtitle && (
                            <span className="font-mono text-[10px] text-gray-400 dark:text-zinc-500 truncate max-w-[160px]" title={g.subtitle}>
                              {g.subtitle}
                            </span>
                          )}
                          <span className="text-gray-400 dark:text-zinc-500">
                            · {g.calls.length} call{g.calls.length === 1 ? '' : 's'}
                          </span>
                          {g.note && (
                            <span className="text-gray-500 dark:text-zinc-400 italic">· {g.note}</span>
                          )}
                          {g.wastedCalls > 0 && (
                            <Badge variant="secondary" className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">
                              ${g.wastedCost.toFixed(3)} wasted
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-zinc-400" colSpan={2}>
                        {formatTokens(g.calls.reduce((s, c) => s + c.total_tokens, 0))} tok
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-zinc-400">
                        {g.ms > 0 ? formatDuration(g.ms / 1000) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {g.savings > 0 ? `$${g.savings.toFixed(3)}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold dark:text-white">
                        ${g.cost.toFixed(4)}
                      </td>
                    </tr>

                    {isOpen && g.calls.map((c) => {
                      const cw = c.cache_creation_input_tokens ?? 0;
                      const cr = c.cache_read_input_tokens ?? 0;
                      const stepKey = c.step ?? '';
                      return (
                        <tr key={c.id} className={cn('hover:bg-gray-50 dark:hover:bg-[#141414]', c.superseded && 'opacity-70')}>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2 pl-5">
                              <span className="text-gray-400 dark:text-zinc-500 tabular-nums whitespace-nowrap">
                                {formatClock(c.timestamp)}
                              </span>
                              <span className="dark:text-zinc-200">
                                {STEP_LABEL[stepKey] ?? c.signature ?? '—'}
                                {c.n_records ? ` · ${c.n_records} record${c.n_records === 1 ? '' : 's'}` : ''}
                                {c.transport === 'claude_agent_sdk' && c.num_turns ? ` · ${c.num_turns} turns` : ''}
                              </span>
                              {/* On a form with several fields, the step alone is ambiguous:
                                  a scalar field's call and a table field's first pass both
                                  read "extract"/"record discovery". */}
                              {g.multiField && c.field_name && (
                                <span className="font-mono text-[10px] text-gray-400 dark:text-zinc-500 truncate max-w-[170px]" title={c.field_name}>
                                  {c.field_name}
                                </span>
                              )}
                              {c.stopped && (
                                <span className="text-[10px] text-gray-500 dark:text-zinc-400 italic">
                                  no rows found
                                </span>
                              )}
                              {c.attempts_total && c.attempts_total > 1 && (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                                    c.superseded
                                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                      : 'bg-gray-100 text-gray-500 dark:bg-[#1f1f1f] dark:text-zinc-400'
                                  )}
                                  title={c.superseded ? (c.superseded_reason ?? undefined) : 'The attempt whose answer was used'}
                                >
                                  <RotateCcw className="h-2.5 w-2.5" />
                                  try {c.attempt}/{c.attempts_total}
                                  {c.superseded ? ' · discarded' : ' · kept'}
                                </span>
                              )}
                              {c.superseded && c.superseded_reason && (
                                <span className="text-[10px] text-amber-700/80 dark:text-amber-400/70 truncate max-w-[260px]">
                                  {c.superseded_reason}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-gray-400 dark:text-zinc-500">{shortModel(c.model ?? '')}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">{c.prompt_tokens.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">{c.completion_tokens.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">
                            {c.duration_ms ? formatDuration(c.duration_ms / 1000) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {cr > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓{formatTokens(cr)}</span>}
                            {cr > 0 && cw > 0 && ' '}
                            {cw > 0 && <span className="text-amber-600 dark:text-amber-400">✎{formatTokens(cw)}</span>}
                            {cr === 0 && cw === 0 && <span className="text-gray-400 dark:text-zinc-600">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">${c.cost_usd.toFixed(6)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          ) : (
            // Rows written before per-call labels existed: paper and step are not
            // recoverable, so show the plain chronological list.
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#141414] sticky top-0">
                <tr className="text-left uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium" title="Output field this call targeted">Signature</th>
                  <th className="px-3 py-2 font-medium text-right">In</th>
                  <th className="px-3 py-2 font-medium text-right">Out</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium text-right" title="Tokens written to the prompt cache (1.25× input rate)">Cache write</th>
                  <th className="px-3 py-2 font-medium text-right" title="Tokens read from the prompt cache (0.1× input rate)">Cache read</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                {rows.map((c) => {
                  const cw = c.cache_creation_input_tokens ?? 0;
                  const cr = c.cache_read_input_tokens ?? 0;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-[#141414]">
                      <td className="px-3 py-1.5 whitespace-nowrap dark:text-zinc-300">{formatTime(c.timestamp)}</td>
                      <td className="px-3 py-1.5 font-mono dark:text-zinc-300">{shortModel(c.model ?? '')}</td>
                      <td className="px-3 py-1.5 font-mono dark:text-zinc-400 max-w-[260px] truncate" title={c.signature ?? c.source_file ?? ''}>
                        {c.signature ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">{c.prompt_tokens.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">{c.completion_tokens.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium dark:text-white">{c.total_tokens.toLocaleString()}</td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', cw > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-600')}>
                        {cw > 0 ? cw.toLocaleString() : '—'}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', cr > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-400 dark:text-zinc-600')}>
                        {cr > 0 ? cr.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums dark:text-zinc-300">${c.cost_usd.toFixed(6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-zinc-500 pt-2">
          {data ? `Showing ${rows.length} call${rows.length === 1 ? '' : 's'}${labelled ? ', grouped by paper in pipeline order' : ' (newest first)'}, capped at 500.` : ''}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatClock(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function formatFriendlyTime(ts: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today at ${time}`;
    if (isYesterday) return `Yesterday at ${time}`;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function shortModel(m: string): string {
  // "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
  return m.includes('/') ? m.split('/', 2)[1] : m;
}

function StatCard({
  icon, label, value, hint, warn,
}: { icon: React.ReactNode; label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <Card className={cn(warn && 'border-amber-200 dark:border-amber-900/50')}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-gray-500 dark:text-zinc-400">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className={cn('mt-2 text-2xl font-semibold tabular-nums', 'dark:text-white')}>{value}</div>
        {hint && <div className="mt-1 text-xs text-gray-500 dark:text-zinc-500">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title, rows, emptyHint,
}: { title: string; rows: UsageBreakdownRow[]; emptyHint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="No data" description={emptyHint} />
        ) : (
          <div className="overflow-hidden rounded-md border border-gray-100 dark:border-[#1a1a1a]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#141414]">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Tokens</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                {rows.map((r) => (
                  <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-[#141414]">
                    <td className="px-3 py-2 font-mono text-xs dark:text-zinc-300">
                      {r.key}
                      {r.cost_usd === 0 && r.total_tokens > 0 && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">unpriced</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{r.calls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{formatTokens(r.total_tokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium dark:text-white">${r.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDuration(s: number): string {
  if (!s || s <= 0) return '—';
  // Sub-10s matters now that individual call durations are shown; rounding a
  // 0.9s call to "—" would read as "not recorded".
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function ByProjectCard({ rows }: { rows: UsageByProjectRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <FolderKanban className="h-4 w-4 text-gray-400 dark:text-zinc-500" />
          By project
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="No project spend" description="No AI extraction cost recorded in this window." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-100 dark:border-[#1a1a1a]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#141414]">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium text-right" title="Recurring per-extraction cost">Extraction</th>
                  <th className="px-3 py-2 font-medium text-right" title="One-time form code generation cost">Building</th>
                  <th className="px-3 py-2 font-medium text-right">Runs</th>
                  <th className="px-3 py-2 font-medium text-right" title="Distinct PDFs covered (re-runs not double-counted)">PDFs</th>
                  <th className="px-3 py-2 font-medium text-right" title="Sum of run durations">Time</th>
                  <th className="px-3 py-2 font-medium">Models</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                {rows.map((r) => (
                  <tr key={r.project_id} className="hover:bg-gray-50 dark:hover:bg-[#141414]">
                    <td className="px-3 py-2 max-w-[200px] truncate font-medium dark:text-zinc-200" title={r.project_name}>{r.project_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold dark:text-white">${r.total_cost_usd.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">${r.extraction_cost_usd.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">${r.codegen_cost_usd.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">
                      {r.runs}
                      {r.failed_runs > 0 && <span className="ml-1 text-[10px] text-red-500">{r.failed_runs}✕</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{r.unique_pdfs}</td>
                    <td className="px-3 py-2 text-right tabular-nums dark:text-zinc-300">{formatDuration(r.total_duration_seconds)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-500 max-w-[180px] truncate" title={r.models.map((m) => m.model).join(', ')}>
                      {r.models.length ? r.models.map((m) => formatModelName(m.model)).join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
