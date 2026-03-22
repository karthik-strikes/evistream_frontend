'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/hooks/use-toast';
import { dataCleaningService, formsService } from '@/services';
import type { Form, DataCleaningRow, ValidationRule } from '@/types/api';
import { Loader2, Download, AlertTriangle, CheckCircle2, Sparkles, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DataCleaningPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [gridData, setGridData] = useState<DataCleaningRow[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editedCells, setEditedCells] = useState<Map<string, { docId: string; field: string; oldValue: any; newValue: any }>>(new Map());
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedProject?.id || !selectedFormId) return;
    setLoading(true);
    try {
      const [grid, rulesData] = await Promise.all([
        dataCleaningService.getGrid(selectedProject.id, selectedFormId),
        dataCleaningService.listRules(selectedFormId),
      ]);
      setGridData(grid);
      setRules(rulesData);
    } catch {
      toast({ title: 'Error', description: 'Failed to load data', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.id, selectedFormId, toast]);

  useEffect(() => {
    if (selectedProject?.id) {
      formsService.getAll(selectedProject.id).then(f => {
        setForms(f);
        if (f.length > 0 && !selectedFormId) setSelectedFormId(f[0].id);
      });
    }
  }, [selectedProject?.id]);

  useEffect(() => {
    if (selectedFormId) loadData();
  }, [selectedFormId, loadData]);

  // Get all field names from grid data
  const allFields = Array.from(
    new Set(gridData.flatMap(row => Object.keys(row.values)))
  ).sort();

  const getViolation = (row: DataCleaningRow, field: string) => {
    return row.violations.find(v => v.field_name === field);
  };

  const handleCellEdit = (docId: string, field: string, oldValue: any, newValue: string) => {
    const key = `${docId}:${field}`;
    if (newValue === String(oldValue ?? '')) {
      const updated = new Map(editedCells);
      updated.delete(key);
      setEditedCells(updated);
    } else {
      setEditedCells(prev => new Map(prev).set(key, { docId, field, oldValue, newValue }));
    }
  };

  const saveBulkEdits = async () => {
    if (!selectedProject?.id || editedCells.size === 0) return;
    setSaving(true);
    try {
      const edits = Array.from(editedCells.values()).map(e => ({
        document_id: e.docId,
        field_name: e.field,
        old_value: e.oldValue,
        new_value: e.newValue,
      }));
      const result = await dataCleaningService.bulkEdit({
        project_id: selectedProject.id,
        form_id: selectedFormId,
        edits,
      });
      toast({ title: 'Saved', description: `${result.updated} cells updated` });
      setEditedCells(new Map());
      loadData();
    } catch {
      toast({ title: 'Error', description: 'Failed to save edits', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (!selectedProject?.id || !selectedFormId) return;
    try {
      const blob = await dataCleaningService.exportData(selectedProject.id, selectedFormId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clean_data.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Error', description: 'Export failed', variant: 'error' });
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-full mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Data Cleaning</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Review, validate, and clean extracted data</p>
          </div>
          <div className="flex gap-2">
            {editedCells.size > 0 && (
              <button
                onClick={saveBulkEdits}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
                Save {editedCells.size} edits
              </button>
            )}
            <button
              onClick={() => handleExport('csv')}
              className="px-4 py-2 border border-gray-300 dark:border-[#333] rounded-lg text-sm font-medium dark:text-white hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
            >
              <Download className="h-4 w-4 inline mr-1" /> CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="px-4 py-2 border border-gray-300 dark:border-[#333] rounded-lg text-sm font-medium dark:text-white hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
            >
              <Download className="h-4 w-4 inline mr-1" /> JSON
            </button>
          </div>
        </div>

        <div className="mb-6">
          <select
            value={selectedFormId}
            onChange={e => setSelectedFormId(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-[#333] rounded-lg bg-white dark:bg-[#141414] text-sm dark:text-white"
          >
            {forms.filter(f => f.status === 'active').map(f => (
              <option key={f.id} value={f.id}>{f.form_name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
        ) : gridData.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No data to clean yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 dark:border-[#2a2a2a] rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#1a1a1a] sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap sticky left-0 bg-gray-50 dark:bg-[#1a1a1a] z-10">Document</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Source</th>
                  {allFields.map(f => (
                    <th key={f} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-[#2a2a2a]">
                {gridData.map(row => (
                  <tr key={row.document_id} className="hover:bg-gray-50 dark:hover:bg-[#0a0a0a]">
                    <td className="px-3 py-2 whitespace-nowrap dark:text-white font-medium sticky left-0 bg-white dark:bg-[#141414] z-10">
                      {row.filename}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {row.data_source}
                      </span>
                    </td>
                    {allFields.map(field => {
                      const violation = getViolation(row, field);
                      const value = row.values[field];
                      const cellKey = `${row.document_id}:${field}`;
                      const isEdited = editedCells.has(cellKey);
                      return (
                        <td key={field} className={cn(
                          'px-3 py-2',
                          violation?.severity === 'error' && 'bg-red-50 dark:bg-red-900/10',
                          violation?.severity === 'warning' && 'bg-yellow-50 dark:bg-yellow-900/10',
                          isEdited && 'bg-blue-50 dark:bg-blue-900/10',
                        )}>
                          <input
                            type="text"
                            defaultValue={String(value ?? '')}
                            onBlur={e => handleCellEdit(row.document_id, field, value, e.target.value)}
                            className={cn(
                              'w-full px-1 py-0.5 text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none dark:text-white',
                              violation && 'border-b-red-300'
                            )}
                            title={violation?.message}
                          />
                          {violation && (
                            <AlertTriangle className="h-3 w-3 text-red-500 inline ml-1" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
