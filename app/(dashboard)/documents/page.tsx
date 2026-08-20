'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useDropzone } from 'react-dropzone';
import { FileText, Upload, Trash2, Download, Loader2, AlertCircle, CheckCircle, Clock, X, Tag, FolderOpen, RotateCcw, MoreHorizontal, MoreVertical, Search, ChevronDown, Check, ExternalLink, BookMarked, Copy, FlaskConical, Pencil } from 'lucide-react';
import { Button, Card, Alert, EmptyState, Badge } from '@/components/ui';
import { Tooltip } from '@/components/ui/tooltip';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { documentsService, healthService } from '@/services';
import type { Document } from '@/types/api';
import { formatBytes, formatDate, cn, getErrorMessage } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useRouter } from 'next/navigation';
import { typography } from '@/lib/typography';
import { LiteratureSearchDrawer } from '@/components/clinical-trials/LiteratureSearchDrawer';
import { ImportedTrialDrawer } from '@/components/clinical-trials/ImportedTrialDrawer';
import { LabelChip } from '@/components/documents/DocumentTags';
import { EndNoteImportDialog } from '@/components/documents/EndNoteImportDialog';
import { CitationImportDialog } from '@/components/documents/CitationImportDialog';
import type { LiteratureScope } from '@/services/literature.service';
import { buildLabelMap } from '@/lib/documentLabel';

interface StagedFile {
  file: File;
  labels: string[];
  labelInput: string;
}

const SCOPE_OPTIONS: { label: string; value: LiteratureScope }[] = [
  { label: 'All sources', value: 'all' },
  { label: 'ClinicalTrials.gov', value: 'ctgov' },
  { label: 'PubMed', value: 'pubmed' },
];
const SCOPE_LABELS: Record<LiteratureScope, string> = {
  all: 'All sources',
  ctgov: 'ClinicalTrials.gov',
  pubmed: 'PubMed',
};

/**
 * Labels shown before collapsing the rest behind a "+N" toggle. Two, not three:
 * the meta row now also carries a gate badge and a provenance chip, and those
 * are system facts that have to win the space.
 */
const MAX_VISIBLE_LABELS = 2;

