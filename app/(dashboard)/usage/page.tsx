'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import {
  Card, CardHeader, CardTitle, CardContent,
  Badge, EmptyState, Spinner,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui';
import { DollarSign, Hash, Database, AlertCircle, Inbox, Sparkles, Clock, FolderKanban } from 'lucide-react';
import { cn, formatModelName } from '@/lib/utils';
import { typography } from '@/lib/typography';
import { usageService, type UsageBreakdownRow, type UsageByRunRow, type UsageByProjectRow } from '@/services/usage.service';

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

function CallsDrillDialog({
  open, onClose, schemaName, formName, projectName, startedAt, since, until, pdfCount, days,
}: {
  open: boolean;
  onClose: () => void;
  schemaName: string | null;
  formName: string | null;
  projectName?: string | null;
  startedAt?: string | null;
  since?: string | null;
  until?: string | null;
  pdfCount?: number;
  days: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['usage', 'calls', schemaName, since, until, days],
    queryFn: () => usageService.getCalls({
      schemaName: schemaName ?? undefined,
      since: since ?? undefined,
      until: until ?? undefined,
      days,
      limit: 500,
    }),
    enabled: !!schemaName && open,
  });

  // Compute unique non-meta signatures from the call data
  const META = new Set(['reasoning', 'completed', 'done', 'output', 'answer', 'rationale']);
  const uniqueSignatures = (() => {
    if (!data?.rows) return 0;
    const set = new Set<string>();
    data.rows.forEach((c) => {
      if (c.signature && !META.has(c.signature.toLowerCase())) set.add(c.signature);
    });
    return set.size;
  })();
  const actualCalls = data?.rows.length ?? 0;
  const expectedCalls = (pdfCount ?? 0) * uniqueSignatures;
  const extraCalls = actualCalls - expectedCalls;

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
          {actualCalls > 0 && (pdfCount ?? 0) > 0 && uniqueSignatures > 0 && (
            <div className="text-sm text-gray-700 dark:text-zinc-300 pt-2">
              <span className="tabular-nums font-medium">{pdfCount}</span> paper{pdfCount === 1 ? '' : 's'}
              {' × '}
              <span className="tabular-nums font-medium">{uniqueSignatures}</span> field{uniqueSignatures === 1 ? '' : 's'}
              {' = '}
              <span className="tabular-nums font-semibold">{expectedCalls}</span> calls
              {extraCalls > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}· {extraCalls} retry{extraCalls === 1 ? '' : 's'} ({actualCalls} total)
                </span>
              )}
            </div>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded-md border border-gray-100 dark:border-[#1a1a1a]">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Spinner /></div>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState icon={Inbox} title="No calls" description="No LLM calls recorded for this form." />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#141414] sticky top-0">
                <tr className="text-left uppercase tracking-wide text-gray-500 dark:text-zinc-500">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium" title="DSPy signature / output field this call targeted">Signature</th>
                  <th className="px-3 py-2 font-medium text-right">In</th>
                  <th className="px-3 py-2 font-medium text-right">Out</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium text-right" title="Tokens written to Anthropic prompt cache (billed at 1.25× input rate)">Cache write</th>
                  <th className="px-3 py-2 font-medium text-right" title="Tokens read from Anthropic prompt cache (billed at 0.1× input rate)">Cache read</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                {data.rows.map((c) => {
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
          {data ? `Showing ${data.rows.length} call${data.rows.length === 1 ? '' : 's'} (newest first, capped at 500).` : ''}
        </div>
      </DialogContent>
    </Dialog>
  );
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
  if (!s || s < 1) return '—';
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
