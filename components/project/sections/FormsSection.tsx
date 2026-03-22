'use client';

import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/contexts/ProjectContext';

interface FormsSectionProps {
  projectId: string;
  forms: any[];
}

const statusMap: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: 'Active', cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', dot: 'bg-green-500' },
  generating: { label: 'Generating', cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', dot: 'bg-blue-500' },
  awaiting_review: { label: 'Review', cls: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  draft: { label: 'Draft', cls: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]', dot: 'bg-gray-300 dark:bg-zinc-600' },
  failed: { label: 'Failed', cls: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', dot: 'bg-red-500' },
};

function StatusChip({ status }: { status: string }) {
  const s = statusMap[status] || statusMap.draft;
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0', s.cls)}>
      <span className={cn('w-[5px] h-[5px] rounded-full shrink-0', s.dot)} />
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
        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No forms yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Create a form to start extracting data</div>
        <button
          onClick={navigateToForms}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg py-2 px-4 hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          Create Form
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">{forms.length} form{forms.length !== 1 ? 's' : ''}</p>
        <button
          onClick={navigateToForms}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-zinc-300 bg-gray-100 dark:bg-[#1f1f1f] hover:bg-gray-200 dark:hover:bg-[#2a2a2a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
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
              'flex items-center justify-between py-3 px-1',
              i < forms.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f]',
            )}
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate block">{f.form_name}</span>
              {f.fields?.length > 0 && (
                <span className="text-xs text-gray-400 dark:text-zinc-600">{f.fields.length} fields</span>
              )}
            </div>
            <StatusChip status={f.status || 'active'} />
          </div>
        ))}
      </div>
    </div>
  );
}
