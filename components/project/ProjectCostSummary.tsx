'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui';
import { cn, formatModelName, modelTagTheme } from '@/lib/utils';
import { usageService, type UsageByProjectRun } from '@/services/usage.service';
import {
  DollarSign, Clock, Play, FileStack, Wrench, Layers,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, Ban,
} from 'lucide-react';

// ── formatting helpers ──────────────────────────────────────────────────
function fmtUSD(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtDuration(s: number | null): string {
  if (s == null) return '—';
  if (s < 1) return '<1s';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    completed: { icon: <CheckCircle2 size={12} />, cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200/70 dark:text-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-400/20', label: 'done' },
    failed: { icon: <XCircle size={12} />, cls: 'text-red-600 bg-red-50 ring-red-200/70 dark:text-red-300 dark:bg-red-500/10 dark:ring-red-400/20', label: 'failed' },
    cancelled: { icon: <Ban size={12} />, cls: 'text-zinc-500 bg-zinc-100 ring-zinc-200/70 dark:text-zinc-400 dark:bg-zinc-500/10 dark:ring-zinc-400/20', label: 'cancelled' },
    processing: { icon: <Loader2 size={12} className="animate-spin" />, cls: 'text-amber-700 bg-amber-50 ring-amber-200/70 dark:text-amber-300 dark:bg-amber-500/10 dark:ring-amber-400/20', label: 'running' },
    pending: { icon: <Loader2 size={12} />, cls: 'text-amber-700 bg-amber-50 ring-amber-200/70 dark:text-amber-300 dark:bg-amber-500/10 dark:ring-amber-400/20', label: 'queued' },
  };
  const s = map[status] ?? { icon: null, cls: 'text-zinc-500 bg-zinc-100 ring-zinc-200/70 dark:text-zinc-400 dark:bg-zinc-500/10 dark:ring-zinc-400/20', label: status };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', s.cls)}>
      {s.icon}{s.label}
    </span>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-gray-400 dark:text-zinc-500">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white leading-none">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

// ── main ────────────────────────────────────────────────────────────────
export function ProjectCostSummary({ projectId }: { projectId: string }) {
  const [showRuns, setShowRuns] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['usage', 'by-project', projectId],
    queryFn: () => usageService.getByProject({ projectId, days: 365 }),
  });

  const row = data?.rows?.[0];

  // Nothing spent yet — stay quiet rather than showing an empty shell.
  if (!isLoading && (!row || (row.runs === 0 && row.total_cost_usd === 0))) {
    return null;
  }

  return (
    <Card className="mb-4 overflow-hidden border-gray-200/80 dark:border-[#1f1f1f]">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign size={15} className="text-gray-400 dark:text-zinc-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Cost &amp; Time</h3>
          </div>
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">last 12 months · AI extraction</span>
        </div>

        {isLoading || !row ? (
          <div className="flex h-20 items-center justify-center text-gray-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* headline stat strip */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                icon={<DollarSign size={13} />}
                label="Total"
                value={fmtUSD(row.total_cost_usd)}
                sub={`${fmtTokens(row.total_tokens)} tokens`}
              />
              <Stat
                icon={<Play size={13} />}
                label="Extraction"
                value={fmtUSD(row.extraction_cost_usd)}
              />
              <Stat
                icon={<Wrench size={13} />}
                label="Form building"
                value={fmtUSD(row.codegen_cost_usd)}
                sub="one-time"
              />
              <Stat
                icon={<Clock size={13} />}
                label="Total time"
                value={fmtDuration(row.total_duration_seconds || null)}
                sub="sum of runs"
              />
              <Stat
                icon={<Layers size={13} />}
                label="Runs"
                value={String(row.runs)}
                sub={[
                  row.successful_runs ? `${row.successful_runs} done` : '',
                  row.failed_runs ? `${row.failed_runs} failed` : '',
                  row.cancelled_runs ? `${row.cancelled_runs} cancelled` : '',
                  row.running_runs ? `${row.running_runs} active` : '',
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Stat
                icon={<FileStack size={13} />}
                label="PDFs"
                value={String(row.unique_pdfs)}
                sub={`${row.pdf_runs} run${row.pdf_runs === 1 ? '' : 's'} total`}
              />
            </div>

            {/* by model + by form */}
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-zinc-500">By model (billed)</div>
                {row.models.length === 0 ? (
                  <div className="text-xs text-gray-400 dark:text-zinc-600">No spend recorded.</div>
                ) : (
                  <div className="space-y-1.5">
                    {row.models.map((m) => (
                      <div key={m.model} className="flex items-center justify-between gap-2">
                        <span className={cn('truncate rounded-md px-2 py-0.5 text-[11px] font-medium', modelTagTheme(m.model))}>
                          {formatModelName(m.model)}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums font-medium text-gray-700 dark:text-zinc-300">{fmtUSD(m.cost_usd)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-zinc-500">By form</div>
                {row.forms.length === 0 ? (
                  <div className="text-xs text-gray-400 dark:text-zinc-600">No forms yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {row.forms.map((f) => (
                      <div key={f.form_id ?? f.form_name} className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-gray-600 dark:text-zinc-400" title={f.form_name}>{f.form_name}</span>
                        <span className="shrink-0 text-xs tabular-nums font-medium text-gray-700 dark:text-zinc-300">
                          {fmtUSD(f.cost_usd + f.codegen_cost_usd)}
                          {f.unique_pdfs > 0 && <span className="ml-1.5 text-[10px] font-normal text-gray-400 dark:text-zinc-600">{f.unique_pdfs} pdf</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* collapsible per-run list */}
            {row.run_list.length > 0 && (
              <div className="mt-4 border-t border-gray-100 dark:border-[#1a1a1a] pt-3">
                <button
                  onClick={() => setShowRuns((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                >
                  {showRuns ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {showRuns ? 'Hide' : 'Show'} {row.run_list.length} run{row.run_list.length === 1 ? '' : 's'}
                </button>
                {showRuns && <RunTable runs={row.run_list} />}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RunTable({ runs }: { runs: UsageByProjectRun[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-gray-100 dark:border-[#1a1a1a]">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-[#141414]">
          <tr className="text-left uppercase tracking-wide text-[10px] text-gray-500 dark:text-zinc-500">
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Form</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">PDFs</th>
            <th className="px-3 py-2 font-medium text-right">Time</th>
            <th className="px-3 py-2 font-medium text-right">Cost</th>
            <th className="px-3 py-2 font-medium">Model</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
          {runs.map((r) => (
            <tr key={r.job_id} className="hover:bg-gray-50 dark:hover:bg-[#141414]">
              <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-zinc-400">{fmtDate(r.started_at)}</td>
              <td className="px-3 py-2 max-w-[160px] truncate text-gray-600 dark:text-zinc-300" title={r.form_name}>{r.form_name}</td>
              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-zinc-300">{r.pdf_count}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-zinc-300">{fmtDuration(r.duration_seconds)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-800 dark:text-white">
                {r.cost_exact ? fmtUSD(r.cost_usd) : <span className="text-gray-400 dark:text-zinc-600" title="Run predates per-run cost tracking; counted in the project total via its form.">n/a</span>}
              </td>
              <td className="px-3 py-2 text-gray-500 dark:text-zinc-500 truncate max-w-[120px]" title={r.models.join(', ')}>
                {r.models.length ? r.models.map(formatModelName).join(', ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
