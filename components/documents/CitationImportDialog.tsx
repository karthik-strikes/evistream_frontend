'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { citationsService, extractDois, type CitationRecord } from '@/services/citations.service';
import { jobsService } from '@/services';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import type { WSMessage } from '@/types/api';
import { StatusPill, type FullTextAvailability } from './StatusPill';

interface Counters {
  total: number;
  with_pdf: number;
  needs_pdf: number;
  duplicates: number;
  errors: number;
}

interface CitationImportDialogProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onDone?: () => void;
}

type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';
type Mode = 'file' | 'paste';

const METRIC_LABEL = 'text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider';

export function CitationImportDialog({ open, projectId, onClose, onDone }: CitationImportDialogProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('file');
  const [records, setRecords] = useState<CitationRecord[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pasteText, setPasteText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [avail, setAvail] = useState<Record<number, FullTextAvailability>>({});
  const [availChecking, setAvailChecking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [counters, setCounters] = useState<Counters | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const inputRef = useRef<HTMLInputElement>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  };

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setMode('file');
      setRecords([]);
      setSelected(new Set());
      setPasteText('');
      setDragging(false);
      setJobId(null);
      setProgress(0);
      setStatusText('');
      setCounters(null);
      setError(null);
      setAvail({});
      setAvailChecking(false);
    }
    return clearPoll;
  }, [open]);

  const finish = (c: Counters | null, err?: string) => {
    clearPoll();
    if (err) {
      setError(err);
      setPhase('error');
      return;
    }
    setCounters(c);
    setPhase('done');
    onDone?.();
  };

  useJobWebSocket({
    jobId,
    enabled: !!jobId && phase === 'importing',
    onProgress: (p) => setProgress((prev) => Math.max(prev, p)),
    onMessage: (msg: WSMessage) => {
      if (msg.message) setStatusText(msg.message);
      const m = msg as { type?: string; level?: string; data?: unknown };
      if (m.type === 'data' && m.data) finish(m.data as Counters);
      else if (m.level === 'error' || m.type === 'failed') finish(null, msg.message || 'Import failed.');
    },
  });

  const showPreview = (recs: CitationRecord[]) => {
    setRecords(recs);
    setSelected(new Set(recs.map((_, i) => i)));
    setPhase('preview');

    // Kick off the best-effort full-text availability probe so the preview
    // shows what will actually fetch — not just which rows have a DOI.
    const initial: Record<number, FullTextAvailability> = {};
    const toProbe: { id: number; doi?: string | null; pmid?: string | null; pmcid?: string | null; urls?: string[] | null }[] = [];
    recs.forEach((r, i) => {
      if (r.doi || r.pmid || r.pmcid || (r.urls && r.urls.length > 0)) {
        initial[i] = 'checking';
        toProbe.push({ id: i, doi: r.doi ?? null, pmid: r.pmid ?? null, pmcid: r.pmcid ?? null, urls: r.urls ?? null });
      } else {
        initial[i] = 'none';
      }
    });
    setAvail(initial);
    if (toProbe.length === 0) return;
    setAvailChecking(true);
    citationsService
      .checkAvailability(toProbe)
      .then((res) => {
        setAvail((prev) => {
          const next = { ...prev };
          for (const r of res.results) next[r.id] = r.status;
          return next;
        });
      })
      .catch(() => {
        // Probe unavailable — fall back to "we'll try" for DOI-bearing rows.
        setAvail((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            const i = Number(k);
            if (next[i] === 'checking') next[i] = 'unknown';
          }
          return next;
        });
      })
      .finally(() => setAvailChecking(false));
  };

  const handleFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!/\.(ris|txt)$/i.test(f.name)) {
      toast({ variant: 'error', title: 'Wrong file type', description: 'Please choose a RIS file (.ris or .txt).' });
      return;
    }
    setPhase('parsing');
    setError(null);
    try {
      const result = await citationsService.previewRis(f, projectId);
      showPreview(result.records);
    } catch (e: any) {
      setError(e?.message || 'Could not read the RIS file.');
      setPhase('error');
    }
  };

  const handlePaste = () => {
    const dois = extractDois(pasteText);
    if (dois.length === 0) {
      toast({ variant: 'error', title: 'No DOIs found', description: 'Paste one or more DOIs (e.g. 10.1016/j.xxx).' });
      return;
    }
    showPreview(dois.map((doi) => ({ doi, title: null })));
  };

  const startImport = async () => {
    const chosen = records.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setPhase('importing');
    setProgress(5);
    setStatusText('Fetching open-access full text…');
    try {
      const res = await citationsService.import(projectId, chosen);
      setJobId(res.job_id);
      pollRef.current = setInterval(async () => {
        try {
          const job = await jobsService.getById(res.job_id);
          if (job.status === 'completed') finish((job.result_data as Counters) ?? null);
          else if (job.status === 'failed') finish(null, job.error_message || 'Import failed.');
          else if (typeof job.progress === 'number') setProgress((p) => Math.max(p, job.progress));
        } catch {
          /* transient — keep polling */
        }
      }, 2500);
    } catch (e: any) {
      finish(null, e?.message || 'Import failed.');
    }
  };

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const allSelected = records.length > 0 && selected.size === records.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(records.map((_, i) => i)));

  const counts = useMemo(() => {
    let fetchable = 0, needs = 0, checking = 0;
    records.forEach((_, i) => {
      const s = avail[i];
      if (s === 'pdf' || s === 'pmc') fetchable++;
      else if (s === 'none') needs++;
      else checking++; // 'checking' or 'unknown'
    });
    return { fetchable, needs, checking };
  }, [records, avail]);

  const selectedFetchable = useMemo(
    () => records.filter((_, i) => selected.has(i) && (avail[i] === 'pdf' || avail[i] === 'pmc')).length,
    [records, selected, avail],
  );

  if (!open) return null;
  const busy = phase === 'parsing' || phase === 'importing';

  return (
    <div
      className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Import RIS / DOIs</h2>
              <p className="text-sm text-gray-400 dark:text-zinc-500 mt-1">
                We fetch open-access full text automatically; the rest you can attach later.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { if (!busy) onClose(); }}
              disabled={busy}
              className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors p-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {phase === 'preview' && (
            <div className="grid grid-cols-3 mt-3 rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-x divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
              <Metric label="References" value={records.length} tone="neutral" sub={availChecking ? `checking ${counts.checking}…` : undefined} />
              <Metric label="Will fetch" value={counts.fetchable} tone="emerald" sub="open access" />
              <Metric label="Needs PDF" value={counts.needs} tone="amber" sub="attach later" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          {phase === 'idle' && (
            <div className="space-y-4">
              {/* mode toggle */}
              <div className="flex items-center gap-1 border-b border-gray-100 dark:border-[#1a1a1a]">
                {(['file', 'paste'] as Mode[]).map((mtab) => (
                  <button
                    key={mtab}
                    onClick={() => setMode(mtab)}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                      mode === mtab
                        ? 'border-sky-500 text-gray-900 dark:text-white'
                        : 'border-transparent text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300',
                    )}
                  >
                    {mtab === 'file' ? 'Upload .ris' : 'Paste DOIs'}
                  </button>
                ))}
              </div>

              {mode === 'file' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const f = Array.from(e.dataTransfer.files);
                    if (f.length) handleFile(f);
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    'relative rounded-2xl border border-dashed px-6 py-10 text-center cursor-pointer transition-colors',
                    dragging
                      ? 'border-sky-400 bg-sky-50/60 dark:bg-sky-500/[0.06]'
                      : 'border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#333]',
                  )}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".ris,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = Array.from(e.target.files || []);
                      e.target.value = '';
                      if (f.length) handleFile(f);
                    }}
                  />
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="rounded-full bg-gray-50 dark:bg-[#1a1a1a] p-3">
                      <Upload className={cn('w-5 h-5', dragging ? 'text-sky-500 dark:text-sky-400' : 'text-gray-400 dark:text-zinc-500')} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">Drop your RIS export here</p>
                      <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">or click to browse · .ris exported from EndNote, Zotero, PubMed…</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={6}
                    placeholder={'Paste DOIs, one per line —\n10.1016/j.joms.2021.03.006\n10.3390/medicina60081206'}
                    className="w-full rounded-xl border border-gray-200 dark:border-[#2a2a2a] bg-transparent px-3.5 py-2.5 text-sm text-gray-800 dark:text-zinc-200 placeholder:text-gray-300 dark:placeholder:text-zinc-600 outline-none focus:border-sky-400 dark:focus:border-sky-500 transition-colors resize-none font-mono"
                  />
                  <div className="flex justify-end">
                    <Button variant="default" size="sm" onClick={handlePaste}>Continue</Button>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-400 dark:text-zinc-500 leading-relaxed">
                RIS files carry citations, not PDFs — we look each one up in Unpaywall / PubMed Central and pull the
                full text where it’s openly available. Paywalled papers land as <span className="font-medium text-amber-600 dark:text-amber-400">Needs PDF</span> for a manual attach.
              </p>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="py-12 flex items-center justify-center gap-2.5 text-sm text-gray-400 dark:text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
              Reading references…
            </div>
          )}

          {phase === 'preview' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase">
                  References <span className="ml-1 font-medium tracking-normal normal-case text-gray-300 dark:text-zinc-600">— uncheck any you don’t want</span>
                </p>
                <button onClick={toggleAll} className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors bg-transparent border-none cursor-pointer p-0">
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              <div className="rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-y divide-gray-50 dark:divide-[#161616] max-h-[46vh] overflow-y-auto">
                {records.map((r, i) => {
                  const checked = selected.has(i);
                  const meta = [r.year, r.journal].filter(Boolean).join(' · ');
                  return (
                    <label
                      key={i}
                      className={cn(
                        'flex items-start gap-3 px-3.5 py-2.5 cursor-pointer transition-colors',
                        'hover:bg-black/[0.02] dark:hover:bg-white/[0.025]',
                        !checked && 'opacity-55',
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(i)} className="mt-1 shrink-0 accent-sky-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-gray-800 dark:text-zinc-100 tracking-tight line-clamp-2">{r.title || r.doi || 'Untitled'}</div>
                        {meta && <div className="text-xs text-gray-400 dark:text-zinc-600 truncate mt-0.5">{meta}</div>}
                      </div>
                      <StatusPill status={avail[i]} />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {phase === 'importing' && (
            <div className="py-6 space-y-4">
              <div className="flex items-center gap-2.5 text-sm text-gray-500 dark:text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                <span>{statusText || 'Importing references…'}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-[#1c1c1c] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-[width] duration-500" style={{ width: `${Math.max(5, progress)}%` }} />
              </div>
              <p className="text-xs text-gray-400 dark:text-zinc-500">Looking up open-access full text can take a moment per reference. You can close this — it keeps running.</p>
            </div>
          )}

          {phase === 'done' && counters && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                Import complete
              </div>
              <div className="grid grid-cols-4 rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-x divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
                <Metric label="References" value={counters.total} tone="neutral" />
                <Metric label="Full text" value={counters.with_pdf} tone="emerald" />
                <Metric label="Needs PDF" value={counters.needs_pdf} tone="amber" />
                <Metric label="Duplicates" value={counters.duplicates} tone="violet" />
              </div>
              {counters.errors > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {counters.errors} reference{counters.errors === 1 ? '' : 's'} could not be imported and were skipped.
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-zinc-500">
                Fetched full texts are processing. The <span className="font-medium text-amber-600 dark:text-amber-400">Needs PDF</span> ones are in your documents list — click one to attach a PDF.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 flex items-start gap-2.5 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error || 'Something went wrong.'}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-[#1a1a1a] flex items-center justify-between gap-2 flex-shrink-0">
          <div className="text-xs text-gray-400 dark:text-zinc-500">
            {phase === 'preview' && (
              <>Importing <span className="font-semibold text-gray-700 dark:text-zinc-300">{selected.size}</span> · {records.filter((r, i) => selected.has(i) && r.doi).length} with DOI</>
            )}
          </div>
          <div className="flex gap-2">
            {phase === 'error' && (
              <Button variant="secondary" size="sm" onClick={() => { setPhase('idle'); setRecords([]); }}>Try again</Button>
            )}
            {phase === 'preview' && (
              <Button variant="default" size="sm" onClick={startImport} disabled={selected.size === 0}>
                Import {selected.size} reference{selected.size === 1 ? '' : 's'}
              </Button>
            )}
            <Button variant={phase === 'done' ? 'default' : 'secondary'} size="sm" onClick={onClose} disabled={busy}>
              {phase === 'done' ? 'Done' : phase === 'preview' ? 'Cancel' : 'Close'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'sky' | 'emerald' | 'amber' | 'violet';
  sub?: string;
}) {
  const toneClass = {
    neutral: 'text-gray-700 dark:text-zinc-200',
    sky: 'text-sky-600 dark:text-sky-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    violet: 'text-violet-600 dark:text-violet-400',
  }[tone];
  return (
    <div className="px-3 py-2">
      <p className={METRIC_LABEL}>{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums mt-0.5', toneClass)}>{value}</p>
      {sub && <p className="text-[10px] text-gray-300 dark:text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}
