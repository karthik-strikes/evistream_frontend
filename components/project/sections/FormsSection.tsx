'use client';

import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface FormsSectionProps {
  projectId: string;
  forms: any[];
}

const statusMap: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15' },
  generating: { label: 'Generating', cls: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15' },
  awaiting_review: { label: 'Review', cls: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15' },
  draft: { label: 'Draft', cls: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a]' },
  failed: { label: 'Failed', cls: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-400/15' },
};

function StatusPill({ status }: { status: string }) {
  const s = statusMap[status] || statusMap.draft;
  return (
    <span className={cn('inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap shrink-0', s.cls)}>
      {s.label}
    </span>
  );
}

export function FormsSection({ projectId, forms }: FormsSectionProps) {
  const router = useRouter();
  const { selectedProject, setSelectedProject, projects } = useProject();

  const navigateToForms = () => {
    const proj = projects.find((p: any) => p.id === projectId);
    if (proj && selectedProject?.id !== projectId) setSelectedProject(proj);
    router.push('/forms');
  };

  if (forms.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <FileText size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No forms yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Create a form to start extracting data</div>
        <button
          onClick={navigateToForms}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          Create Form
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">
          {forms.length} form{forms.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={navigateToForms}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          New Form
        </button>
      </div>
      <div className="space-y-0">
        {forms.map((f: any, i: number) => (
          <div
            key={f.id}
            className={cn(
              'group flex items-center justify-between py-3 px-2 -mx-2 rounded-md hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors',
              i < forms.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f] rounded-none',
            )}
          >
            <div className="min-w-0 flex-1 pr-3">
              <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate block">{f.form_name}</span>
              {f.fields?.length > 0 && (
                <span className="text-[11px] text-gray-400 dark:text-zinc-600 tabular-nums">
                  {f.fields.length} field{f.fields.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <StatusPill status={f.status || 'active'} />
          </div>
        ))}
      </div>
    </div>
  );
}
