'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BookOpen, Plus, Upload, Trash2, Loader2, Edit2, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { vocabulariesService } from '@/services';
import type { ControlledVocabulary, VocabularyTerm } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { EmptyState, EmptyStateSearch } from '@/components/ui';

interface VocabulariesSectionProps {
  projectId: string;
  vocabularies: ControlledVocabulary[];
  onVocabulariesChange: (vocabs: ControlledVocabulary[]) => void;
}

export function VocabulariesSection({ projectId, vocabularies, onVocabulariesChange }: VocabulariesSectionProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [termsText, setTermsText] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTermsText, setEditTermsText] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return vocabularies;
    const q = searchQuery.toLowerCase();
    return vocabularies.filter(v => v.name.toLowerCase().includes(q));
  }, [vocabularies, searchQuery]);

  const reload = useCallback(async () => {
    try {
      const data = await vocabulariesService.list(projectId);
      onVocabulariesChange(data);
    } catch { /* silent */ }
  }, [projectId, onVocabulariesChange]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const terms: VocabularyTerm[] = termsText
        .split('\n')
        .filter(l => l.trim())
        .map(l => ({ term: l.trim() }));
      await vocabulariesService.create({
        project_id: projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        terms,
      });
      toast({ title: 'Created', description: 'Vocabulary created' });
      setShowCreate(false);
      setName('');
      setDescription('');
      setTermsText('');
      reload();
    } catch {
      toast({ title: 'Error', description: 'Failed to create vocabulary', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (v: ControlledVocabulary) => {
    setEditingId(v.id);
    setEditName(v.name);
    setEditDescription(v.description || '');
    setEditTermsText(v.terms.map((t: any) => t.term || t).join('\n'));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
    setEditTermsText('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setEditSaving(true);
    try {
      const terms: VocabularyTerm[] = editTermsText
        .split('\n')
        .filter(l => l.trim())
        .map(l => ({ term: l.trim() }));
      await vocabulariesService.update(editingId, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        terms,
      });
      toast({ title: 'Updated', description: 'Vocabulary updated' });
      cancelEdit();
      reload();
    } catch {
      toast({ title: 'Error', description: 'Failed to update vocabulary', variant: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vocabulary?')) return;
    try {
      await vocabulariesService.delete(id);
      toast({ title: 'Deleted', description: 'Vocabulary deleted' });
      if (editingId === id) cancelEdit();
      reload();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete vocabulary', variant: 'error' });
    }
  };

  const handleImport = async (vocabId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const result = await vocabulariesService.importCSV(vocabId, file);
        toast({ title: 'Imported', description: `${result.imported} terms imported (${result.total_terms} total)` });
        reload();
      } catch {
        toast({ title: 'Error', description: 'Import failed', variant: 'error' });
      }
    };
    input.click();
  };

  if (vocabularies.length === 0 && !showCreate) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <BookOpen size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No vocabularies yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Create a vocabulary to standardize extraction terminology</div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg py-2 px-4 hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          Create Vocabulary
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400 dark:text-zinc-500">{vocabularies.length} vocabular{vocabularies.length !== 1 ? 'ies' : 'y'}</p>
          {vocabularies.length > 3 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-48 pl-8 pr-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#1a1a1a] text-xs dark:text-white placeholder:text-gray-400 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
              />
            </div>
          )}
        </div>
        <button
          onClick={() => { setShowCreate(true); cancelEdit(); }}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-zinc-300 bg-gray-100 dark:bg-[#1f1f1f] hover:bg-gray-200 dark:hover:bg-[#2a2a2a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 p-4 rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-gray-50 dark:bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">New Vocabulary</span>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
              placeholder="Name (e.g., Study Design Types)"
            />
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
              placeholder="Description (optional)"
            />
            <textarea
              value={termsText}
              onChange={e => setTermsText(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white font-mono outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
              placeholder={'Terms (one per line)\nRandomized Controlled Trial\nCohort Study'}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit form */}
      {editingId && (
        <div className="mb-4 p-4 rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-gray-50 dark:bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Edit Vocabulary</span>
            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
            />
            <input
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
              placeholder="Description"
            />
            <textarea
              value={editTermsText}
              onChange={e => setEditTermsText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-sm bg-white dark:bg-[#1a1a1a] dark:text-white font-mono outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || !editName.trim()}
                className="text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors"
              >
                {editSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={cancelEdit} className="text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors">
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={() => handleDelete(editingId)}
                className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vocabulary list */}
      {searchQuery && filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-400 dark:text-zinc-500">No vocabularies match &ldquo;{searchQuery}&rdquo;</p>
          <button onClick={() => setSearchQuery('')} className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1">Clear search</button>
        </div>
      ) : (
        <div className="space-y-0">
          {filtered.map((v, i) => {
            const termsList = v.terms || [];
            const displayTerms = termsList.slice(0, 5);
            const moreCount = termsList.length - 5;
            const isEditing = editingId === v.id;
            if (isEditing) return null; // shown in edit form above

            return (
              <div
                key={v.id}
                className={cn(
                  'group flex items-start justify-between py-3.5 px-1 gap-4',
                  i < filtered.length - 1 && 'border-b border-gray-100 dark:border-[#1f1f1f]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-gray-800 dark:text-zinc-300">{v.name}</span>
                    <span className={cn(
                      'rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide border',
                      v.project_id
                        ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400'
                        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
                    )}>
                      {v.project_id ? 'Project' : 'Global'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mb-1.5">
                    {termsList.length} terms{v.description ? ` · ${v.description}` : ''}
                  </p>
                  {termsList.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {displayTerms.map((t: any, j: number) => (
                        <span key={j} className="text-[10px] font-medium bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded-full">
                          {typeof t === 'string' ? t : t.term}
                        </span>
                      ))}
                      {moreCount > 0 && (
                        <span className="text-[10px] text-gray-400 px-1.5 py-0.5">+{moreCount} more</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                  <button onClick={() => startEdit(v)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-zinc-300 dark:hover:bg-[#1f1f1f] transition-colors" title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleImport(v.id)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-zinc-300 dark:hover:bg-[#1f1f1f] transition-colors" title="Import CSV">
                    <Upload size={13} />
                  </button>
                  <button onClick={() => handleDelete(v.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
