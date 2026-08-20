'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { resultsService, formsService, documentsService } from '@/services';
import { Spinner } from '@/components/ui';
import { Download, ChevronDown, Search, X, Check, ChevronsUpDown, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { docMatchesQuery, tagsAsText } from '@/lib/documentTags';
import type { ExtractionResult, Document } from '@/types/api';
import { buildLabelMap, documentLabel } from '@/lib/documentLabel';

type SourcePriority = 'best' | 'ai' | 'manual' | 'consensus';

function extractValue(data: any): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data === 'object' && !Array.isArray(data) && 'value' in data) {
    const v = data.value;
    return v === null || v === undefined ? '' : String(v).trim();
  }
  if (Array.isArray(data)) return data.length === 0 ? '' : JSON.stringify(data);
  return JSON.stringify(data);
}

function normalizeKeys(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith('.value')) {
      out[k.slice(0, -6)] = v;
    } else if (k.endsWith('.source_location') || k.endsWith('.source_text') || k.endsWith('.confidence') || k.endsWith('.reasoning')) {
      continue;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : data;
}

export function FinalDatasetView() {
  const { selectedProject } = useProject();
  const [selectedFormId, setSelectedFormId] = useState('');
  const [source, setSource] = useState<SourcePriority>('best');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  // Fetch forms
  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['forms-active', selectedProject?.id],
    queryFn: async () => {
      const all = await formsService.getAll(selectedProject!.id);
      return all.filter((f: any) => f.status === 'active');
    },
    enabled: !!selectedProject,
  });

  // Auto-select first form
  const formId = selectedFormId || forms[0]?.id || '';

  // Fetch all results for project + form
  const { data: allResults = [], isLoading: resultsLoading } = useQuery({
    queryKey: ['final-dataset', selectedProject?.id, formId],
    queryFn: () => resultsService.getAll({ projectId: selectedProject!.id, formId }),
    enabled: !!selectedProject && !!formId,
  });

  // Fetch the PROJECT's documents, not just the ones with results for this
  // form. Two reasons, and the first is a correctness bug: a study ID's a/b
  // suffix is a whole-project computation, so labelling only result-bearing
  // documents renders a bare "Mehlisch 2010" here and "Mehlisch 2010a" on
  // Documents. (It also replaces one request per document with one request,
  // and shares the cache with every other screen's ['documents', id] query.)
  const { data: docs = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });
  const docMap = useMemo(() => {
    const m: Record<string, Document> = {};
    docs.forEach(d => { m[d.id] = d; });
    return m;
  }, [docs]);

  // Group results by document, then by extraction_type
  const grouped = useMemo(() => {
    const map: Record<string, Record<string, Record<string, any>>> = {};
    for (const r of allResults) {
      if (!map[r.document_id]) map[r.document_id] = {};
      const type = r.extraction_type || 'ai';
      const normalized = type === 'ai' ? normalizeKeys(r.extracted_data) : r.extracted_data;
      // Keep latest per type
      if (!map[r.document_id][type]) {
        map[r.document_id][type] = normalized;
      }
    }
    return map;
  }, [allResults]);

  // Get all field names across all results
  const allFields = useMemo(() => {
    const fields = new Set<string>();
    for (const types of Object.values(grouped)) {
      for (const data of Object.values(types)) {
        Object.keys(data).forEach(k => fields.add(k));
      }
    }
    return Array.from(fields).sort();
  }, [grouped]);

  // Column reorder (Document column is fixed; only field columns can move)
  const colOrderKey = formId ? `final-dataset-col-order:${formId}` : null;
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  useEffect(() => {
    if (!colOrderKey) { setColumnOrder([]); return; }
    try {
      const raw = localStorage.getItem(colOrderKey);
      setColumnOrder(raw ? JSON.parse(raw) : []);
    } catch { setColumnOrder([]); }
  }, [colOrderKey]);
  useEffect(() => {
    if (!colOrderKey) return;
    try { localStorage.setItem(colOrderKey, JSON.stringify(columnOrder)); } catch {}
  }, [columnOrder, colOrderKey]);
  const draggedColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const moveColumn = useCallback((dataCols: string[], dragged: string, target: string) => {
    if (dragged === target) return;
    const next = [...dataCols];
    const from = next.indexOf(dragged);
    const to = next.indexOf(target);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    setColumnOrder(next);
  }, []);
  const orderedFields = useMemo(() => {
    if (allFields.length === 0) return allFields;
    const fieldSet = new Set(allFields);
    const userOrdered = columnOrder.filter(f => fieldSet.has(f));
    const remaining = allFields.filter(f => !userOrdered.includes(f));
    return [...userOrdered, ...remaining];
  }, [allFields, columnOrder]);

  // Resolve value for a document + field based on source priority
  const resolveValue = (docId: string, field: string): string => {
    const types = grouped[docId];
    if (!types) return '';
    if (source === 'ai') return extractValue(types['ai']?.[field]);
    if (source === 'manual') return extractValue(types['manual']?.[field]);
    if (source === 'consensus') return extractValue(types['consensus']?.[field]);
    // "best" = consensus > manual > ai
    const consensus = extractValue(types['consensus']?.[field]);
    if (consensus) return consensus;
    const manual = extractValue(types['manual']?.[field]);
    if (manual) return manual;
    return extractValue(types['ai']?.[field]);
  };

  // Document list. Labels come from the whole docMap, not just the rows on
  // screen, so a filtered view cannot change a study's a/b suffix.
  const docLabels = buildLabelMap(Object.values(docMap));
  const documentIds = Object.keys(grouped);
  const filteredDocIds = searchQuery
    ? documentIds.filter(id => docMatchesQuery([docLabels[id], docMap[id]?.filename], docMap[id]?.labels, searchQuery))
    : documentIds;

  // Select all logic
  const allSelected = filteredDocIds.length > 0 && filteredDocIds.every(id => selectedRows.has(id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredDocIds));
    }
  };
  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedRows(next);
  };

  // Export
  const handleExport = (format: 'csv' | 'json') => {
    const rows = (selectedRows.size > 0 ? Array.from(selectedRows) : filteredDocIds);
    if (rows.length === 0) return;

    if (format === 'csv') {
      const header = ['Ref ID', 'Document', ...orderedFields];
      const csvRows = rows.map(docId => {
        const filename = docLabels[docId] || docMap[docId]?.filename || docId;
        const refId = docMap[docId]?.ref_id ?? '';
        const values = orderedFields.map(f => resolveValue(docId, f));
        return [refId, filename, ...values].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });
      const csv = [header.map(h => `"${h}"`).join(','), ...csvRows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `final_dataset_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = rows.map(docId => {
        const obj: Record<string, any> = { ref_id: docMap[docId]?.ref_id ?? null, document: docLabels[docId] || docMap[docId]?.filename || docId };
        orderedFields.forEach(f => { obj[f] = resolveValue(docId, f); });
        return obj;
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `final_dataset_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const toggleCell = (cellKey: string) => {
    const next = new Set(expandedCells);
    next.has(cellKey) ? next.delete(cellKey) : next.add(cellKey);
    setExpandedCells(next);
    setAllExpanded(false);
  };

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedCells(new Set());
      setAllExpanded(false);
    } else {
      const all = new Set<string>();
      filteredDocIds.forEach(docId => {
        allFields.forEach(f => all.add(`${docId}:${f}`));
      });
      setExpandedCells(all);
      setAllExpanded(true);
    }
  };

  const loading = formsLoading || resultsLoading;
  const selectedForm = forms.find((f: any) => f.id === formId);

  if (!selectedProject) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Form picker */}
        <div className="relative">
          <select
            value={formId}
            onChange={e => { setSelectedFormId(e.target.value); setSelectedRows(new Set()); }}
            className="text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-3 pr-8 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors dark:[color-scheme:dark] appearance-none min-w-[200px]"
          >
            {forms.map((f: any) => (
              <option key={f.id} value={f.id}>{f.form_name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Source picker */}
        <div className="relative">
          <select
            value={source}
            onChange={e => setSource(e.target.value as SourcePriority)}
            className="text-sm text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-3 pr-8 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors dark:[color-scheme:dark] appearance-none"
          >
            <option value="best">Best Available</option>
            <option value="ai">AI Only</option>
            <option value="manual">Manual Only</option>
            <option value="consensus">Consensus Only</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            className="text-sm text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none w-full placeholder:text-gray-300 dark:placeholder:text-zinc-600"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="flex-shrink-0">
              <X className="w-3 h-3 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300" />
            </button>
          )}
        </div>

        {/* Inline stats */}
        <span className="text-[11px] text-gray-400 dark:text-zinc-500">
          {filteredDocIds.length} docs · {allFields.length} fields
          {selectedRows.size > 0 && ` · ${selectedRows.size} selected`}
        </span>

        {/* Expand all / Collapse all */}
        {filteredDocIds.length > 0 && (
          <button
            onClick={toggleExpandAll}
            className="text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        )}

        <div className="flex-1" />

        {/* Export */}
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            disabled={filteredDocIds.length === 0}
            className="text-xs font-medium text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={filteredDocIds.length === 0}
            className="text-xs font-medium text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : filteredDocIds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] px-6 py-14 text-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-zinc-300">No final dataset yet</p>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-zinc-500">
            {formId ? 'Promote AI or manual results to build the final dataset.' : 'Select a form to view the final dataset.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a]">
                  {/* Checkbox column */}
                  <th className="px-3 py-2.5 w-10">
                    <button
                      onClick={toggleAll}
                      className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                        allSelected
                          ? 'bg-gray-900 dark:bg-white border-gray-900 dark:border-white'
                          : 'border-gray-300 dark:border-[#3a3a3a] hover:border-gray-400 dark:hover:border-[#555]'
                      )}
                    >
                      {allSelected && <Check className="w-3 h-3 text-white dark:text-gray-900" />}
                    </button>
                  </th>
                  {/* Ref ID column */}
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                    Ref ID
                  </th>
                  {/* Document column */}
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 sticky left-0 bg-gray-50/60 dark:bg-[#0a0a0a] w-[220px] min-w-[220px] max-w-[220px]">
                    Document
                  </th>
                  {/* Field columns */}
                  {orderedFields.map(field => {
                    const isDragOver = dragOverCol === field;
                    return (
                      <th
                        key={field}
                        draggable
                        onDragStart={() => { draggedColRef.current = field; }}
                        onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== field) setDragOverCol(field); }}
                        onDragLeave={() => { if (dragOverCol === field) setDragOverCol(null); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const dragged = draggedColRef.current;
                          draggedColRef.current = null;
                          setDragOverCol(null);
                          if (dragged) moveColumn(orderedFields, dragged, field);
                        }}
                        onDragEnd={() => { draggedColRef.current = null; setDragOverCol(null); }}
                        title="Drag to reorder"
                        className={cn(
                          'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 min-w-[140px] whitespace-nowrap select-none cursor-grab active:cursor-grabbing hover:text-gray-600 dark:hover:text-zinc-300',
                          isDragOver && 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                        )}
                      >
                        {field.replace(/_/g, ' ')}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                {filteredDocIds.map(docId => {
                  const checked = selectedRows.has(docId);
                  const filename = docLabels[docId] || docMap[docId]?.filename || docId.slice(0, 8);
                  const refId = docMap[docId]?.ref_id;
                  return (
                    <tr key={docId} className={cn('transition-colors', checked ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-[#0a0a0a]')}>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => toggleRow(docId)}
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                            checked
                              ? 'bg-gray-900 dark:bg-white border-gray-900 dark:border-white'
                              : 'border-gray-300 dark:border-[#3a3a3a] hover:border-gray-400 dark:hover:border-[#555]'
                          )}
                        >
                          {checked && <Check className="w-3 h-3 text-white dark:text-gray-900" />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                        {refId != null ? String(refId) : ''}
                      </td>
                      {/* Tags hide behind a hover marker here, not inline chips:
                          this is a 220px sticky column in a table that already
                          scrolls sideways, and chips would push every value column
                          further out of view. Filter by tag via the search box. */}
                      <td className="px-3 py-2.5 text-xs font-medium text-gray-800 dark:text-zinc-300 sticky left-0 bg-white dark:bg-[#111111] truncate max-w-[220px]" title={filename}>
                        <span className="flex min-w-0 max-w-[196px] items-center gap-1.5">
                          <span className="truncate">{filename.replace(/\.pdf$/i, '')}</span>
                          {!!docMap[docId]?.labels?.length && (
                            <Tooltip content={tagsAsText(docMap[docId]?.labels)} className="max-w-xs whitespace-normal">
                              <Tag className="h-2.5 w-2.5 shrink-0 text-gray-400 dark:text-zinc-500" />
                            </Tooltip>
                          )}
                        </span>
                      </td>
                      {orderedFields.map(field => {
                        const val = resolveValue(docId, field);
                        const cellKey = `${docId}:${field}`;
                        const isExpanded = expandedCells.has(cellKey);
                        return (
                          <td
                            key={field}
                            onClick={() => val && toggleCell(cellKey)}
                            className={cn(
                              'px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-400',
                              val ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#0d0d0d]' : '',
                              isExpanded ? 'max-w-[400px] whitespace-pre-wrap break-words' : 'max-w-[200px] truncate',
                            )}
                          >
                            {val || <span className="text-gray-300 dark:text-zinc-700">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
