'use client';

import { useRouter } from 'next/navigation';
import { FileCheck, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface DocumentsSectionProps {
  projectId: string;
  documents: any[];
}

const statusPillClass: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15',
  processing: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  pending: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
  failed: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-400/15',
};

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap shrink-0',
      statusPillClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a]',
    )}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

export function DocumentsSection({ projectId, documents }: DocumentsSectionProps) {
  const router = useRouter();
  const { selectedProject, setSelectedProject, projects } = useProject();

  const navigateToDocuments = () => {
    const proj = projects.find((p: any) => p.id === projectId);
    if (proj && selectedProject?.id !== projectId) setSelectedProject(proj);
    router.push('/documents');
  };

  if (documents.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <FileCheck size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No documents yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Upload documents to this project</div>
        <button
          onClick={navigateToDocuments}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
        >
          <Upload size={12} />
          Upload Documents
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={navigateToDocuments}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
        >
          <Upload size={12} />
          Upload
        </button>
      </div>
      <div className="space-y-0">
        {documents.map((d: any, i: number) => (
          <div
            key={d.id}
            className={cn(
              'group flex items-center justify-between py-3 px-2 -mx-2 rounded-md hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors',
              i < documents.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f] rounded-none',
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <FileCheck size={14} className="text-gray-300 dark:text-zinc-600 shrink-0" />
              <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate">{d.filename}</span>
            </div>
            <StatusPill status={d.processing_status || 'pending'} />
          </div>
        ))}
      </div>
    </div>
  );
}
