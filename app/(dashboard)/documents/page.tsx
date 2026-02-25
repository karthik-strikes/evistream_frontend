'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useDropzone } from 'react-dropzone';
import { FileText, Upload, Trash2, Download, Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Button, Card, Alert, EmptyState, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { documentsService, healthService } from '@/services';
import type { Document } from '@/types/api';
import { formatBytes, formatDate, cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';
import { useRouter } from 'next/navigation';
import { typography } from '@/lib/typography';

export default function DocumentsPage() {
  const { toast } = useToast();
  const { selectedProject } = useProject();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocs = searchQuery.trim()
    ? documents.filter((d) => d.filename?.toLowerCase().includes(searchQuery.toLowerCase()))
    : documents;
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Check backend health
  const checkBackend = useCallback(async () => {
    const connected = await healthService.isBackendConnected();
    setBackendConnected(connected);
  }, []);

  // Check backend on mount
  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || !selectedProject) return;

    setUploading(true);

    try {
      // Upload files sequentially
      for (const file of acceptedFiles) {
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

        await documentsService.upload({
          file,
          projectId: selectedProject.id,
          onUploadProgress: (progress) => {
            setUploadProgress(prev => ({ ...prev, [file.name]: progress }));
          },
        });

        toast({
          title: 'Success',
          description: `${file.name} uploaded successfully`,
          variant: 'success',
        });
      }

      // Refresh document list
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to upload documents';
      toast({
        title: 'Upload Failed',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  }, [toast, queryClient, selectedProject]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: uploading,
  });

  const handleDelete = async (documentId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      await documentsService.delete(documentId);
      toast({
        title: 'Success',
        description: 'Document deleted successfully',
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedProject?.id] });
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to delete document';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleDownload = async (documentId: string, filename: string) => {
    try {
      const blob = await documentsService.downloadPDF(documentId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to download document';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const getStatusIcon = (status: Document['processing_status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-zinc-700 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: Document['processing_status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-zinc-100 text-zinc-700';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <DashboardLayout
      title="Documents"
      description="Upload and manage your research papers"
    >
      <div className="space-y-6">
        {/* Backend Connection Status */}
        {backendConnected === false && (
          <Alert
            variant="error"
            title="Backend Server Not Running"
            description="The API server is not accessible. Please start the backend to upload documents."
          >
            <div className={cn(typography.code.default, 'bg-red-100 dark:bg-red-900/20 rounded p-3 text-red-900 dark:text-red-400 space-y-1 mt-3')}>
              <p className="font-semibold mb-1">Quick Start Commands:</p>
              <p>cd /nlp/data/karthik9/Sprint1/Dental/eviStream/backend</p>
              <p>python -m app.main</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={checkBackend}
              className="mt-3"
            >
              Retry Connection
            </Button>
          </Alert>
        )}

        {/* No Project Selected Warning */}
        {!selectedProject && (
          <EmptyState
            icon={AlertCircle}
            title="No Project Selected"
            description="Please create or select a project to manage documents"
            action={{
              label: 'Go to Projects',
              onClick: () => router.push('/projects'),
            }}
          />
        )}

        {/* Upload Area */}
        {selectedProject && (
        <>
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
          {uploading ? (
            <div className="space-y-2">
              <p className={typography.cardTitle.default}>Uploading...</p>
              {Object.entries(uploadProgress).map(([filename, progress]) => (
                <div key={filename} className="max-w-md mx-auto">
                  <p className={cn(typography.body.small, 'text-muted mb-1')}>{filename}</p>
                  <div className="w-full bg-gray-200 dark:bg-[#1a1a1a] rounded-full h-2">
                    <div
                      className="bg-gray-900 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : isDragActive ? (
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

        {/* Documents List */}
        <div>
          {/* Header + Search */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2">
              <span className={cn(typography.sectionHeader.default, 'text-gray-400')}>
                Uploaded Documents
              </span>
              <span className={cn(typography.body.tiny, 'text-gray-300 dark:text-zinc-600')}>
                {documents.length}
              </span>
            </div>
            {documents.length > 0 && (
              <div className="relative">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 w-56"
                />
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : documents.length === 0 ? (
            <div className="py-6">
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Upload your first PDF to get started"
                className="border-0"
              />
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">No documents matching &ldquo;{searchQuery}&rdquo;</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredDocs.map((doc) => {
                const getStatusStyle = () => {
                  switch (doc.processing_status) {
                    case 'completed':
                      return { cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50', label: "Completed" };
                    case 'processing':
                      return { cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50', label: "Processing" };
                    case 'failed':
                      return { cls: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50', label: "Failed" };
                    default:
                      return { cls: 'text-gray-600 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]', label: "Unknown" };
                  }
                };

                const s = getStatusStyle();

                return (
                  <div
                    key={doc.id}
                    className="bg-white rounded-xl border border-border py-5 px-[22px] relative transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Filename, date, status */}
                      <div className="flex-1 min-w-0">
                        {/* Filename + status inline */}
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <h3 className="text-base font-semibold text-gray-900 m-0 tracking-tight leading-snug overflow-hidden text-ellipsis whitespace-nowrap dark:text-white">{doc.filename}</h3>
                          {doc.processing_status !== 'completed' && (
                            <span
                              className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap', s.cls)}
                            >{s.label}</span>
                          )}
                        </div>
                        {/* Date */}
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {formatDate(doc.created_at)}
                        </div>
                      </div>

                      {/* Right: Action buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {doc.processing_status === 'completed' && (
                          <button
                            onClick={() => handleDownload(doc.id, doc.filename)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(doc.id, doc.filename)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-error-600 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-error-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
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
