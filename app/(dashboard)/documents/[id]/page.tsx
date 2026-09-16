'use client';

/**
 * Document detail: the paper, the data read out of its figures, and anything a
 * reviewer has attached.
 *
 * The Figures section exists because figure values used to arrive silently. The
 * parser digitized charts on its own and was wrong in a way that reached a CSV
 * (an arm understated by 1.23 on a 0-3 scale, two arms ranked backwards) with
 * nothing on screen to suggest a number had been read off a picture. Now every
 * figure is listed with its image beside its values, labelled as checked or not,
 * and correctable in place.
 */

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ChevronRight, Download, FileText, Loader2, Paperclip, Trash2,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useToast } from '@/hooks/use-toast';
import { documentsService } from '@/services/documents.service';
import { documentLabel, studyFileName } from '@/lib/documentLabel';
import { typography } from '@/lib/typography';
import { cn, formatBytes, formatDate, getErrorMessage } from '@/lib/utils';
import type { DocumentFigure, FigureCell } from '@/types/api';

import { FigureCard } from './_components/FigureCard';

/** Section rule: dot, label, hairline, count, optional action.
 *
 *  Copied from results/page.tsx so this page's sections read like the rest of
 *  the app. The hairline is what makes a section boundary legible without a
 *  card border around everything.
 */
