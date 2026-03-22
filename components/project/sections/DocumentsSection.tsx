'use client';

import { useRouter } from 'next/navigation';
import { FileCheck, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface DocumentsSectionProps {
  projectId: string;
  documents: any[];
}

const statusChipClass: Record<string, string> = {
  completed: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  processing: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  pending: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  failed: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

const statusDot: Record<string, string> = {
  completed: 'bg-green-500',
  processing: 'bg-blue-500',
  pending: 'bg-amber-400',
  failed: 'bg-red-500',
};

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <span className={cn(
      'flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0',
      statusChipClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]',
    )}>
      <span className={cn('w-[5px] h-[5px] rounded-full shrink-0', statusDot[s] || 'bg-gray-300 dark:bg-zinc-600')} />
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
        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No documents yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Upload documents to this project</div>
        <button
          onClick={navigateToDocuments}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg py-2 px-4 hover:opacity-90 transition-opacity"
        >
          <Upload size={14} />
          Upload Documents
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
        <button
          onClick={navigateToDocuments}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-zinc-300 bg-gray-100 dark:bg-[#1f1f1f] hover:bg-gray-200 dark:hover:bg-[#2a2a2a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
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
              'flex items-center justify-between py-3 px-1',
              i < documents.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f]',
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <FileCheck size={14} className="text-gray-300 dark:text-zinc-600 shrink-0" />
              <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate">{d.filename}</span>
            </div>
            <StatusChip status={d.processing_status || 'pending'} />
          </div>
        ))}
      </div>
    </div>
  );
}
