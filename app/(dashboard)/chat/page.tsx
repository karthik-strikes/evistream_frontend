'use client';

import { useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout';
import { EmptyState, Button } from '@/components/ui';
import { PaperChat } from '@/components/chat/PaperChat';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/hooks/use-toast';
import { documentsService } from '@/services';
import type { Document } from '@/types/api';
import { Loader2, AlertCircle, FileUp, Layers, Plus, X, ChevronDown, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function ChatPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchDocuments = useCallback(async () => {
    if (!selectedProject) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await documentsService.getAll(selectedProject.id);
      const completedDocs = data.filter(doc => doc.processing_status === 'completed');
      setDocuments(completedDocs);
    } catch (error: any) {
      const errorMessage = typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Failed to fetch documents';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedProject, toast]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const toggleDocument = (docId: string) => {
    setSelectedDocIds(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const clearDocuments = () => {
    setSelectedDocIds([]);
  };

  const selectedDocs = documents.filter(doc => selectedDocIds.includes(doc.id));
  const availableDocs = documents.filter(doc => !selectedDocIds.includes(doc.id));
  const filteredDocs = availableDocs.filter(doc =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Paper selector component for header
  const paperSelectorAction = documents.length > 0 && (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2"
      >
        <span className="text-sm">
          {selectedDocIds.length === 0 ? 'Select Papers' : `${selectedDocIds.length} Selected`}
        </span>
        <ChevronDown className={cn(
          'h-3 w-3 transition-transform duration-200',
          isExpanded && 'rotate-180'
        )} />
      </Button>

      {isExpanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsExpanded(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg border border-gray-200 shadow-xl z-50 animate-reveal-fade-down">
            <div className="p-4">
              {selectedDocIds.length > 0 && (
                <div className="flex items-center justify-end mb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearDocuments}
                    className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 h-7"
                  >
                    Clear All
                  </Button>
                </div>
              )}

              {selectedDocIds.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selectedDocs.map(doc => (
                    <div
                      key={doc.id}
                      className="group flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs hover:bg-gray-100"
                    >
                      <span className="max-w-[200px] truncate font-medium text-gray-700">
                        {doc.filename.replace('.pdf', '')}
                      </span>
                      <button
                        onClick={() => toggleDocument(doc.id)}
                        className="opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3 text-gray-600" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-3">
                <Input
                  placeholder="Search papers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto">
                {filteredDocs.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">
                    {searchQuery ? 'No papers found' : 'All papers selected'}
                  </p>
                ) : (
                  filteredDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => {
                        toggleDocument(doc.id);
                        setSearchQuery('');
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {doc.filename.replace('.pdf', '')}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Plus className="h-3.5 w-3.5 text-gray-400 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (!selectedProject) {
    return (
      <DashboardLayout
        title="Paper Chat"
        description="Ask questions about your research papers"
      >
        <EmptyState
          icon={AlertCircle}
          title="No Project Selected"
          description="Please create or select a project to start chatting with your papers"
          action={{
            label: 'Go to Projects',
            onClick: () => router.push('/projects'),
          }}
        />
      </DashboardLayout>
    );
  }

  if (loading) {
    return (
      <DashboardLayout
        title="Paper Chat"
        description="Ask questions about your research papers"
      >
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (documents.length === 0) {
    return (
      <DashboardLayout
        title="Paper Chat"
        description="Ask questions about your research papers"
      >
        <EmptyState
          icon={FileUp}
          title="No Papers Available"
          description="Upload and process papers to start chatting with them"
          action={{
            label: 'Upload Papers',
            onClick: () => router.push('/documents'),
          }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Paper Chat"
      description={`Chat with ${documents.length} research paper${documents.length > 1 ? 's' : ''} using AI`}
      action={paperSelectorAction}
    >
      <div className="-mx-6 -mb-4 -mt-4 border-t border-gray-200">
        <PaperChat documents={documents} selectedDocIds={selectedDocIds} />
      </div>
    </DashboardLayout>
  );
}