function SectionRule({ label, count, action }: {
  label: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-900 dark:bg-white" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
        {label}
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-zinc-500">{count}</span>
      )}
      <span className="h-px flex-1 bg-gray-100 dark:bg-[#1f1f1f]" />
      {action}
    </div>
  );
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [diagramsOpen, setDiagramsOpen] = useState(true);

  const { data: document, isLoading, isError } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => documentsService.getById(documentId),
    enabled: !!documentId,
  });

  const { data: figuresData } = useQuery({
    queryKey: ['document-figures', documentId],
    queryFn: () => documentsService.getFigures(documentId),
    enabled: !!documentId,
    // Poll only while a pass is in flight — the pattern the rest of the app uses.
    refetchInterval: (q) => (q.state.data?.figures_status === 'pending' ? 3000 : false),
  });

  const { data: supplementary } = useQuery({
    queryKey: ['document-supplementary', documentId],
    queryFn: () => documentsService.listSupplementary(documentId),
    enabled: !!documentId,
  });

  // Memoised so the identity is stable — otherwise the `unverified` useMemo
  // below recomputes on every render.
  const figures: DocumentFigure[] = useMemo(
    () => figuresData?.figures ?? [],
    [figuresData?.figures],
  );
  const digitizing = figuresData?.figures_status === 'pending';
  const label = document ? documentLabel(document) : '';

  // Split rather than sort. A paper can be mostly schematics — the Transformer
  // paper is five diagrams and no charts — and the two kinds want different
  // treatment: charts are here to be checked, diagrams only to be looked at.
  const { dataFigures, diagramFigures } = useMemo(() => {
    const byPage = (a: DocumentFigure, b: DocumentFigure) => (a.page ?? 0) - (b.page ?? 0);
    return {
      dataFigures: figures.filter((f) => f.status !== 'not_a_chart').sort(byPage),
      diagramFigures: figures.filter((f) => f.status === 'not_a_chart').sort(byPage),
    };
  }, [figures]);

  const unverified = useMemo(
    () => figures.filter((f) => f.status === 'completed' && !f.verified).length,
    [figures],
  );

  const invalidateFigures = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['document-figures', documentId] });
    queryClient.invalidateQueries({ queryKey: ['document', documentId] });
  }, [queryClient, documentId]);

  const verify = useMutation({
    mutationFn: ({ image, rows }: { image: string; rows?: Record<string, FigureCell>[] }) =>
      documentsService.verifyFigure(documentId, image, rows ? { rows } : {}),
    onSuccess: (res) => {
      toast({
        title: res.corrected_cells
          ? `Saved · ${res.corrected_cells} value${res.corrected_cells === 1 ? '' : 's'} corrected`
          : 'Figure confirmed',
        description: 'Extractions run from now on will use these values.',
      });
      invalidateFigures();
    },
    onError: (e) => toast({ title: 'Could not save', description: getErrorMessage(e), variant: 'error' }),
  });

  const digitize = useMutation({
    mutationFn: (onlyImage?: string) => documentsService.digitizeFigures(documentId, onlyImage),
    onSuccess: () => {
      toast({ title: 'Reading figures…', description: 'The tables appear here when the run finishes.' });
      invalidateFigures();
    },
    onError: (e) => toast({ title: 'Could not start', description: getErrorMessage(e), variant: 'error' }),
  });

  const removeFile = useMutation({
    mutationFn: (fileId: string) => documentsService.deleteSupplementary(documentId, fileId),
    onSuccess: () => {
      toast({ title: 'File removed' });
      queryClient.invalidateQueries({ queryKey: ['document-supplementary', documentId] });
    },
    onError: (e) => toast({ title: 'Could not remove', description: getErrorMessage(e), variant: 'error' }),
  });

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';   // so the same file can be re-picked after a failure
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        await documentsService.uploadSupplementary(documentId, file);
      }
      toast({ title: `Attached ${files.length} file${files.length === 1 ? '' : 's'}` });
      queryClient.invalidateQueries({ queryKey: ['document-supplementary', documentId] });
    } catch (err) {
      toast({ title: 'Upload failed', description: getErrorMessage(err), variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const downloadMarkdown = async () => {
    try {
      const text = await documentsService.downloadMarkdown(documentId);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = studyFileName(label, document?.filename ?? 'document', '.md');
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: 'Download failed', description: getErrorMessage(err), variant: 'error' });
    }
  };

  const viewPdf = async () => {
    try {
      const url = await documentsService.getDownloadUrl(documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({ title: 'Could not open PDF', description: getErrorMessage(err), variant: 'error' });
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout title="Document">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !document) {
    return (
      <DashboardLayout title="Document">
        <Alert variant="error" title="Not Found">Document not found.</Alert>
      </DashboardLayout>
    );
  }

  // No title/description on DashboardLayout: this page renders its own header,
  // and passing both printed the study label twice — once in the navbar and
  // again on the page. Detail pages own their header (projects/[id] does too).
  return (
    <DashboardLayout>
      <PermissionGate permission="can_view_docs">
        {/* Full bleed. `max-w-5xl` left a ~245px empty gutter either side and,
            worse, could not hold a figure card with a four-arm data table — the
            table clipped and its headers wrapped. The comparable workflow pages
            (documents, results, synthesis, activity) are all full bleed;
            <main> already supplies px-6. */}
        <div className="space-y-6">
          <button
            onClick={() => router.push('/documents')}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Documents
          </button>

          {/* Header, bare on the page background — what every other dashboard
              page does. It used to sit in a bordered card, unique in the
              codebase, spending ~200px of height to repeat a title the navbar
              was already showing. Actions move up beside it. */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className={cn(typography.page.title, 'm-0 text-gray-900 dark:text-white')}>
                  {label}
                </h1>
                {document.source_type && document.source_type !== 'upload' && (
                  <Badge variant="neutral">{document.source_type}</Badge>
                )}
                {unverified > 0 && (
                  <Badge variant="attention">
                    {unverified} figure{unverified === 1 ? '' : 's'} to check
                  </Badge>
                )}
              </div>
              {document.title && (
                <p className="mt-1.5 max-w-[78ch] text-sm leading-relaxed text-gray-400 dark:text-zinc-500">
                  {document.title}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-400 dark:text-zinc-500">
                <span className="whitespace-nowrap">{formatDate(document.created_at)}</span>
                {document.doi && <span className="break-all font-mono">doi:{document.doi}</span>}
                {document.pmid && <span className="whitespace-nowrap font-mono">PMID {document.pmid}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={viewPdf} disabled={!document.s3_pdf_path}>
                <FileText className="h-3.5 w-3.5" />
                View PDF
              </Button>
              <Button size="sm" variant="outline" onClick={downloadMarkdown} disabled={!document.s3_markdown_path}>
                <Download className="h-3.5 w-3.5" />
                Download .md
              </Button>
              <label className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border',
                'bg-white px-3 text-[13px] font-medium hover:bg-gray-50',
                'dark:border-[#2a2a2a] dark:bg-[#111111] dark:hover:bg-[#161616]',
                uploading && 'pointer-events-none opacity-60',
              )}>
                {uploading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Paperclip className="h-3.5 w-3.5" />}
                Upload supplementary material
                <input type="file" multiple className="hidden" onChange={onPickFiles} />
              </label>
            </div>
          </div>

          {/* Figures */}
          <section>
            <SectionRule
              label="Figures"
              count={figures.length || undefined}
              action={figures.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => digitize.mutate(undefined)}
                  loading={digitize.isPending || digitizing}
                >
                  Re-read all figures
                </Button>
              )}
            />

            {figures.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-[#1f1f1f] dark:bg-[#111111]">
                <p className="text-[13px] text-muted">
                  {figuresData?.figures_status === 'failed'
                    ? figuresData.figures_error || 'Figures could not be read for this document.'
                    : digitizing
                      ? 'Reading this paper’s figures…'
                      : 'No figures were found in this document.'}
                </p>
                {!digitizing && document.s3_pdf_path && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4"
                    onClick={() => digitize.mutate(undefined)}
                    loading={digitize.isPending}
                  >
                    Read values from figures
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {dataFigures.map((figure) => (
                  <FigureCard
                    key={figure.image}
                    documentId={documentId}
                    figure={figure}
                    digitizing={digitizing}
                    onSave={async (rows) => { await verify.mutateAsync({ image: figure.image, rows }); }}
                    onConfirm={async () => { await verify.mutateAsync({ image: figure.image }); }}
                    onRedigitize={async () => { await digitize.mutateAsync(figure.image); }}
                  />
                ))}

                {diagramFigures.length > 0 && (
                  <div className="pt-2">
                    {/* Open by default: on a diagram-heavy paper these are all
                        there is to see, so hiding them behind a click would make
                        the page look empty. */}
                    <button
                      type="button"
                      aria-expanded={diagramsOpen}
                      onClick={() => setDiagramsOpen((v) => !v)}
                      className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"
                    >
                      <ChevronRight
                        className={cn('h-3 w-3 transition-transform', diagramsOpen && 'rotate-90')}
                      />
                      Diagrams and images · {diagramFigures.length}
                    </button>
                    {diagramsOpen && (
                      <div className="space-y-4">
                        {diagramFigures.map((figure) => (
                          <FigureCard
                            key={figure.image}
                            documentId={documentId}
                            figure={figure}
                            digitizing={digitizing}
                            onSave={async (rows) => { await verify.mutateAsync({ image: figure.image, rows }); }}
                            onConfirm={async () => { await verify.mutateAsync({ image: figure.image }); }}
                            onRedigitize={async () => { await digitize.mutateAsync(figure.image); }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Supplementary material */}
          <section>
            <SectionRule label="Supplementary material" count={supplementary?.length || undefined} />
            <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
              {!supplementary?.length ? (
                <p className="p-6 text-[13px] text-muted">
                  Nothing attached yet — use &ldquo;Upload supplementary material&rdquo; above to add
                  appendices, protocols or extra tables. These are stored for reference only; they
                  are not parsed and do not feed extraction.
                </p>
              ) : (
                <ul>
                  {supplementary.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-3 border-b border-border/60 px-5 py-3 last:border-b-0 dark:border-[#1f1f1f]"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {file.filename}
                      </span>
                      <span className="text-[12px] text-muted">
                        {file.size_bytes ? formatBytes(file.size_bytes) : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFile.mutate(file.id)}
                        loading={removeFile.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </PermissionGate>
    </DashboardLayout>
  );
}
