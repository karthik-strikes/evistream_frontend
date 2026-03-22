'use client';

import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Document } from '@/types/api';
import { getDraftStatus } from '../_hooks/useDraftAutoSave';

type DocStatus = 'done' | 'draft' | 'todo';

interface DocumentQueueSidebarProps {
  documents: Document[];
  currentDocId: string;
  doneDocs: Set<string>;
  formId: string;
  onSelectDoc: (doc: Document) => void;
}

function getDocStatus(doc: Document, doneDocs: Set<string>, formId: string): DocStatus {
  if (doneDocs.has(doc.id)) return 'done';
  if (getDraftStatus(formId, doc.id)) return 'draft';
  return 'todo';
}

const statusOrder: Record<DocStatus, number> = { todo: 0, draft: 1, done: 2 };

const statusBadge: Record<DocStatus, { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40' },
  draft: { label: 'Draft', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40' },
  todo: { label: 'Todo', cls: 'text-gray-500 dark:text-zinc-500 bg-gray-50 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]' },
};

export function DocumentQueueSidebar({ documents, currentDocId, doneDocs, formId, onSelectDoc }: DocumentQueueSidebarProps) {
  const docsWithStatus = documents
    .map(d => ({ doc: d, status: getDocStatus(d, doneDocs, formId) }))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const doneCount = docsWithStatus.filter(d => d.status === 'done').length;

  return (
    <div className="flex flex-col h-full border-r border-gray-100 dark:border-[#1f1f1f] bg-gray-50/40 dark:bg-[#0a0a0a]" style={{ width: 200 }}>
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Queue</p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{doneCount} / {documents.length} completed</p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 min-h-0">
        {docsWithStatus.map(({ doc, status }) => {
          const isCurrent = doc.id === currentDocId;
          const badge = statusBadge[status];
          return (
            <button
              key={doc.id}
              onClick={() => onSelectDoc(doc)}
              className={cn(
                "w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer border-none flex items-center gap-2",
                isCurrent
                  ? "bg-white dark:bg-[#1a1a1a] border-l-2 border-l-gray-900 dark:border-l-zinc-300 shadow-sm"
                  : "bg-transparent hover:bg-white dark:hover:bg-[#141414]"
              )}
            >
              <FileText className="w-3 h-3 text-gray-400 dark:text-zinc-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-700 dark:text-zinc-300 truncate">{doc.filename}</p>
              </div>
              <span className={cn("text-[9px] font-semibold px-1 py-0.5 rounded border flex-shrink-0", badge.cls)}>
                {badge.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
