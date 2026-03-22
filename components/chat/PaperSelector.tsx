import React, { useState } from 'react';
import { FileText, X, Plus, ChevronDown, Search, Layers } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import type { Document } from '@/types/api';
import { cn } from '@/lib/utils';

interface PaperSelectorProps {
  documents: Document[];
  selectedDocIds: string[];
  onToggle: (docId: string) => void;
  onClear: () => void;
}

export function PaperSelector({ documents, selectedDocIds, onToggle, onClear }: PaperSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedDocs = documents.filter(doc => selectedDocIds.includes(doc.id));
  const availableDocs = documents.filter(doc => !selectedDocIds.includes(doc.id));

  const filteredDocs = availableDocs.filter(doc =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="border-b border-gray-200 bg-white dark:border-[#222] dark:bg-[#0a0a0a] px-8 py-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
              <Layers className="h-3.5 w-3.5 text-gray-700" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Paper Context</h3>
              <p className="text-xs text-gray-500">
                {selectedDocIds.length === 0
                  ? 'No papers selected'
                  : `${selectedDocIds.length} paper${selectedDocIds.length > 1 ? 's' : ''} selected`
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedDocIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Clear All
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Papers
              <ChevronDown className={cn(
                'h-3 w-3 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )} />
            </Button>
          </div>
        </div>

        {selectedDocIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedDocs.map(doc => (
              <div
                key={doc.id}
                className="group flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-all duration-200 hover:border-gray-300"
              >
                <div className="w-6 h-6 rounded bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#333] flex items-center justify-center flex-shrink-0">
                  <FileText className="h-3 w-3 text-gray-600" />
                </div>
                <span className="max-w-[300px] truncate text-xs font-medium text-gray-700">
                  {doc.filename.replace('.pdf', '')}
                </span>
                <button
                  onClick={() => onToggle(doc.id)}
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-50 rounded"
                >
                  <X className="h-3 w-3 text-red-600" />
                </button>
              </div>
            ))}
          </div>
        )}

        {isExpanded && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 animate-reveal-fade-down">
            <div className="mb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search papers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filteredDocs.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-3">
                  {searchQuery ? 'No papers found' : 'All papers are already selected'}
                </p>
              ) : (
                filteredDocs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => {
                      onToggle(doc.id);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1a1a1a] flex items-center gap-2.5 transition-colors duration-150 group border border-transparent hover:border-gray-200"
                  >
                    <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#333] flex items-center justify-center flex-shrink-0 group-hover:border-gray-300 transition-all">
                      <FileText className="h-3.5 w-3.5 text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">
                        {doc.filename.replace('.pdf', '')}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Plus className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
