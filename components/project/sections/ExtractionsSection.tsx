'use client';

import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface ExtractionsSectionProps {
  projectId: string;
  extractions: any[];
}

const statusPillClass: Record<string, string> = {
  Completed: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15',
  Running: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  Pending: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
  Failed: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-400/15',
};

const fmtStatus = (s: string) => {
  const map: Record<string, string> = {
    completed: 'Completed', done: 'Completed', running: 'Running',
    pending: 'Pending', failed: 'Failed',
  };
  return map[s] || s.charAt(0).toUpperCase() + s.slice(1);
};

function StatusPill({ status }: { status: string }) {
  const s = fmtStatus(status);
  return (
    <span className={cn(
      'inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap shrink-0',
      statusPillClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a]',
    )}>
      {s}
    </span>
  );
}

export function ExtractionsSection({ projectId, extractions }: ExtractionsSectionProps) {
  const router = useRouter();
  // allProjects so an archived project still resolves by id
  const { selectedProject, setSelectedProject, allProjects: projects } = useProject();

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
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No extractions yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Run an extraction to see results here</div>
        <button
          onClick={navigateToExtractions}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
        >
          <Play size={12} />
          Run Extraction
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">
          {extractions.length} extraction{extractions.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={navigateToExtractions}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
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
              'group flex items-center justify-between py-3 px-2 -mx-2 rounded-md hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors',
              i < extractions.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f] rounded-none',
            )}
          >
            <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate pr-4">
              {e.form_name || e.name || `Extraction ${i + 1}`}
            </span>
            <StatusPill status={e.status || 'pending'} />
          </div>
        ))}
      </div>
    </div>
  );
}
