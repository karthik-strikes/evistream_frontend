'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService } from '@/services'; // used for enriching card stats
import { useToast } from '@/hooks/use-toast';
import { C } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const fmtStatus = (s: string) => {
  const map: Record<string, string> = { active: 'Active', generating: 'Generating', awaiting_review: 'Review', regenerating: 'Generating', draft: 'Draft', failed: 'Failed' };
  return map[s] || s;
};

const relativeTime = (date: string) => {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

export default function ProjectsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { projects: contextProjects, selectedProject: contextProject, setSelectedProject, createProject, updateProject, deleteProject } = useProject();

  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [projectsData, setProjectsData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch forms + docs for every project
  useEffect(() => {
    const fetchAll = async () => {
      if (!contextProjects?.length) { setDataLoading(false); return; }
      setDataLoading(true);
      try {
        const enriched = await Promise.all(
          contextProjects.map(async (proj: any) => {
            try {
              const [projForms, projDocs] = await Promise.all([
                formsService.getAll(proj.id),
                documentsService.getAll(proj.id),
              ]);
              return {
                ...proj,
                forms: projForms.map((f: any) => ({ name: f.form_name, status: fmtStatus(f.status || 'active') })),
                documents: projDocs.map((d: any) => ({
                  name: d.filename,
                  status: d.processing_status === 'completed' ? 'Completed' : d.processing_status === 'processing' ? 'Generating' : 'Failed',
                })),
              };
            } catch {
              return { ...proj, forms: [], documents: [] };
            }
          })
        );
        setProjectsData(enriched);
      } finally { setDataLoading(false); }
    };
    fetchAll();
  }, [contextProjects]);


  const handleCreate = async () => {
    if (!createData.name.trim()) return;
    setSubmitting(true);
    try {
      await createProject(createData.name, createData.description || undefined);
      setCreateData({ name: '', description: '' });
      setShowCreate(false);
      toast({ title: 'Project created', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  const handleUpdate = async (id: string) => {
    if (!editData.name.trim()) return;
    setSubmitting(true);
    try {
      await updateProject(id, { name: editData.name, description: editData.description || undefined });
      setEditingId(null);
      toast({ title: 'Project updated', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This action cannot be undone.`)) return;
    setSubmitting(true);
    try {
      await deleteProject(id);
      if (panelProject?.id === id) closePanel();
      toast({ title: 'Project deleted', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  const projects = projectsData.length ? projectsData : (contextProjects || []);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p: any) =>
        p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [projects, searchQuery]);

  return (
    <DashboardLayout>
      <div className="min-h-full pb-16 dashboard-dot-bg">

        {/* -- Header -- */}
        <div className="flex items-center justify-between px-1 pb-7 animate-dashboard-slideUp">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight m-0">Projects</h1>
            <p className="text-sm text-gray-400 mt-1 font-normal">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="font-inherit text-sm text-gray-900 dark:text-white w-48 py-2 pl-9 pr-3 rounded-lg border border-gray-200 dark:border-[#1f1f1f] outline-none bg-white dark:bg-[#111111] focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
            </div>
            <button
              onClick={() => setShowCreate((s) => !s)}
              className="font-inherit text-sm font-semibold text-white bg-gray-900 border-none rounded-lg px-4 py-2 cursor-pointer flex items-center gap-1.5 hover:bg-gray-700 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              New Project
            </button>
          </div>
        </div>

        {/* -- Inline create form -- */}
        {showCreate && (
          <div className="mb-6 px-6 py-5 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl animate-dashboard-slideDown overflow-hidden">
            <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3.5">Create new project</div>
            <div className="flex flex-col gap-2.5">
              <input
                autoFocus
                type="text"
                value={createData.name}
                onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
                placeholder="Project name"
                className="font-inherit text-sm text-gray-900 dark:text-white py-2 px-3 rounded-lg border border-gray-200 dark:border-[#1f1f1f] outline-none bg-gray-50 dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
              <input
                type="text"
                value={createData.description}
                onChange={(e) => setCreateData({ ...createData, description: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
                placeholder="Description (optional)"
                className="font-inherit text-sm text-gray-900 dark:text-white py-2 px-3 rounded-lg border border-gray-200 dark:border-[#1f1f1f] outline-none bg-gray-50 dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={submitting || !createData.name.trim()}
                  className={cn(
                    "font-inherit text-sm font-semibold text-white bg-gray-900 border-none rounded-lg py-2 px-5 cursor-pointer",
                    (submitting || !createData.name.trim()) && "opacity-40"
                  )}
                >{submitting ? 'Creating...' : 'Create'}</button>
                <button
                  onClick={() => { setShowCreate(false); setCreateData({ name: '', description: '' }); }}
                  className="font-inherit text-sm font-medium text-gray-500 bg-transparent border border-gray-200 rounded-lg py-2 px-4 cursor-pointer"
                >Cancel</button>
              </div>
            </div>
          </div>
        )}


        {/* -- Empty state -- */}
        {projects.length === 0 && (
          <div className="text-center py-20 animate-dashboard-fadeIn">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
            </div>
            <div className="text-sm font-semibold text-gray-600 mb-1.5">No projects yet</div>
            <div className="text-sm text-gray-400 mb-5">Create your first project to get started</div>
            <button
              onClick={() => setShowCreate(true)}
              className="font-inherit text-sm font-semibold text-white bg-gray-900 border-none rounded-lg py-2 px-5 cursor-pointer hover:bg-gray-700 transition-colors"
            >Create Project</button>
          </div>
        )}

        {/* -- No search results -- */}
        {projects.length > 0 && filteredProjects.length === 0 && (
          <div className="text-center py-16 animate-dashboard-fadeIn">
            <div className="text-sm text-gray-400 mb-1">No matching projects</div>
            <div className="text-sm text-gray-300">Try a different search term</div>
          </div>
        )}

        {/* -- Project list (full-width stacked cards) -- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ animation: 'dashboard-slideUp 0.35s ease' }}>
          {filteredProjects.map((proj: any, i: number) => {
            const isActive = proj.id === contextProject?.id;
            const isEditing = editingId === proj.id;
            const totalForms = (proj.forms || []).length;
            const totalDocs = (proj.documents || []).length;

            return (
              <div
                key={proj.id}
                className={cn(
                  "relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px",
                  isActive
                    ? "border border-amber-200 dark:border-[#1f1f1f] border-l-[4px] border-l-amber-400 dark:border-l-amber-400 bg-gradient-to-r from-amber-50 to-white dark:from-amber-400/10 dark:to-[#111111]"
                    : "border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]"
                )}
                onClick={() => { if (!isEditing) router.push(`/projects/${proj.id}`); }}
                style={{ animation: `dashboard-scaleIn 0.3s cubic-bezier(0.2,0.8,0.2,1) ${0.03 + i * 0.04}s both` }}
              >
                {isEditing ? (
                  /* -- Inline edit form -- */
                  <div onClick={(e) => e.stopPropagation()} className="py-5 px-[22px] flex flex-col gap-2">
                    <input autoFocus type="text" value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(proj.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="font-inherit text-sm text-gray-900 dark:text-white py-2 px-3 rounded-lg border border-gray-200 dark:border-[#1f1f1f] outline-none bg-white dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                    />
                    <input type="text" value={editData.description} placeholder="Description"
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(proj.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="font-inherit text-sm text-gray-900 dark:text-white py-2 px-3 rounded-lg border border-gray-200 dark:border-[#1f1f1f] outline-none bg-white dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleUpdate(proj.id)} disabled={submitting}
                        className="font-inherit text-sm font-semibold text-white bg-gray-900 border-none rounded-md py-1.5 px-4 cursor-pointer">Save</button>
                      <button onClick={() => setEditingId(null)}
                        className="font-inherit text-sm text-gray-500 bg-transparent border border-gray-200 rounded-md py-1.5 px-3.5 cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  /* -- Card content -- */
                  <div className="py-5 px-[22px]">
                    {/* Top row: name + active badge + menu */}
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{proj.name}</span>
                        {isActive && (
                          <span className="shrink-0 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-1.5 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="relative shrink-0" ref={menuOpenId === proj.id ? menuRef : undefined} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === proj.id ? null : proj.id)}
                          className="font-inherit text-base text-gray-400 bg-transparent border border-transparent rounded-md px-1.5 py-0.5 cursor-pointer leading-none hover:bg-gray-100 dark:hover:bg-[#1a1a1a] hover:border-gray-200"
                        >...</button>
                        {menuOpenId === proj.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg shadow-dropdown z-50 min-w-[120px] overflow-hidden animate-dashboard-fadeIn">
                            <button
                              className="menu-item font-inherit text-sm text-gray-700 dark:text-[#c0c0c0] bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                              onClick={() => { setEditingId(proj.id); setEditData({ name: proj.name, description: proj.description || '' }); setMenuOpenId(null); }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              Edit
                            </button>
                            <div className="h-px bg-gray-100 dark:bg-[#1a1a1a]" />
                            <button
                              className="menu-item font-inherit text-sm bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                              style={{ color: C.red }}
                              onClick={() => { handleDelete(proj.id, proj.name); setMenuOpenId(null); }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate mb-4">
                      {proj.description || 'No description'}
                    </div>

                    {/* Bottom row: stats + set active */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {totalForms} {totalForms === 1 ? 'form' : 'forms'} · {totalDocs} {totalDocs === 1 ? 'doc' : 'docs'}
                      </span>
                      {!isActive && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedProject(proj); }}
                          className="font-inherit text-xs font-semibold text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 cursor-pointer bg-transparent border-none transition-colors"
                        >
                          Set active
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* New project card */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-[#1f1f1f]/60 p-4 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]/40 transition-all duration-150 min-h-[110px] bg-transparent"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600 mb-1.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500">New Project</span>
          </button>
        </div>
      </div>

    </DashboardLayout>
  );
}
