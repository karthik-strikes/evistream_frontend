'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useDropzone } from 'react-dropzone';
import { FileText, Upload, Trash2, Download, Loader2, AlertCircle, CheckCircle, Clock, Pencil, X, Tag, FolderOpen } from 'lucide-react';
import { Button, Card, Alert, EmptyState, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { documentsService, healthService } from '@/services';
import type { Document } from '@/types/api';
import { formatBytes, formatDate, cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useRouter } from 'next/navigation';
import { typography } from '@/lib/typography';

interface StagedFile {
  file: File;
  labels: string[];
  labelInput: string;
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const { selectedProject } = useProject();
  const { can_upload_docs, can_view_docs } = useProjectPermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', selectedProject?.id, searchQuery],
    queryFn: () => documentsService.getAll(selectedProject!.id, searchQuery),
    enabled: !!selectedProject,
  });

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Staging state
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [applyAllInput, setApplyAllInput] = useState('');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [zipDownloading, setZipDownloading] = useState<'pdf' | 'md' | null>(null);

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

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size; // capture before state is cleared
    if (!confirm(`Delete ${count} document${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await documentsService.delete(id);
      } catch {
        failed++;
      }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
    if (failed > 0) {
      toast({ title: 'Partial failure', description: `${failed} document(s) could not be deleted`, variant: 'error' });
    } else {
      toast({ title: 'Deleted', description: `${count} document(s) deleted`, variant: 'success' });
    }
  };

  // Card label edit state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: uploading,
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
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  };

  const handleDelete = async (documentId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      await documentsService.delete(documentId);
      toast({ title: 'Success', description: 'Document deleted successfully', variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to delete document';
      toast({ title: 'Error', description: errorMessage, variant: 'error' });
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
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
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

  const labelColor = (l: string) => {
    const palette = [
      "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
      "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    ];
    let h = 0; for (const c of l) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  };

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
            {/* Drop Zone */}
            {can_upload_docs && (
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-gray-400 bg-gray-50 dark:bg-[#1a1a1a] dark:border-[#3f3f3f]'
                    : 'border-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111]'
                } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input {...getInputProps()} />
                <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                {isDragActive ? (
                  <p className={cn(typography.dropzone.title, 'text-gray-900 dark:text-white')}>Drop here</p>
                ) : (
                  <div className="space-y-2">
                    <p className={cn(typography.dropzone.title, 'text-gray-900 dark:text-white')}>
                      Drag & drop files here
                    </p>
                    <p className={cn(typography.dropzone.subtitle, 'text-gray-400')}>
                      or click to browse
                    </p>
                  </div>
                )}
              </div>
            )}

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
                            <span
                              key={label}
                              className="inline-flex items-center gap-1 text-[11px] font-medium bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full"
                            >
                              {label}
                              <button
                                onClick={() => removeLabelFromStaged(index, label)}
                                className="text-gray-400 hover:text-gray-600 leading-none"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
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
                  {documents.length > 0 && can_upload_docs && (
                    <input
                      type="checkbox"
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
                    {documents.length}
                  </span>
                  {selectedIds.size > 0 && can_upload_docs && (
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
                <div className="flex flex-col gap-2.5">
                  {documents.map((doc) => {
                    const getStatusStyle = () => {
                      switch (doc.processing_status) {
                        case 'completed':
                          return { cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50', label: "Completed" };
                        case 'processing':
                          return { cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50', label: "Processing" };
                        case 'failed':
                          return { cls: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50', label: "Failed" };
                        case 'pending':
                          return { cls: 'text-gray-600 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]', label: "Pending" };
                        default:
                          return { cls: 'text-gray-600 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]', label: doc.processing_status };
                      }
                    };

                    const s = getStatusStyle();
                    const isEditing = editingDocId === doc.id;

                    return (
                      <div
                        key={doc.id}
                        className={cn("group bg-white rounded-xl border py-5 px-[22px] relative transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111]", selectedIds.has(doc.id) ? "border-gray-400 dark:border-[#3f3f3f]" : "border-border dark:border-[#1f1f1f]", doc.processing_status === 'completed' && "cursor-pointer")}
                        onClick={() => handleOpenPdf(doc.id, doc.processing_status)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          {/* Checkbox */}
                          {can_upload_docs && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(doc.id)}
                              onChange={() => toggleSelect(doc.id)}
                              onClick={e => e.stopPropagation()}
                              className="doc-checkbox mt-1"
                            />
                          )}
                          {/* PDF badge */}
                          <div className={cn(
                            "flex-shrink-0 w-9 h-11 rounded-md flex items-end justify-center pb-1 text-[9px] font-semibold font-mono border",
                            doc.processing_status === 'completed' && "bg-red-50 text-red-500 border-red-200/70 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/40",
                            doc.processing_status === 'processing' && "bg-blue-50 text-blue-500 border-blue-200/70 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/40",
                            doc.processing_status === 'failed' && "bg-purple-50 text-purple-500 border-purple-200/70 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/40",
                            (doc.processing_status === 'pending' || !doc.processing_status) && "bg-gray-100 text-gray-400 border-gray-200 dark:bg-[#1a1a1a] dark:border-[#2a2a2a]",
                          )}>PDF</div>
                          {/* Left: Filename, date, labels */}
                          <div className="flex-1 min-w-0">
                            {/* Filename + status inline */}
                            <div className="flex items-center gap-2.5 mb-1.5">
                              <h3 className="text-base font-semibold text-gray-900 m-0 tracking-tight leading-snug overflow-hidden text-ellipsis whitespace-nowrap dark:text-white">{doc.filename}</h3>
                              {doc.processing_status !== 'completed' && (
                                <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap inline-flex items-center', s.cls)}>
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
                                  {s.label}
                                </span>
                              )}
                            </div>
                            {/* Date */}
                            <div className="text-[11px] font-mono text-gray-400 dark:text-zinc-500 tracking-tight mb-2">
                              {formatDate(doc.created_at)}
                            </div>
                            {/* Labels display / edit */}
                            {!isEditing ? (
                              <div className="flex items-center flex-wrap gap-1.5">
                                {(doc.labels || []).map(label => (
                                  <span
                                    key={label}
                                    className={cn("inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md", labelColor(label))}
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                {editLabels.map(label => (
                                  <span
                                    key={label}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full"
                                  >
                                    {label}
                                    <button onClick={e => { e.stopPropagation(); removeEditLabel(label); }} className="text-gray-400 hover:text-gray-600 leading-none">
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}
                                <input
                                  type="text"
                                  value={editLabelInput}
                                  onChange={e => setEditLabelInput(e.target.value)}
                                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') addEditLabel(editLabelInput); }}
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

                          {/* Right: Action buttons */}
                          <div className="flex items-center flex-shrink-0 rounded-lg border border-gray-100 dark:border-[#2a2a2a] divide-x divide-gray-100 dark:divide-[#2a2a2a] overflow-hidden">
                            {can_upload_docs && !isEditing && (
                              <button
                                title="Edit labels"
                                onClick={e => { e.stopPropagation(); startEditLabels(doc); }}
                                className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-[#1f1f1f] transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {can_upload_docs && (
                              <button
                                title="Delete"
                                onClick={e => { e.stopPropagation(); handleDelete(doc.id, doc.filename); }}
                                className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
