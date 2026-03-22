'use client';

import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface ExtractionsSectionProps {
  projectId: string;
  extractions: any[];
}

const statusChipClass: Record<string, string> = {
  Completed: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  Running: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  Pending: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  Failed: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

const statusDot: Record<string, string> = {
  Completed: 'bg-green-500',
  Running: 'bg-blue-500',
  Pending: 'bg-amber-400',
  Failed: 'bg-red-500',
};

const fmtStatus = (s: string) => {
  const map: Record<string, string> = {
    completed: 'Completed', done: 'Completed', running: 'Running',
    pending: 'Pending', failed: 'Failed',
  };
  return map[s] || s.charAt(0).toUpperCase() + s.slice(1);
};

function StatusChip({ status }: { status: string }) {
  const s = fmtStatus(status);
  return (
    <span className={cn(
      'flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0',
      statusChipClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]',
    )}>
      <span className={cn('w-[5px] h-[5px] rounded-full shrink-0', statusDot[s] || 'bg-gray-300 dark:bg-zinc-600')} />
      {s}
    </span>
  );
}

export function ExtractionsSection({ projectId, extractions }: ExtractionsSectionProps) {
  const router = useRouter();
  const { selectedProject, setSelectedProject, projects } = useProject();

  const navigateToExtractions = () => {
    const proj = projects.find((p: any) => p.id === projectId);
    if (proj && selectedProject?.id !== projectId) setSelectedProject(proj);
    router.push('/extractions');
  };

  if (extractions.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <Play size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No extractions yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Run an extraction to see results here</div>
        <button
          onClick={navigateToExtractions}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg py-2 px-4 hover:opacity-90 transition-opacity"
        >
          <Play size={14} />
          Run Extraction
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">{extractions.length} extraction{extractions.length !== 1 ? 's' : ''}</p>
        <button
          onClick={navigateToExtractions}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-zinc-300 bg-gray-100 dark:bg-[#1f1f1f] hover:bg-gray-200 dark:hover:bg-[#2a2a2a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
        >
          <Play size={12} />
          New Extraction
        </button>
      </div>
      <div className="space-y-0">
        {extractions.map((e: any, i: number) => (
          <div
            key={e.id}
            className={cn(
              'flex items-center justify-between py-3 px-1',
              i < extractions.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f]',
            )}
          >
            <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate pr-4">
              {e.form_name || e.name || `Extraction ${i + 1}`}
            </span>
            <StatusChip status={e.status || 'pending'} />
          </div>
        ))}
      </div>
    </div>
  );
}
