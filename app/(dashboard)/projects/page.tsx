'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { dashboardService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { C } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { ProjectMembersModal } from '@/components/project/ProjectMembersModal';

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

// Step 2 — deterministic color per project name (cool engineering tones + warm accents)
const PROJECT_PALETTE = [
  '#3b82f6', // blue
  '#0ea5e9', // sky
  '#06b6d4', // cyan
  '#14b8a6', // teal
  '#10b981', // emerald
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#f43f5e', // rose
] as const;

function projectColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PROJECT_PALETTE[Math.abs(h) % PROJECT_PALETTE.length];
}

export default function ProjectsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, isAdmin } = useAuth();
  const { confirm, dialog } = useConfirmationDialog();
  const { projects: contextProjects, archivedProjects, selectedProject: contextProject, setSelectedProject, createProject, updateProject, deleteProject, archiveProject, unarchiveProject } = useProject();

  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [membersModalProject, setMembersModalProject] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // The dashboard /stats endpoint already returns counts for ALL of the user's
  // projects in `projects_overview` (batched server-side). One call covers every card.
  const { data: projectStats = {} } = useQuery({
    queryKey: ['projects-stats', contextProjects?.map((p: any) => p.id).join(',')],
    queryFn: async () => {
      if (!contextProjects?.length) return {};
      const stats = await dashboardService.getStats(contextProjects[0].id);
      return Object.fromEntries(
        (stats.projects_overview || []).map((p) => [
          p.id,
          { id: p.id, forms: p.form_count, documents: p.document_count },
        ])
      );
    },
    enabled: !!contextProjects?.length,
  });

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
    const confirmed = await confirm({
      title: 'Delete project',
      description: `Delete "${name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await deleteProject(id);
      toast({ title: 'Project deleted', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  const handleArchive = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Archive project',
      description: `Archive "${name}"? It will be hidden from the project selector and become read-only. Results stay viewable, and you can restore it anytime.`,
      confirmLabel: 'Archive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await archiveProject(id);
      toast({ title: 'Project archived', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  const handleRestore = async (id: string) => {
    setSubmitting(true);
    try {
      await unarchiveProject(id);
      toast({ title: 'Project restored', variant: 'success' });
      setTab('active');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally { setSubmitting(false); }
  };

  // Rename/archive: owner, manager, admin, or the original creator.
  // Delete stays narrower — owners and admins only.
  const canManage = (proj: any) =>
    isAdmin || proj.user_id === currentUser?.id || proj.my_role === 'owner' || proj.my_role === 'manager';
  const canDelete = (proj: any) =>
    isAdmin || proj.user_id === currentUser?.id || proj.my_role === 'owner';

  const projects = contextProjects || [];
  const archived = archivedProjects || [];

  const filteredProjects = useMemo(() => {
    let list = tab === 'archived' ? archived : projects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p: any) =>
        p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [tab, projects, archived, searchQuery]);

  return (
    <DashboardLayout>
      <div className="min-h-full pb-16 dashboard-dot-bg">

        {/* -- Header -- */}
        <div className="flex items-center justify-between px-1 pb-7 animate-dashboard-slideUp">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight m-0">Projects</h1>
            <p className="text-sm text-gray-400 mt-1 font-normal">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              {archived.length > 0 && ` · ${archived.length} archived`}
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

        {/* -- Active / Archived tabs (only once something is archived) -- */}
        {archived.length > 0 && (
          <div className="flex items-center gap-1.5 pb-5 animate-dashboard-fadeIn">
            {([
              { key: 'active' as const, label: 'Active', count: projects.length },
              { key: 'archived' as const, label: 'Archived', count: archived.length },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "font-inherit text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-colors",
                  tab === key
                    ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-black dark:border-white"
                    : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-200 dark:border-[#1f1f1f] hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                {label} ({count})
              </button>
            ))}
          </div>
        )}

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
        {tab === 'active' && projects.length === 0 && (
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
        {(tab === 'archived' ? archived.length : projects.length) > 0 && filteredProjects.length === 0 && (
          <div className="text-center py-16 animate-dashboard-fadeIn">
            <div className="text-sm text-gray-400 mb-1">No matching projects</div>
            <div className="text-sm text-gray-300">Try a different search term</div>
          </div>
        )}

        {/* -- Project grid -- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ animation: 'dashboard-slideUp 0.35s ease' }}>
          {filteredProjects.map((proj: any, i: number) => {
            const isActive = proj.id === contextProject?.id;
            const isEditing = editingId === proj.id;
            const isProjArchived = !!proj.archived_at;
            const stats = projectStats[proj.id];
            const totalForms = stats?.forms ?? 0;
            const totalDocs = stats?.documents ?? 0;
            const color = isProjArchived ? '#9ca3af' : projectColor(proj.name);

            return (
              <div
                key={proj.id}
                className={cn(
                  // Step 6: add `group` so children can use group-hover
                  "group relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px",
                  // Step 6: quiet active state — just a colored left border, no loud gradient
                  isActive
                    ? "border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]"
                    : "border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]",
                  // Archived cards read as dormant: muted, and no ambient glow
                  isProjArchived && "opacity-60 hover:opacity-95"
                )}
                onClick={() => { if (!isEditing) router.push(`/projects/${proj.id}`); }}
                style={{
                  animation: `dashboard-scaleIn 0.3s cubic-bezier(0.2,0.8,0.2,1) ${0.03 + i * 0.04}s both`,
                  borderLeft: `${isActive ? 4 : 3}px solid ${color}`,
                  boxShadow: isActive ? `0 0 0 1px ${color}26` : undefined,
                }}
              >
                {/* Hybrid: static asymmetric glows (anchor) + barely-perceptible slow rotation (flow) + hover scan (futuristic reward) */}
                {!isEditing && !isProjArchived && (
                  <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                    {/* Layer 1 — undertone: very faint slow-rotating conic, gives "alive" feeling without distraction */}
                    <div
                      className={cn(
                        "absolute animate-spin transition-opacity duration-700 ease-out",
                        isActive ? "opacity-25" : "opacity-[0.08] group-hover:opacity-25"
                      )}
                      style={{
                        top: '-50%',
                        left: '-50%',
                        right: '-50%',
                        bottom: '-50%',
                        animationDuration: '32s',
                        animationTimingFunction: 'linear',
                        background: `conic-gradient(from 0deg at 60% 40%, transparent 0deg, ${color} 60deg, transparent 130deg, ${color} 230deg, transparent 310deg)`,
                        filter: 'blur(50px)',
                        willChange: 'transform',
                      }}
                    />
                    {/* Layer 2 — top-right large glow (primary anchor) */}
                    <div
                      className={cn(
                        "absolute top-0 right-0 w-44 h-44 rounded-full transition-opacity duration-500 ease-out",
                        isActive ? "opacity-40" : "opacity-[0.14] group-hover:opacity-40"
                      )}
                      style={{
                        background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
                        transform: 'translate(35%, -40%)',
                      }}
                    />
                    {/* Layer 3 — bottom-left small glow (counter-balance) */}
                    <div
                      className={cn(
                        "absolute bottom-0 left-0 w-32 h-32 rounded-full transition-opacity duration-700 ease-out",
                        isActive ? "opacity-25" : "opacity-[0.08] group-hover:opacity-25"
                      )}
                      style={{
                        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                        transform: 'translate(-30%, 35%)',
                      }}
                    />
                    {/* Layer 4 — hover-only diagonal scan line (futuristic interaction reward) */}
                    <div
                      className="absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:opacity-100 transition-all duration-[1100ms] ease-out group-hover:translate-x-[450%]"
                      style={{
                        background: `linear-gradient(105deg, transparent 30%, ${color}40 50%, transparent 70%)`,
                        filter: 'blur(8px)',
                      }}
                    />
                  </div>
                )}
                {isEditing ? (
                  /* -- Inline edit form -- */
                  <div onClick={(e) => e.stopPropagation()} className="relative py-5 px-[22px] flex flex-col gap-2">
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
                  <div className="relative py-5 px-[22px]">

                    {/* Top row: initial badge + name + menu */}
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <span
                          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-semibold transition-all"
                          style={isActive
                            ? { backgroundColor: color, color: '#fff', boxShadow: `0 2px 8px -2px ${color}80` }
                            : { backgroundColor: `${color}1f`, color }
                          }
                        >
                          {proj.name.trim().charAt(0).toUpperCase() || '?'}
                        </span>
                        <span className={cn(
                          "text-sm truncate text-gray-900 dark:text-white",
                          isActive ? "font-semibold" : "font-medium"
                        )}>{proj.name}</span>
                      </div>

                      {/* Menu button hidden until hover; owner, manager, admin, or creator */}
                      {canManage(proj) && (
                      <div
                        className="relative shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                        ref={menuOpenId === proj.id ? menuRef : undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === proj.id ? null : proj.id)}
                          aria-label="Project options"
                          className="font-inherit text-base text-gray-400 bg-transparent border border-transparent rounded-md px-1.5 py-0.5 cursor-pointer leading-none hover:bg-gray-100 dark:hover:bg-[#1a1a1a] hover:border-gray-200"
                        >...</button>
                        {menuOpenId === proj.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg shadow-dropdown z-50 min-w-[130px] overflow-hidden animate-dashboard-fadeIn">
                            {/* Renaming an archived project is blocked server-side (409), so hide Edit */}
                            {!isProjArchived && (
                              <button
                                className="menu-item font-inherit text-sm text-gray-700 dark:text-[#c0c0c0] bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                                onClick={() => { setEditingId(proj.id); setEditData({ name: proj.name, description: proj.description || '' }); setMenuOpenId(null); }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                Edit
                              </button>
                            )}
                            <button
                              className="menu-item font-inherit text-sm text-gray-700 dark:text-[#c0c0c0] bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                              onClick={() => { setMembersModalProject({ id: proj.id, name: proj.name }); setMenuOpenId(null); }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                              Members
                            </button>
                            {isProjArchived ? (
                              <button
                                className="menu-item font-inherit text-sm text-gray-700 dark:text-[#c0c0c0] bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                                onClick={() => { handleRestore(proj.id); setMenuOpenId(null); }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>
                                Restore
                              </button>
                            ) : (
                              <button
                                className="menu-item font-inherit text-sm text-gray-700 dark:text-[#c0c0c0] bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                                onClick={() => { handleArchive(proj.id, proj.name); setMenuOpenId(null); }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8"/><path d="M10 12h4"/></svg>
                                Archive
                              </button>
                            )}
                            {/* Delete stays narrower than archive: owners and admins only */}
                            {canDelete(proj) && (
                              <>
                                <div className="h-px bg-gray-100 dark:bg-[#1a1a1a]" />
                                <button
                                  className="menu-item font-inherit text-sm bg-transparent border-none py-2 px-3.5 cursor-pointer flex items-center gap-2 w-full text-left"
                                  style={{ color: C.red }}
                                  onClick={() => { handleDelete(proj.id, proj.name); setMenuOpenId(null); }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </div>

                    {/* Recency stamp */}
                    <div className="text-[11px] text-gray-400 dark:text-gray-600 mb-2 pl-[38px]">
                      {/* created_at, not updated_at — the list is ordered by
                          creation date, so showing "last updated" here made a
                          correctly-sorted list look shuffled. */}
                      {relativeTime(proj.created_at)}
                    </div>

                    {/* Description only if present */}
                    {proj.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mb-3 pl-[38px]">
                        {proj.description}
                      </div>
                    )}

                    {/* Bottom row: status pill (only when actionable) + counts + set active */}
                    <div className="flex items-center justify-between mt-3 pl-[38px]">
                      <div className="flex items-center gap-2">
                        {isProjArchived && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-400/10">
                            Archived
                          </span>
                        )}

                        {/* Counts come from the dashboard stats call, which excludes
                            archived projects — so show the archive stamp instead of
                            a misleading "0 forms · 0 docs". */}
                        <span className="text-[11px] text-gray-400 dark:text-gray-600">
                          {isProjArchived
                            ? `Archived ${relativeTime(proj.archived_at)}`
                            : `${totalForms} ${totalForms === 1 ? 'form' : 'forms'} · ${totalDocs} ${totalDocs === 1 ? 'doc' : 'docs'}`}
                        </span>
                      </div>

                      {/* Step 6: set active hidden until hover. Archived projects
                          can't be made active — they're hidden from the selector. */}
                      {!isActive && !isProjArchived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedProject(proj); }}
                          className="font-inherit text-xs font-semibold text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 cursor-pointer bg-transparent border-none transition-colors opacity-0 group-hover:opacity-100 duration-150"
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

          {/* New project tile — active tab only */}
          {tab === 'active' && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-[#1f1f1f]/60 p-4 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]/40 transition-all duration-150 min-h-[110px] bg-transparent"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600 mb-1.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500">New Project</span>
          </button>
          )}
        </div>
      </div>

      {/* Members modal */}
      <ProjectMembersModal
        projectId={membersModalProject?.id ?? ''}
        projectName={membersModalProject?.name}
        isOpen={!!membersModalProject}
        onClose={() => setMembersModalProject(null)}
      />
      {dialog}

    </DashboardLayout>
  );
}