export default function DocumentsPage() {
  const { toast } = useToast();
  const { selectedProject } = useProject();
  const { can_upload_docs, can_view_docs, isOwner, isAdmin } = useProjectPermissions();
  const canDeleteDocs = isOwner || isAdmin;
  // Row selection feeds TWO bulk actions with different permissions: delete
  // (owner/admin) and accept-for-extraction (can_upload_docs). Gating the
  // checkbox on delete alone made bulk accept unreachable for exactly the
  // people it was built for — a member with upload rights could see the
  // "Accept N for extraction" button's precondition but never satisfy it.
  const canSelectDocs = canDeleteDocs || can_upload_docs;
  const { confirm, dialog } = useConfirmationDialog();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [viewingTrialDoc, setViewingTrialDoc] = useState<Document | null>(null);
  const [endnoteOpen, setEndnoteOpen] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  // Target document for the "attach a PDF to a needs_pdf import" flow.
  const [searchScope, setSearchScope] = useState<LiteratureScope>('all');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  // Typed into the "Evidence search" hero card — seeds the drawer's query
  // when the user opens it via Enter/Search, taking precedence over the
  // project-name auto-seed (see LiteratureSearchDrawer's initialQuery).
  const [heroQuery, setHeroQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close the scope dropdown on outside click — same pattern as
  // components/ui/dropdown-menu.tsx.
  useEffect(() => {
    if (!scopeMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (scopeMenuRef.current && !scopeMenuRef.current.contains(e.target as Node)) {
        setScopeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [scopeMenuOpen]);

  // This page is deliberately project-scoped, like every other page in the app.
  // A cross-project ("All projects") browsing mode was tried and removed: every
  // row action has to be disabled for out-of-project rows (we only know our role
  // in the SELECTED project), and everything you'd do next with a document —
  // extract, assign, adjudicate, export — is project-scoped anyway. The
  // find-a-paper-across-projects need belongs to a global search that deep-links
  // into the owning project, not to a list you can't act on.
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', selectedProject?.id, debouncedSearchQuery],
    queryFn: () => documentsService.getAll(selectedProject!.id, debouncedSearchQuery),
    enabled: !!selectedProject,
  });

  // The project's FULL document set, independent of the search box. `documents`
  // above is filtered server-side by the search term, and anything derived from
  // it is therefore a statement about the search results, not the project —
  // which was wrong for every count on this page. Duplicate detection was the
  // most visible symptom: typing a document's name made its own "possible
  // duplicate" flag vanish, because the other copy had been filtered out.
  // Reuses the same query key with an empty term, so it's a cache hit whenever
  // the search box is empty (i.e. almost always).
  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id, ''],
    queryFn: () => documentsService.getAll(selectedProject!.id, ''),
    enabled: !!selectedProject,
  });
  const isSearching = debouncedSearchQuery.trim() !== '';

  // Duplicate detection is best-effort and on-demand: flag DOIs shared by
  // more than one document already loaded for this project. Detection only —
  // never auto-merged (the same DOI can legitimately be an author-accepted
  // manuscript vs. the published version).
  // Keyed by project+DOI: in cross-project mode the same paper appearing in two
  // different reviews is normal, not a duplicate, so only a repeat WITHIN one
  // project counts (which is exactly what the chip's tooltip claims).
  // Computed over allDocuments, never the search-filtered list — a duplicate is
  // a fact about the project, and it must not appear and disappear as you type.
  const duplicateDois = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of allDocuments) {
      if (d.doi) {
        const key = `${d.project_id}::${d.doi}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key));
  }, [allDocuments]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Staging state
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [applyAllInput, setApplyAllInput] = useState('');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [docTab, setDocTab] = useState<'all' | 'ready' | 'attn'>('all');
  const [accepting, setAccepting] = useState(false);
  const [zipDownloading, setZipDownloading] = useState<'pdf' | 'md' | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const allSelected = documents.length > 0 && selectedIds.size === documents.length;

  // Bundle every document's PDF or markdown into a single .zip and download it.
  // Only invoked when all docs are selected (the buttons are gated on allSelected),
  // so we zip the whole `documents` list rather than the selection set.
  const handleDownloadAll = async (kind: 'pdf' | 'md') => {
    if (zipDownloading || documents.length === 0) return;
    setZipDownloading(kind);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const used = new Set<string>();
      let failed = 0;

      // Limited-concurrency fetch so a big project doesn't open 100 requests at once.
      const POOL = 5;
      const queue = [...documents];
      const worker = async () => {
        while (queue.length) {
          const doc = queue.shift()!;
          const base = (doc.filename || `document-${doc.id}`).replace(/\.pdf$/i, '');
          try {
            if (kind === 'md') {
              if (doc.processing_status !== 'completed') { failed++; continue; }
              const md = await documentsService.downloadMarkdown(doc.id);
              let name = `${base}.md`;
              let n = 2;
              while (used.has(name)) name = `${base} (${n++}).md`;
              used.add(name);
              zip.file(name, md);
            } else {
              const blob = await documentsService.downloadPdfBlob(doc.id);
              let name = `${base}.pdf`;
              let n = 2;
              while (used.has(name)) name = `${base} (${n++}).pdf`;
              used.add(name);
              zip.file(name, blob);
            }
          } catch {
            failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, documents.length) }, worker));

      if (used.size === 0) {
        toast({ title: 'Nothing to download', description: kind === 'md' ? 'No processed markdown available.' : 'No PDFs available.', variant: 'error' });
        return;
      }

      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const link = document.createElement('a');
      const projectName = (selectedProject?.name || 'documents').replace(/[^\w.-]+/g, '_');
      link.href = url;
      link.setAttribute('download', `${projectName}_${kind === 'md' ? 'markdown' : 'pdfs'}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast({
        title: 'Download ready',
        description: failed > 0
          ? `Zipped ${used.size} file${used.size === 1 ? '' : 's'}; ${failed} skipped.`
          : `Zipped ${used.size} file${used.size === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to build the download.', variant: 'error' });
    } finally {
      setZipDownloading(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === documents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map(d => d.id)));
    }
  };

  // ── Evidence gate ─────────────────────────────────────────────────────────
  // A document is held back when it has no usable full text and nobody has
  // accepted it. Whether an abstract is enough depends on the form being run,
  // so this is a human decision, not a rule.
  const needsAttention = (doc: Document) =>
    doc.processing_status === 'needs_pdf' ||
    (doc.processing_status === 'metadata_only' && !doc.metadata_extraction_approved);

  /**
   * The ONE status badge a row may show. Colour on this page means "a human has
   * to act"; everything else is neutral. Previously a single row could carry a
   * status badge, an evidence-gap badge AND a green "Accepted" badge — three
   * chips and up to three colours describing one state.
   *
   * The accepted branch keys off processing_status, not the bare approval flag:
   * attach-pdf resets the status to `pending` without clearing
   * metadata_extraction_approved (documents.py), so a flag-only check left a
   * green "Accepted" badge on documents that had since gained full text.
   */
  const docGate = (
    doc: Document
  ): { label: string; variant: 'attention' | 'critical' | 'active' | 'neutral'; tooltip: string; pulse?: boolean } | null => {
    switch (doc.processing_status) {
      case 'failed':
        return { label: 'Failed', variant: 'critical', tooltip: 'Processing failed — retry or delete from the ⋯ menu' };
      case 'needs_pdf':
        // Deliberately distinct from the accept-able case: the accept endpoint
        // rejects needs_pdf, so offering "accept" here would be a dead end.
        return { label: 'Needs PDF', variant: 'attention', tooltip: 'Nothing to read yet — attach a PDF to use this document' };
      case 'metadata_only': {
        const what = doc.source_type === 'ctgov' ? 'No results posted' : 'Abstract only';
        return doc.metadata_extraction_approved
          ? { label: `${what} · accepted`, variant: 'neutral', tooltip: 'Accepted for extraction despite thin evidence' }
          : { label: what, variant: 'attention', tooltip: 'Held out of extraction until accepted — click the row to review' };
      }
      case 'processing':
        return { label: 'Processing', variant: 'active', tooltip: 'Parsing in progress', pulse: true };
      case 'pending':
        return { label: 'Queued', variant: 'neutral', tooltip: 'Waiting to be parsed' };
      default:
        return null; // completed — the boring majority stays silent
    }
  };

  /**
   * One neutral provenance chip — but only where provenance is news.
   * Provenance is a fact, not an action, so it never gets colour; that budget
   * belongs to docGate.
   *
   * `upload` deliberately returns null. It's ~94% of documents, so a chip
   * reading "Upload" would appear on nearly every row and tell a reader what
   * they already assume. The ABSENCE of a chip is the signal: nobody imported
   * this, you uploaded it. Chips are for the minority that came from somewhere.
   */
  const sourceChip = (doc: Document): { label: string; Icon: React.ComponentType<{ className?: string }>; href: string | null } | null => {
    switch (doc.source_type) {
      case 'ctgov':
        return { label: 'Clinical trial', Icon: FlaskConical, href: doc.nct_id ? `https://clinicaltrials.gov/study/${doc.nct_id}` : null };
      case 'pubmed':
        return { label: 'PubMed', Icon: BookMarked, href: doc.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${doc.pmid}/` : null };
      case 'ris':
      case 'endnote':
        // No doi.org link here on purpose — the `doi:` link on this same row
        // already goes there, and two identical links 30px apart is noise.
        return { label: 'Reference', Icon: FileText, href: null };
      default:
        return null;
    }
  };

  // Search-scoped: this drives the tab counts, which must describe what the tab
  // will actually show. A tab reading "Needs attention 20" that opens onto one
  // row is worse than no count.
  const heldBack = useMemo(() => documents.filter(needsAttention), [documents]);
  // Project-scoped: the banner is a claim about the next extraction run, which
  // has nothing to do with what's typed in the search box.
  const heldBackAll = useMemo(() => allDocuments.filter(needsAttention), [allDocuments]);

  // Per-document only, from the row's ⋯ menu. There was briefly a project-wide
  // "Find N missing DOIs" button in the header too; it was removed as clutter —
  // a header that grows a button for every maintenance task stops being a
  // header. The batch endpoint still exists server-side if it's ever wanted.
  const [backfillingDoiId, setBackfillingDoiId] = useState<string | null>(null);

  const handleBackfillOneDoi = async (id: string) => {
    try {
      setBackfillingDoiId(id);
      await documentsService.backfillDoi(id);
      toast({ title: 'Looking up DOI', description: 'Running in the background — the row will update shortly.', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Could not look up the DOI'), variant: 'error' });
    } finally {
      setBackfillingDoiId(null);
    }
  };

  // Study IDs for the whole project at once: the a/b suffix is a per-project
  // decision, so it cannot be computed row by row — and it is built from
  // `allDocuments`, NOT the search-filtered `documents`, for the same reason
  // duplicate detection is: searching "Mehlisch" must not turn "Mehlisch 2010a"
  // into a bare "Mehlisch 2010" just because its sibling was filtered out.
  const docLabels = useMemo(() => buildLabelMap(allDocuments), [allDocuments]);

  const visibleDocs = useMemo(() => {
    if (docTab === 'attn') return documents.filter(needsAttention);
    if (docTab === 'ready') return documents.filter(d => !needsAttention(d));
    return documents;
  }, [documents, docTab]);

  const selectedHeldIds = useMemo(
    () => heldBack.filter(d => selectedIds.has(d.id) && d.processing_status === 'metadata_only').map(d => d.id),
    [heldBack, selectedIds]
  );

  const handleBulkAccept = async () => {
    if (selectedHeldIds.length === 0) return;
    const n = selectedHeldIds.length;
    const confirmed = await confirm({
      title: `Accept ${n} document${n === 1 ? '' : 's'} for extraction`,
      description:
        `${n === 1 ? 'This document has' : 'These documents have'} no full text. Extraction will read only ` +
        `what is stored, so fields that appear solely in the full paper will come back NR. ` +
        `You can still attach a PDF later — accepting doesn't close that off.`,
      confirmLabel: 'Accept',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    setAccepting(true);
    try {
      const res = await documentsService.approveMetadata(selectedHeldIds);
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast({
        variant: 'success',
        title: `${res.count} document${res.count === 1 ? '' : 's'} accepted`,
        description: 'They will be included in the next extraction.',
      });
    } catch (err: any) {
      toast({ variant: 'error', title: 'Could not accept', description: err?.response?.data?.detail || err?.message || 'Please try again.' });
    } finally {
      setAccepting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size; // capture before state is cleared
    const confirmed = await confirm({
      title: 'Delete documents',
      description: `Delete ${count} document${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    setBulkDeleting(true);
    let failed = 0;

    // Limited-concurrency delete so a big selection doesn't fire 100 requests at once.
    const POOL = 5;
    const queue = Array.from(selectedIds);
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          await documentsService.delete(id);
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, worker));

    setBulkDeleting(false);
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['documents'] });
    if (failed > 0) {
      toast({ title: 'Partial failure', description: `${failed} document(s) could not be deleted`, variant: 'error' });
    } else {
      toast({ title: 'Deleted', description: `${count} document(s) deleted`, variant: 'success' });
    }
  };

  // Card label edit state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  // Manual study ID ("Jefferson 2026b") — a separate edit mode from labels
  // because it replaces the row's title rather than adding to its metadata.
  const [editingStudyIdFor, setEditingStudyIdFor] = useState<string | null>(null);
  const [studyIdDraft, setStudyIdDraft] = useState('');
  const [savingStudyId, setSavingStudyId] = useState(false);
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editLabelInput, setEditLabelInput] = useState('');
  const [savingLabels, setSavingLabels] = useState(false);

  const checkBackend = useCallback(async () => {
    const connected = await healthService.isBackendConnected();
    setBackendConnected(connected);
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || !selectedProject) return;
    setStagedFiles(prev => [
      ...prev,
      ...acceptedFiles.map(f => ({ file: f, labels: [], labelInput: '' }))
    ]);
  }, [selectedProject]);

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: uploading,
    // The hero card below is a click target for search, not upload — file
    // selection now happens only via its explicit "Upload files" button
    // (which calls openFileDialog()) or by dragging files onto the card.
    noClick: true,
  });

  // Staging: add label to specific file
  const addLabelToStaged = (index: number, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setStagedFiles(prev => prev.map((sf, i) => {
      if (i !== index || sf.labels.includes(trimmed)) return sf;
      return { ...sf, labels: [...sf.labels, trimmed], labelInput: '' };
    }));
  };

  // Staging: remove label from specific file
  const removeLabelFromStaged = (index: number, label: string) => {
    setStagedFiles(prev => prev.map((sf, i) => {
      if (i !== index) return sf;
      return { ...sf, labels: sf.labels.filter(l => l !== label) };
    }));
  };

  // Staging: apply label to all staged files
  const applyLabelToAll = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setStagedFiles(prev => prev.map(sf => ({
      ...sf,
      labels: sf.labels.includes(trimmed) ? sf.labels : [...sf.labels, trimmed],
    })));
    setApplyAllInput('');
  };

  // Staging: remove a staged file
  const removeStagedFile = (index: number) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Upload all staged files
  const handleUploadAll = async () => {
    if (!selectedProject || stagedFiles.length === 0) return;
    setUploading(true);
    const failedFiles: string[] = [];
    const successfulFileNames = new Set<string>();
    try {
      for (const staged of stagedFiles) {
        setUploadProgress(prev => ({ ...prev, [staged.file.name]: 0 }));
        try {
          await documentsService.upload({
            file: staged.file,
            projectId: selectedProject.id,
            labels: staged.labels,
            onUploadProgress: (progress) => {
              setUploadProgress(prev => ({ ...prev, [staged.file.name]: progress }));
            },
          });
          successfulFileNames.add(staged.file.name);
          toast({
            title: 'Success',
            description: `${staged.file.name} uploaded successfully`,
            variant: 'success',
          });
        } catch (error: any) {
          failedFiles.push(staged.file.name);
          const errorMessage = typeof error.response?.data?.detail === 'string'
            ? error.response.data.detail
            : `Failed to upload ${staged.file.name}`;
          toast({ title: 'Upload Failed', description: errorMessage, variant: 'error' });
        }
      }
      setStagedFiles(prev => prev.filter(sf => !successfulFileNames.has(sf.file.name)));
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  };

  const handleDelete = async (documentId: string, filename: string) => {
    const confirmed = await confirm({
      title: 'Delete document',
      description: `Are you sure you want to delete "${filename}"?`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    try {
      await documentsService.delete(documentId);
      toast({ title: 'Success', description: 'Document deleted successfully', variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to delete document';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
    }
  };

  const handleReprocess = async (documentId: string) => {
    setReprocessingId(documentId);
    try {
      await documentsService.reprocess(documentId);
      toast({ title: 'Reprocessing started', description: 'The document will be reprocessed shortly.', variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to start reprocessing';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
    } finally {
      setReprocessingId(null);
    }
  };

  const handleOpenPdf = async (documentId: string, processingStatus: string) => {
    if (processingStatus !== 'completed') return;
    try {
      const url = await documentsService.getDownloadUrl(documentId);
      window.open(url, '_blank');
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to open document', variant: 'error' });
    }
  };

  const handleDownload = async (documentId: string, filename: string) => {
    try {
      const url = await documentsService.getDownloadUrl(documentId);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      console.error('[Download] Error:', error?.response?.data || error?.message || error);
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to download document';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
    }
  };

  const startEditStudyId = (doc: Document) => {
    setEditingStudyIdFor(doc.id);
    // Seed with what the row currently shows, so "Polat 2005" -> "Polat 2005b"
    // is a two-keystroke edit rather than retyping the whole ID.
    setStudyIdDraft(doc.study_label || docLabels[doc.id] || '');
  };

  const saveStudyId = async (docId: string) => {
    setSavingStudyId(true);
    try {
      // Empty clears the override and hands the label back to author + year.
      await documentsService.updateStudyLabel(docId, studyIdDraft.trim() || null);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      setEditingStudyIdFor(null);
      setStudyIdDraft('');
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to update study ID';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
    } finally {
      setSavingStudyId(false);
    }
  };

  const startEditLabels = (doc: Document) => {
    setEditingDocId(doc.id);
    setEditLabels(doc.labels || []);
    setEditLabelInput('');
  };

  const cancelEditLabels = () => {
    setEditingDocId(null);
    setEditLabels([]);
    setEditLabelInput('');
  };

  const addEditLabel = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || editLabels.includes(trimmed)) return;
    setEditLabels(prev => [...prev, trimmed]);
    setEditLabelInput('');
  };

  const removeEditLabel = (label: string) => {
    setEditLabels(prev => prev.filter(l => l !== label));
  };

  const saveEditLabels = async (docId: string) => {
    setSavingLabels(true);
    // Auto-commit any text still sitting in the input (user typed but didn't press Enter)
    const finalLabels = editLabelInput.trim() && !editLabels.includes(editLabelInput.trim())
      ? [...editLabels, editLabelInput.trim()]
      : editLabels;
    setEditLabelInput('');
    try {
      await documentsService.updateLabels(docId, finalLabels);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      setEditingDocId(null);
      setEditLabels([]);
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to update labels';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
    } finally {
      setSavingLabels(false);
    }
  };

  // Labels collapse past this count behind a "+N" toggle — the design's answer to
  // a row with 7 labels wrecking the layout. Per-row, keyed by document id.
  const [expandedLabels, setExpandedLabels] = useState<Record<string, boolean>>({});
  const toggleLabels = (id: string) =>
    setExpandedLabels(prev => ({ ...prev, [id]: !prev[id] }));

  if (!selectedProject) {
    return (
      <DashboardLayout title="Documents" description="Upload and manage your research papers">
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to manage documents."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Documents"
      description="Upload and manage your research papers"
    >
      <div className="space-y-6">
        {/* Permission Gate */}
        {selectedProject && !can_view_docs && (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">You do not have permission to view documents in this project.</p>
          </div>
        )}

        {/* Backend Connection Status */}
        {can_view_docs && backendConnected === false && (
          <Alert
            variant="error"
            title="Backend Server Not Running"
            description="The API server is not accessible. Please start the backend to upload documents."
          >
            <div className={cn(typography.code.default, 'bg-red-100 dark:bg-red-900/20 rounded p-3 text-red-900 dark:text-red-400 space-y-1 mt-3')}>
              <p className="font-semibold mb-1">Quick Start Commands:</p>
              <p>cd backend</p>
              <p>python -m app.main</p>
            </div>
            <Button variant="secondary" size="sm" onClick={checkBackend} className="mt-3">
              Retry Connection
            </Button>
          </Alert>
        )}

        {selectedProject && can_view_docs && (
          <>
            {/* Evidence search hero — search entry point (opens LiteratureSearchDrawer)
                doubling as the file-upload drop target (Upload files button / drag-drop). */}
            <div
              {...getRootProps()}
              className={cn(
                // No overflow-hidden here — the scope dropdown menu below is
                // absolutely-positioned and needs to render OUTSIDE this
                // card's box; clipping it was cutting off "PubMed" (the
                // last/lowest option). The gradient/rounded corners don't
                // need overflow-hidden to render correctly on their own.
                "relative rounded-2xl px-6 py-6 sm:px-8 sm:py-7 bg-gradient-to-br from-[#0d1526] via-[#141d35] to-[#1c2b4d] transition-shadow",
                isDragActive && "ring-2 ring-blue-400",
                uploading && "opacity-60"
              )}
            >
              {can_upload_docs && <input {...getInputProps()} />}

              <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                <div>
                  <div className="text-[11px] font-bold tracking-wider text-blue-400 uppercase mb-1">
                    Evidence search
                  </div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Find trials &amp; literature
                  </h2>
                </div>
                {can_upload_docs && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openFileDialog(); }}
                      disabled={uploading}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-3.5 py-2 backdrop-blur-sm transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4" />
                      Upload files
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={uploading}
                          aria-label="More import options"
                          className="w-9 h-9 flex items-center justify-center text-white bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg backdrop-blur-sm transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEndnoteOpen(true)}>
                          <BookMarked className="w-3.5 h-3.5" />
                          Import from EndNote
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCitationOpen(true)}>
                          <FileText className="w-3.5 h-3.5" />
                          Import RIS / DOIs
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-2.5 mb-4">
                <Search className="w-4 h-4 text-blue-400 shrink-0" />
                <input
                  type="text"
                  value={heroQuery}
                  onChange={(e) => setHeroQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setImportDrawerOpen(true);
                  }}
                  placeholder="Condition, drug, NCT ID or PMID..."
                  className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-blue-200/40 outline-none"
                />
                <div ref={scopeMenuRef} className="relative shrink-0">
                  <button
                    onClick={() => setScopeMenuOpen((o) => !o)}
                    className="flex items-center gap-1 text-[12px] font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg px-3 py-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {SCOPE_LABELS[searchScope]}
                    <ChevronDown className="w-3.5 h-3.5 text-blue-200/60" />
                  </button>

                  {scopeMenuOpen && (
                    <div className="absolute top-full right-0 mt-1.5 w-48 bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#2a2a2a] rounded-lg shadow-lg z-40 overflow-hidden py-1">
                      {SCOPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setSearchScope(opt.value);
                            setScopeMenuOpen(false);
                            // Just sets the default scope for next time — does NOT open the
                            // drawer. Forcing navigation here was the reported bug: picking a
                            // scope preference shouldn't act like clicking "Search".
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-3.5 py-2 text-[12.5px] font-medium text-left cursor-pointer transition-colors',
                            searchScope === opt.value
                              ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                              : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1f1f1f]',
                          )}
                        >
                          {opt.label}
                          {searchScope === opt.value && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setImportDrawerOpen(true)}
                  className="inline-flex items-center px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer transition-colors shrink-0"
                >
                  Search
                </button>
              </div>

              <div className="flex items-center gap-5 text-xs text-blue-200/50 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  ClinicalTrials.gov <span className="text-blue-200/30">&middot;</span> 480k+ studies
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  PubMed <span className="text-blue-200/30">&middot;</span> 36M+ articles
                </span>
              </div>

              {isDragActive && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#0d1526]/90 backdrop-blur-sm">
                  <p className="text-sm font-semibold text-white">Drop PDFs to upload</p>
                </div>
              )}
            </div>

            {/* Staging Area */}
            {stagedFiles.length > 0 && (
              <div className="border border-gray-200 dark:border-[#2a2a2a] rounded-xl overflow-hidden">
                {/* Staging header */}
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-[#161616] border-b border-gray-200 dark:border-[#2a2a2a]">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Ready to Upload ({stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStagedFiles([])}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={handleUploadAll}
                      disabled={uploading}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Upload All
                    </button>
                  </div>
                </div>

                {/* Apply to all */}
                <div className="px-5 py-3 border-b border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-400 flex-shrink-0">Apply to all:</span>
                    <input
                      type="text"
                      value={applyAllInput}
                      onChange={e => setApplyAllInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { applyLabelToAll(applyAllInput); } }}
                      placeholder="Type label and press Enter"
                      className="flex-1 text-xs bg-transparent text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none"
                    />
                  </div>
                </div>

                {/* Per-file rows */}
                <div className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
                  {stagedFiles.map((sf, index) => (
                    <div key={index} className="px-5 py-3 bg-white dark:bg-[#111111] flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{sf.file.name}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(sf.file.size)}</span>
                        </div>
                        {/* Upload progress */}
                        {uploading && uploadProgress[sf.file.name] !== undefined && (
                          <div className="mb-1.5">
                            <div className="w-full bg-gray-200 dark:bg-[#1a1a1a] rounded-full h-1.5">
                              <div
                                className="bg-gray-900 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${uploadProgress[sf.file.name]}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {/* Label chips + input */}
                        <div className="flex items-center flex-wrap gap-1.5">
                          {sf.labels.map(label => (
                            <LabelChip key={label} label={label} onRemove={() => removeLabelFromStaged(index, label)} />
                          ))}
                          <input
                            type="text"
                            value={sf.labelInput}
                            onChange={e => setStagedFiles(prev => prev.map((s, i) => i === index ? { ...s, labelInput: e.target.value } : s))}
                            onKeyDown={e => { if (e.key === 'Enter') addLabelToStaged(index, sf.labelInput); }}
                            placeholder="Add label..."
                            className="text-[11px] text-gray-600 dark:text-gray-400 placeholder:text-gray-300 dark:placeholder:text-gray-600 bg-transparent outline-none w-24"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeStagedFile(index)}
                        aria-label="Remove file"
                        className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 transition-colors mt-0.5"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents List */}
            <div>
              {/* Header + Search */}
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  {documents.length > 0 && canSelectDocs && (
                    <input
                      type="checkbox"
                      aria-label="Select all documents"
                      checked={documents.length > 0 && selectedIds.size === documents.length}
                      ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < documents.length; }}
                      onChange={toggleSelectAll}
                      className="doc-checkbox"
                    />
                  )}
                  <span className={cn(typography.sectionHeader.default, 'text-gray-400')}>
                    Uploaded Documents
                  </span>
                  <span className={cn(typography.body.tiny, 'text-gray-300 dark:text-zinc-600')}>
                    {/* "N of M" while searching, so the number is never mistaken
                        for the size of the project. */}
                    {isSearching ? `${documents.length} of ${allDocuments.length}` : documents.length}
                  </span>
                  {selectedHeldIds.length > 0 && can_upload_docs && (
                    <button
                      onClick={handleBulkAccept}
                      disabled={accepting}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50"
                    >
                      {accepting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Accept {selectedHeldIds.length} for extraction
                    </button>
                  )}
                  {selectedIds.size > 0 && canDeleteDocs && (
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                    >
                      {bulkDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Delete {selectedIds.size} selected
                    </button>
                  )}
                  {allSelected && can_view_docs && (
                    <>
                      <button
                        onClick={() => handleDownloadAll('pdf')}
                        disabled={zipDownloading !== null}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-800/40 border border-gray-200 dark:border-zinc-700 px-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                      >
                        {zipDownloading === 'pdf' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        Download all PDFs
                      </button>
                      <button
                        onClick={() => handleDownloadAll('md')}
                        disabled={zipDownloading !== null}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-800/40 border border-gray-200 dark:border-zinc-700 px-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                      >
                        {zipDownloading === 'md' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        Download all MDs
                      </button>
                    </>
                  )}
                </div>
                {(documents.length > 0 || searchQuery) && (
                  <div className="relative">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                    </svg>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search documents or labels..."
                      className="text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 w-64"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                  {/* Evidence-gate tabs. Always rendered for every project — the
                      counts are the point, so "Needs attention 0" is a useful
                      answer, not an empty surface worth hiding. */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-1">
                    {([
                      { key: 'all' as const, label: 'All', n: documents.length },
                      { key: 'ready' as const, label: 'Ready', n: documents.length - heldBack.length },
                      { key: 'attn' as const, label: 'Needs attention', n: heldBack.length },
                    ]).map(({ key, label, n }) => (
                      <button
                        key={key}
                        onClick={() => setDocTab(key)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                          docTab === key
                            ? key === 'attn'
                              ? 'border-amber-400 bg-amber-400 text-amber-950'
                              : 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black'
                            : 'border-gray-200 bg-transparent text-gray-500 hover:text-gray-700 dark:border-[#1f1f1f] dark:text-zinc-400 dark:hover:text-zinc-200',
                          key === 'attn' && n === 0 && docTab !== 'attn' && 'opacity-60',
                        )}
                      >
                        {key === 'attn' && docTab !== 'attn' && n > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        )}
                        {label} <span className="tabular-nums opacity-65">{n}</span>
                      </button>
                    ))}
                  </div>

                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : documents.length === 0 && !searchQuery ? (
                    <div className="py-6">
                      <EmptyState
                        icon={FileText}
                        title="No documents yet"
                        description="Upload your first PDF to get started"
                        className="border-0"
                      />
                    </div>
                  ) : documents.length === 0 && searchQuery ? (
                    <div className="text-center py-10 text-sm text-gray-400">No documents matching &ldquo;{searchQuery}&rdquo;</div>
                  ) : (
                  <>
                  {/* Never silently skip: say so before the run, not after. */}
                  {docTab !== 'attn' && heldBackAll.length > 0 && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div>
                        <span className="font-semibold">
                          {heldBackAll.length} document{heldBackAll.length === 1 ? '' : 's'} will be skipped by the next extraction.
                        </span>{' '}
                        {/* Two different remedies hide behind one amber state:
                            needs_pdf can ONLY be fixed by attaching a PDF (the
                            accept endpoint rejects it — documents.py restricts
                            eligibility to metadata_only), while metadata_only is
                            fixed by accepting. Saying "haven't been accepted" for
                            both sent people looking for a button that isn't there. */}
                        {(() => {
                          const needPdf = heldBackAll.filter(d => d.processing_status === 'needs_pdf').length;
                          const needAccept = heldBackAll.length - needPdf;
                          const parts: string[] = [];
                          if (needAccept) parts.push(`${needAccept} ${needAccept === 1 ? 'has' : 'have'} thin evidence awaiting acceptance`);
                          if (needPdf) parts.push(`${needPdf} ${needPdf === 1 ? 'needs' : 'need'} a PDF attached`);
                          return `${parts.join('; ')}.`;
                        })()}{' '}
                        <button
                          onClick={() => setDocTab('attn')}
                          className="font-semibold underline underline-offset-2 hover:no-underline"
                        >
                          Review them
                        </button>
                      </div>
                    </div>
                  )}

                  {visibleDocs.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400 dark:border-[#1f1f1f]">
                      {docTab === 'ready' ? (
                        <>
                          <div className="mb-1 font-semibold text-gray-600 dark:text-zinc-300">No documents are extraction-ready</div>
                          Every document still needs full text or acceptance.
                        </>
                      ) : (
                        <>
                          <div className="mb-1 font-semibold text-gray-600 dark:text-zinc-300">Nothing needs attention</div>
                          Every document has full text, or has been accepted.
                        </>
                      )}
                    </div>
                  )}

                  {visibleDocs.map((doc) => {
                    // getStatusStyle used to live here: it computed a `textCls`
                    // nothing ever read, and its default branch would have shown a
                    // raw enum string ("needs_pdf") as a user-facing label. docGate
                    // replaces it.
                    const gate = docGate(doc);
                    const source = sourceChip(doc);
                    const isDuplicate = !!doc.doi && duplicateDois.has(`${doc.project_id}::${doc.doi}`);
                    const isEditing = editingDocId === doc.id;
                    // The row's title is the study ID ("Raslan 2021"), not the
                    // filename — which for an EndNote/RIS import is the full
                    // article title. The filename stays reachable as the tooltip.
                    const titleText = docLabels[doc.id] || doc.filename.replace(/\.pdf$/i, '');
                    const isEditingStudyId = editingStudyIdFor === doc.id;
                    // The paper's own title, shown as content below the citation.
                    // Falls back to the filename when no title was ever resolved —
                    // but only when that adds something: for "Raslan 2021.pdf" the
                    // filename IS the citation, and echoing it twice is noise.
                    const filenameStem = doc.filename.replace(/\.pdf$/i, '');
                    const paperTitle = doc.title || (filenameStem !== titleText ? filenameStem : null);
                    const allLabels = doc.labels || [];
                    const labelsExpanded = !!expandedLabels[doc.id];
                    const shownLabels = labelsExpanded ? allLabels : allLabels.slice(0, MAX_VISIBLE_LABELS);
                    const hiddenLabelCount = allLabels.length - shownLabels.length;

                    return (
                      <div
                        key={doc.id}
                        className={cn(
                          // items-start + minmax(0,1fr) per the design's grid. The left
                          // accent border is ALWAYS 3px so a status colour appearing never
                          // shifts the row. It is NOT `border-l-transparent`: twMerge treats
                          // border-l-* and border-* as the same conflict group, so the
                          // border-gray-200 below silently deleted it and every plain row
                          // already had a grey 3px edge. Stating that colour honestly.
                          "relative hover:z-20 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-5 rounded-xl border border-l-[3px] border-l-gray-200 dark:border-l-[#1f1f1f] bg-white dark:bg-[#111111] px-3 sm:px-4 py-4 transition-all duration-150 group",
                          selectedIds.has(doc.id)
                            ? "border-gray-300 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a]"
                            : "border-gray-200 dark:border-[#1f1f1f] hover:shadow-card-hover hover:-translate-y-px hover:border-gray-300 dark:hover:border-[#2a2a2a]",
                          // Two stripes, and only two: a human must act, or it failed.
                          // `processing`/`pending` lost theirs — a transient state that
                          // resolves itself hasn't earned a permanent structural marker.
                          // `accepted` lost its emerald stripe: settled is not scannable news.
                          //
                          // Each re-asserts its own hover:border-l-*, because the
                          // hover:border-gray-300 above is an all-sides shorthand with higher
                          // specificity — without this, hovering any row wiped its stripe to
                          // grey. Same guard as forms/page.tsx.
                          needsAttention(doc) &&
                            "border-l-amber-400 dark:border-l-amber-500 hover:border-l-amber-400 dark:hover:border-l-amber-500 cursor-pointer",
                          doc.processing_status === 'failed' &&
                            "border-l-red-400 dark:border-l-red-500 hover:border-l-red-400 dark:hover:border-l-red-500",
                          doc.processing_status === 'completed' && "cursor-pointer"
                        )}
                        onClick={() => {
                          // A metadata-only import (EndNote/RIS) with no PDF yet — open the
                          // imported-record drawer, exactly like a no-PDF PubMed row. It shows
                          // the stored metadata, DOI/publisher links to go find the paper, and
                          // an Attach PDF button. This used to jump straight to a file picker,
                          // which asked for a PDF without telling you which paper it wanted.
                          if (doc.processing_status === 'needs_pdf') {
                            setViewingTrialDoc(doc);
                            return;
                          }
                          // Predicate is "is there a PDF to open?", NOT a list of source
                          // types. The old enumeration missed RIS-with-PMC-full-text rows
                          // (completed, no PDF, source 'ris'), which fell through and asked
                          // handleOpenPdf for a file that doesn't exist.
                          if (!doc.s3_pdf_path) {
                            setViewingTrialDoc(doc);
                            return;
                          }
                          handleOpenPdf(doc.id, doc.processing_status);
                        }}
                      >
                        {/* Checkbox — nudged to sit on the title's first line now
                            that the grid is items-start (design: margin-top 3px). */}
                        <div className="relative mt-[3px]">
                          {canSelectDocs && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${titleText}`}
                              checked={selectedIds.has(doc.id)}
                              onChange={() => toggleSelect(doc.id)}
                              onClick={e => e.stopPropagation()}
                              className="doc-checkbox"
                            />
                          )}
                        </div>

                        {/* Title + metadata + labels, with ghost ref number trailing the whole block */}
                        <div className="min-w-0 flex-1 flex items-center gap-4">
                          <div className="min-w-0 flex-1">
                          {/* Title line carries the title and nothing else. The three
                              source badges that used to sit here (CLINICAL TRIAL / PUBMED /
                              RIS, in three different colours) moved to the meta row as a
                              single neutral provenance chip — provenance is a fact, not an
                              action, so it competed with the states that are.
                              No truncate: the full filename wraps, text-wrap:pretty
                              balances the last line. */}
                          {/* LINE 1 — the citation, and the chips that qualify it.
                              The badges used to sit below the title; they belong on
                              this line because they qualify the STUDY ("this one is
                              a reference, imported from EndNote, and looks like a
                              duplicate"), and the line below is now the paper's own
                              words. Dates and identifiers stay at the bottom: those
                              are lookups, not scanning. */}
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                            {isEditingStudyId ? (
                              <input
                                autoFocus
                                value={studyIdDraft}
                                disabled={savingStudyId}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setStudyIdDraft(e.target.value)}
                                onKeyDown={e => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') saveStudyId(doc.id);
                                  if (e.key === 'Escape') { setEditingStudyIdFor(null); setStudyIdDraft(''); }
                                }}
                                onBlur={() => saveStudyId(doc.id)}
                                placeholder="Author Year — e.g. Jefferson 2026b"
                                className="relative z-10 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white"
                              />
                            ) : (
                              <span className={cn(typography.cardTitle.small, "relative z-10 min-w-0 shrink-0 tracking-tight text-gray-900 dark:text-white")}>
                                {titleText}
                              </span>
                            )}

                            {/* 1 — the row's single status badge, and the only colour on it */}
                            {gate && (
                              <Tooltip content={gate.tooltip}>
                                <Badge variant={gate.variant} className="shrink-0">
                                  {gate.pulse && (
                                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
                                  )}
                                  {gate.label}
                                </Badge>
                              </Tooltip>
                            )}

                            {/* 2 — provenance, but only when it's news. A plain
                                upload gets no chip: that's the default, and a chip
                                on 94% of rows is noise, not information. */}
                            {source && (source.href ? (
                              <a
                                href={source.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="shrink-0"
                              >
                                <Badge variant="neutral" className="cursor-pointer transition-opacity hover:opacity-70">
                                  <source.Icon className="h-3 w-3 shrink-0" />
                                  {source.label}
                                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                </Badge>
                              </a>
                            ) : (
                              <Badge variant="neutral" className="shrink-0">
                                <source.Icon className="h-3 w-3 shrink-0" />
                                {source.label}
                              </Badge>
                            ))}

                            {/* 3 — duplicate: an icon, not a chip. It's a hint about
                                identity, not an action, and it's often a false positive
                                (an author manuscript and the published version legitimately
                                share a DOI), so it shouldn't shout like a state does. */}
                            {isDuplicate && (
                              <Tooltip content="Another document in this project shares this DOI">
                                <Copy className="h-3 w-3 shrink-0 text-amber-500" />
                              </Tooltip>
                            )}

                            {/* 4 — user vocabulary */}
                            {!isEditing && shownLabels.map(label => (
                              <LabelChip key={label} label={label} />
                            ))}
                            {!isEditing && hiddenLabelCount > 0 && (
                              <Tooltip
                                content={allLabels.slice(MAX_VISIBLE_LABELS).join(', ')}
                                className="max-w-xs whitespace-normal"
                              >
                                <button
                                  onClick={e => { e.stopPropagation(); toggleLabels(doc.id); }}
                                  className="shrink-0 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium leading-5 text-gray-600 transition-colors hover:bg-gray-100 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1f1f1f]"
                                >
                                  +{hiddenLabelCount}
                                </button>
                              </Tooltip>
                            )}
                            {!isEditing && labelsExpanded && allLabels.length > MAX_VISIBLE_LABELS && (
                              <button
                                onClick={e => { e.stopPropagation(); toggleLabels(doc.id); }}
                                className="shrink-0 px-1 py-0.5 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                              >
                                Less
                              </button>
                            )}
                          </div>

                          {/* LINE 2 — the paper's own title, as readable text.
                              It is CONTENT, not a tooltip: a reviewer deciding whether
                              this is the right study reads the title, and a title you
                              have to hover to see cannot be scanned down a list of 80
                              rows. Clamped to two lines so a 40-word trial title can't
                              push every other row off the screen; click unfolds it in
                              place. `[&>span]` is not used — the clamp needs to apply
                              to the element that holds the text.
                              Rendered as a <button> so it is reachable by keyboard and
                              announced as expandable, and stopPropagation keeps the
                              click off the row's own open-the-PDF handler. */}
                          {/* LINE 2 — the paper's own title, in full.
                              NOT clamped. A two-line clamp cut these mid-phrase
                              ("...a multicenter, two-stage..."), which reads as a
                              broken sentence rather than a shortened one — and the
                              corpus gives no way to cut them well: only 25% of the
                              178 stored titles have a colon to split on, and 26 have
                              no natural break before the limit at all. Measured
                              rather than assumed: the longest title in the corpus is
                              249 characters, four lines at this measure, so showing
                              every title in full costs less height than the ellipsis
                              cost in readability.
                              max-w-[78ch] keeps the line length readable; without it
                              a full-width row runs ~140 characters per line. */}
                          {paperTitle && (
                            <p className="relative z-10 mt-1 min-w-0 max-w-[78ch] text-sm font-normal leading-6 tracking-[-0.005em] text-gray-600 dark:text-zinc-400 [text-wrap:pretty]">
                              {paperTitle}
                            </p>
                          )}

                          {/* LINE 3 — identifiers and dates: a lookup, not a scan, so
                              they sit last and in the quietest type on the row. */}
                          <div className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-1.5 text-xs text-gray-400 dark:text-zinc-500">
                            {(doc.source_type === 'ctgov' ? doc.nct_id : doc.source_type === 'pubmed' ? doc.pmid : null) && (
                              <span className="min-w-0 truncate">
                                {doc.source_type === 'ctgov' ? doc.nct_id : `PMID ${doc.pmid}`}
                              </span>
                            )}
                            <span className="hidden whitespace-nowrap sm:inline">{formatDate(doc.created_at)}</span>
                            {/* One DOI link for every source (the two near-identical
                                branches differed only in a title attribute).
                                Shown IN FULL — a DOI is an identifier you copy or read
                                against another list, and half of one is useless. It was
                                briefly truncated here to stop a long DOI overflowing the
                                row; `break-all` solves that properly instead, letting it
                                wrap inside this flex-wrap row rather than pushing it wide.
                                Never re-add `truncate` or `whitespace-nowrap` here.
                                No tooltip: it used to carry the paper title, which is
                                now readable on the row above it. */}
                            {doc.source_type !== 'ctgov' && doc.doi && (
                              <a
                                href={`https://doi.org/${doc.doi}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="min-w-0 break-all font-mono hover:text-gray-600 hover:underline dark:hover:text-zinc-300"
                              >
                                doi:{doc.doi}
                              </a>
                            )}
                          </div>
                          {/* Label editing (read-only chips now render inline next to the title) */}
                          {isEditing && (
                            <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                              {/* Same chip as the read-only row and the staging list —
                                  a label shouldn't change appearance depending on which
                                  mode you're looking at it in. */}
                              {editLabels.map(label => (
                                <LabelChip key={label} label={label} onRemove={() => removeEditLabel(label)} />
                              ))}
                              <input
                                type="text"
                                value={editLabelInput}
                                onChange={e => setEditLabelInput(e.target.value)}
                                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') addEditLabel(editLabelInput); }}
                                onClick={e => e.stopPropagation()}
                                placeholder="Add label..."
                                autoFocus
                                className="text-[11px] text-gray-600 dark:text-gray-400 placeholder:text-gray-300 dark:placeholder:text-gray-600 bg-transparent outline-none w-24"
                              />
                              <button
                                onClick={e => { e.stopPropagation(); saveEditLabels(doc.id); }}
                                disabled={savingLabels}
                                className="text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-[#1f1f1f] px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-[#2a2a2a] transition-colors disabled:opacity-50"
                              >
                                {savingLabels ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); cancelEditLabels(); }}
                                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          </div>
                        </div>

                        {/* Actions */}
                        {/* self-center: the grid is items-start now, but the ghost
                            number and ⋯ stay vertically centred (design does the
                            same with align-self: center on both). */}
                        <div className="relative flex items-center gap-3 self-center" onClick={e => e.stopPropagation()}>
                          <span className="shrink-0 select-none font-serif italic leading-none text-3xl sm:text-6xl text-gray-200 dark:text-zinc-800">
                            {String(doc.ref_id).padStart(2, '0')}
                          </span>
                          {((can_upload_docs && doc.processing_status === 'failed') || (can_upload_docs && !isEditing) || canDeleteDocs) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors">
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {can_upload_docs && doc.processing_status === 'failed' && (
                                  <DropdownMenuItem onClick={() => handleReprocess(doc.id)} disabled={reprocessingId === doc.id}>
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    {reprocessingId === doc.id ? 'Retrying...' : 'Retry'}
                                  </DropdownMenuItem>
                                )}
                                {can_upload_docs && !isEditing && (
                                  <DropdownMenuItem onClick={() => startEditLabels(doc)}>
                                    <Tag className="w-3.5 h-3.5" />
                                    Edit labels
                                  </DropdownMenuItem>
                                )}
                                {/* The study ID is the one thing on this row a
                                    reviewer may legitimately want to overrule —
                                    two same-author-same-year studies need the
                                    a/b decision made by a person, not a sort. */}
                                {can_upload_docs && !isEditingStudyId && (
                                  <DropdownMenuItem onClick={() => startEditStudyId(doc)}>
                                    <Pencil className="w-3.5 h-3.5" />
                                    Edit study ID
                                  </DropdownMenuItem>
                                )}
                                {/* Per-document counterpart to the bulk button. Only
                                    where it can do something: a DOI that was never
                                    looked for, on a parsed document with a PDF to read. */}
                                {can_upload_docs && !doc.doi_source && doc.processing_status === 'completed' && doc.s3_pdf_path && (
                                  <DropdownMenuItem
                                    onClick={() => handleBackfillOneDoi(doc.id)}
                                    disabled={backfillingDoiId === doc.id}
                                  >
                                    <Search className="w-3.5 h-3.5" />
                                    {backfillingDoiId === doc.id ? 'Looking up…' : 'Find DOI'}
                                  </DropdownMenuItem>
                                )}
                                {canDeleteDocs && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem destructive onClick={() => handleDelete(doc.id, titleText)}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  </>
                  )}
                </div>
            </div>
          </>
        )}
      </div>
      {dialog}
      {selectedProject && (
        <LiteratureSearchDrawer
          open={importDrawerOpen}
          onClose={() => setImportDrawerOpen(false)}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          initialScope={searchScope}
          initialQuery={heroQuery}
        />
      )}
      <ImportedTrialDrawer
        open={!!viewingTrialDoc}
        onClose={() => setViewingTrialDoc(null)}
        source={
          viewingTrialDoc?.source_type === 'pubmed' ? 'pubmed'
            : viewingTrialDoc?.source_type === 'ctgov' ? 'ctgov'
            : viewingTrialDoc?.source_type === 'endnote' ? 'endnote'
            : viewingTrialDoc?.source_type === 'ris' ? 'ris'
            : null
        }
        recordId={
          viewingTrialDoc?.source_type === 'pubmed' ? (viewingTrialDoc?.pmid ?? null)
            : viewingTrialDoc?.source_type === 'ctgov' ? (viewingTrialDoc?.nct_id ?? null)
            // EndNote/RIS have no registry id — the DOI is the closest stable
            // handle, and it's what the drawer's header subtitle shows.
            : (viewingTrialDoc?.doi ?? null)
        }
        documentId={viewingTrialDoc?.id ?? null}
        approvable={
          viewingTrialDoc?.processing_status === 'metadata_only' &&
          !viewingTrialDoc?.metadata_extraction_approved &&
          // Was computed from status alone, so a viewer saw "Accept for
          // extraction" and got a 403 from the backend, which gates on
          // can_upload_docs.
          can_upload_docs
        }
        canAttachPdf={can_upload_docs}
      />
      {selectedProject && (
        <EndNoteImportDialog
          open={endnoteOpen}
          projectId={selectedProject.id}
          onClose={() => setEndnoteOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['documents'] })}
        />
      )}
      {selectedProject && (
        <CitationImportDialog
          open={citationOpen}
          projectId={selectedProject.id}
          onClose={() => setCitationOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['documents'] })}
        />
      )}
      {/* The "attach a PDF to a needs_pdf import" picker used to live here as a
          hidden input fired straight from the row click. needs_pdf rows now open
          ImportedTrialDrawer instead, which owns its own picker — so this input
          had no trigger left. */}
    </DashboardLayout>
  );
}
