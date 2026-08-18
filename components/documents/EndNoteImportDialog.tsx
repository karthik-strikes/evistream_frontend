'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { endnoteService, type EndNotePreviewRecord, type EndNotePreviewResult } from '@/services/endnote.service';
import { citationsService } from '@/services/citations.service';
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

interface EndNoteImportDialogProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onDone?: () => void;
}

type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';

const MAX_ENLX = 500 * 1024 * 1024; // matches the backend cap

// Shared house styles (mirrors DecompositionReviewDialog).
const METRIC_LABEL = 'text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider';

export function EndNoteImportDialog({ open, projectId, onClose, onDone }: EndNoteImportDialogProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EndNotePreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
      setFile(null);
      setPreview(null);
      setSelected(new Set());
      setDragging(false);
      setAvail({});
      setAvailChecking(false);
      setJobId(null);
      setProgress(0);
      setStatusText('');
      setCounters(null);
      setError(null);
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
      // The broadcaster emits type 'data' (final counters) / 'log' (level 'error') —
      // variants the shared WSMessage.type union doesn't list.
      const m = msg as { type?: string; level?: string; data?: unknown };
      if (m.type === 'data' && m.data) finish(m.data as Counters);
      else if (m.level === 'error' || m.type === 'failed') finish(null, msg.message || 'Import failed.');
    },
  });

  const handleFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.enlx')) {
      toast({ variant: 'error', title: 'Wrong file type', description: 'Please choose an EndNote library (.enlx).' });
      return;
    }
    if (f.size > MAX_ENLX) {
      toast({ variant: 'error', title: 'File too large', description: 'The library exceeds the 500 MB limit.' });
      return;
    }
    setFile(f);
    setPhase('parsing');
    setError(null);
    try {
      const result = await endnoteService.preview(f, projectId);
      setPreview(result);
      setSelected(new Set(result.records.map((r) => r.ref_id)));
      setPhase('preview');
      probeAvailability(result.records);
    } catch (e: any) {
      setError(e?.message || 'Could not read the library.');
      setPhase('error');
    }
  };

  // Best-effort full-text availability probe for references with no PDF
  // already embedded in the library — mirrors CitationImportDialog's
  // showPreview so both import flows promise the same thing they'll fetch.
  const probeAvailability = (records: EndNotePreviewRecord[]) => {
    const initial: Record<number, FullTextAvailability> = {};
    const toProbe: { id: number; doi?: string | null; pmid?: string | null; pmcid?: string | null; urls?: string[] | null }[] = [];
    records.forEach((r) => {
      if (r.has_pdf) return; // already have a real PDF — nothing to probe
      if (r.doi || r.pmid || r.pmcid || (r.urls && r.urls.length > 0)) {
        initial[r.ref_id] = 'checking';
        toProbe.push({ id: r.ref_id, doi: r.doi, pmid: r.pmid, pmcid: r.pmcid, urls: r.urls });
      } else {
        initial[r.ref_id] = 'none';
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
        setAvail((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            const id = Number(k);
            if (next[id] === 'checking') next[id] = 'unknown';
          }
          return next;
        });
      })
      .finally(() => setAvailChecking(false));
  };

  const startImport = async () => {
    if (!file || !preview) return;
    const refIds = Array.from(selected);
    setPhase('importing');
    setProgress(5);
    setStatusText('Uploading library…');
    try {
      const all = refIds.length === preview.records.length;
      const res = await endnoteService.importLibrary(file, projectId, all ? undefined : refIds);
      setJobId(res.job_id);
      setStatusText('Parsing library…');
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
      finish(null, e?.message || 'Upload failed.');
    }
  };

  const toggle = (refId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(refId) ? next.delete(refId) : next.add(refId);
      return next;
    });

  const allSelected = !!preview && selected.size === preview.records.length && preview.records.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(preview!.records.map((r) => r.ref_id)));

  const selectedWithPdf = useMemo(
    () => (preview ? preview.records.filter((r) => selected.has(r.ref_id) && r.has_pdf).length : 0),
    [preview, selected],
  );

  // "Will fetch" / "Needs PDF" among references with NO embedded PDF — the
  // ones with an embedded PDF are already counted in preview.with_pdf.
  const counts = useMemo(() => {
    let fetchable = 0, needs = 0, checking = 0;
    (preview?.records || []).forEach((r) => {
      if (r.has_pdf) return;
      const s = avail[r.ref_id];
      if (s === 'pdf' || s === 'pmc') fetchable++;
      else if (s === 'none') needs++;
      else checking++; // 'checking' or 'unknown'
    });
    return { fetchable, needs, checking };
  }, [preview, avail]);

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
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Import from EndNote</h2>
              <p className="text-sm text-gray-400 dark:text-zinc-500 mt-1">Review the references, then import — PDFs come across too.</p>
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

          {/* Preview metric strip lives in the header, like DecompositionReviewDialog. */}
          {phase === 'preview' && preview && (
            <div className="grid grid-cols-4 mt-3 rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-x divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
              <Metric
                label="References"
                value={preview.total}
                tone="neutral"
                sub={availChecking ? `checking ${counts.checking}…` : undefined}
              />
              <Metric label="With PDF" value={preview.with_pdf} tone="emerald" sub="in library" />
              <Metric label="Will fetch" value={counts.fetchable} tone="sky" sub="open access" />
              <Metric label="Needs PDF" value={counts.needs} tone="amber" sub="attach later" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          {phase === 'idle' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = Array.from(e.dataTransfer.files);
                  if (f.length) handleFiles(f);
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
                  accept=".enlx"
                  className="hidden"
                  onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (f.length) handleFiles(f);
                  }}
                />
                <div className="flex flex-col items-center gap-2.5">
                  <div className="rounded-full bg-gray-50 dark:bg-[#1a1a1a] p-3">
                    <Upload className={cn('w-5 h-5', dragging ? 'text-sky-500 dark:text-sky-400' : 'text-gray-400 dark:text-zinc-500')} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">Drop your EndNote library here</p>
                    <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">or click to browse · .enlx up to 500 MB</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-zinc-500 leading-relaxed">
                Export from EndNote as a <span className="font-medium text-gray-500 dark:text-zinc-400">Compressed Library (.enlx)</span> with file
                attachments included. Nothing is imported until you confirm on the next step.
              </p>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="py-12 flex items-center justify-center gap-2.5 text-sm text-gray-400 dark:text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
              Reading library…
            </div>
          )}

          {phase === 'preview' && preview && (
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
                {preview.records.map((r) => {
                  const checked = selected.has(r.ref_id);
                  const meta = [r.year, r.journal].filter(Boolean).join(' · ');
                  return (
                    <label
                      key={r.ref_id}
                      className={cn(
                        'flex items-start gap-3 px-3.5 py-2.5 cursor-pointer transition-colors',
                        'hover:bg-black/[0.02] dark:hover:bg-white/[0.025]',
                        !checked && 'opacity-55',
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(r.ref_id)} className="mt-1 shrink-0 accent-sky-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-gray-800 dark:text-zinc-100 tracking-tight line-clamp-2">{r.title}</div>
                        {meta && <div className="text-xs text-gray-400 dark:text-zinc-600 truncate mt-0.5">{meta}</div>}
                      </div>
                      {r.has_pdf ? (
                        <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium mt-0.5 text-gray-400 dark:text-zinc-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          PDF
                        </span>
                      ) : (
                        <StatusPill status={avail[r.ref_id]} />
                      )}
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
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-[width] duration-500"
                  style={{ width: `${Math.max(5, progress)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-zinc-500">You can close this — the import keeps running and documents appear as they finish.</p>
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
                <Metric label="With PDF" value={counters.with_pdf} tone="emerald" />
                <Metric label="Needs PDF" value={counters.needs_pdf} tone="amber" />
                <Metric label="Duplicates" value={counters.duplicates} tone="violet" />
              </div>
              {counters.errors > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {counters.errors} reference{counters.errors === 1 ? '' : 's'} could not be imported and were skipped.
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-zinc-500">PDF-backed references are being processed and will become extractable shortly. References without a PDF in the library had their open-access full text fetched by DOI where available; the rest are in your documents list as <span className="font-medium text-amber-600 dark:text-amber-400">Needs PDF</span> — click one to attach a PDF.</p>
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
              <>Importing <span className="font-semibold text-gray-700 dark:text-zinc-300">{selected.size}</span> · {selectedWithPdf} with PDF</>
            )}
          </div>
          <div className="flex gap-2">
            {phase === 'error' && (
              <Button variant="secondary" size="sm" onClick={() => { setPhase('idle'); setFile(null); setPreview(null); }}>
                Try again
              </Button>
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
