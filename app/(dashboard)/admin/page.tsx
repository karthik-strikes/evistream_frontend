'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash2, Users, BarChart3, Loader2, FolderOpen } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { adminService } from '@/services/admin.service';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { User, AdminUserUpdate } from '@/types/api';

type Section = 'dashboard' | 'users' | 'projects';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard' as Section, label: 'Dashboard', icon: BarChart3 },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'users' as Section, label: 'Users', icon: Users },
      { id: 'projects' as Section, label: 'Projects', icon: FolderOpen },
    ],
  },
];

// ── Reusable row ──────────────────────────────────────────────────
function SettingRow({ label, description, children, last = false }: {
  label: string;
  description?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-6 px-5 py-4", !last && "border-b border-gray-100 dark:border-[#1f1f1f]")}>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        {description && <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────
function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111] mb-5">
      {(title || description) && (
        <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
          {description && <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600";
const selectCls = inputCls + " cursor-pointer dark:[color-scheme:dark]";

export default function AdminPage() {
  const { isAdmin, loading: guardLoading } = useAdminGuard();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [projectsPage, setProjectsPage] = useState(1);
  const [active, setActive] = useState<Section>('dashboard');

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminService.getStats(),
    enabled: isAdmin,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', page],
    queryFn: () => adminService.listUsers(page, 20),
    enabled: isAdmin,
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['admin', 'projects', projectsPage],
    queryFn: () => adminService.listProjects(projectsPage, 20),
    enabled: isAdmin && active === 'projects',
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: AdminUserUpdate }) =>
      adminService.updateUser(userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast({ title: 'User updated' });
    },
    onError: (error: any) => {
      toast({
        title: 'Update failed',
        description: error?.response?.data?.detail ?? 'An error occurred',
        variant: 'error',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminService.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast({ title: 'User deleted' });
    },
    onError: (error: any) => {
      toast({
        title: 'Delete failed',
        description: error?.response?.data?.detail ?? 'An error occurred',
        variant: 'error',
      });
    },
  });

  if (guardLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) return null;

  const totalPages = usersData ? Math.ceil(usersData.total / 20) : 1;

  const sectionTitle: Record<Section, string> = {
    dashboard: 'Dashboard',
    users: 'Users',
    projects: 'Projects',
  };

  const projectsTotalPages = projectsData ? Math.ceil(projectsData.total / 20) : 1;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto flex gap-0 pt-10">

        {/* ── Left nav ─────────────────────────────────────────────── */}
        <div className="w-48 flex-shrink-0 flex flex-col pr-8 overflow-y-auto">
          {/* Admin label */}
          <div className="mb-5 pb-5 border-b border-gray-100 dark:border-[#1f1f1f]">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Admin Panel</p>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">System administration</p>
          </div>

          {/* Nav groups */}
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className={cn("mb-1", gi > 0 && "pt-4 border-t border-gray-100 dark:border-[#1f1f1f] mt-3")}>
              <p className="text-[10px] font-semibold text-gray-300 dark:text-zinc-700 uppercase tracking-widest px-2 mb-1">{group.label}</p>
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActive(item.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left",
                      isActive
                        ? "bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-white font-medium"
                        : "text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Content ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto pl-8">

          {/* Section heading */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{sectionTitle[active]}</h2>
          </div>

          {/* ── Dashboard ── */}
          {active === 'dashboard' && (
            <SectionCard title="Platform Statistics" description="Overview of system usage">
              <SettingRow label="Total Users">
                <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {statsData?.total_users ?? '—'}
                </span>
              </SettingRow>
              <SettingRow label="Total Projects">
                <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {statsData?.total_projects ?? '—'}
                </span>
              </SettingRow>
              <SettingRow label="Total Extractions" last>
                <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {statsData?.total_extractions ?? '—'}
                </span>
              </SettingRow>
            </SectionCard>
          )}

          {/* ── Users ── */}
          {active === 'users' && (
            <SectionCard title="User Management" description="Manage user roles and access">
              {usersLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#0d0d0d]">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Email</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Name</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Role</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Status</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Joined</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                    {usersData?.users.map((user: User) => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-[#0d0d0d]">
                        <td className="px-5 py-3.5 text-sm text-gray-900 dark:text-zinc-200">{user.email}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-500 dark:text-zinc-400">{user.full_name || '—'}</td>
                        <td className="px-5 py-3.5">
                          <select
                            value={user.role}
                            onChange={(e) =>
                              updateMutation.mutate({
                                userId: user.id,
                                updates: { role: e.target.value as 'admin' | 'user' },
                              })
                            }
                            className={selectCls}
                            style={{ width: '100px' }}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() =>
                              updateMutation.mutate({
                                userId: user.id,
                                updates: { is_active: !user.is_active },
                              })
                            }
                            className={cn(
                              "text-xs px-2.5 py-1 rounded-md font-medium transition-colors",
                              user.is_active
                                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800/50"
                                : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800/50"
                            )}
                          >
                            {user.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 dark:text-zinc-500 text-xs">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => {
                              if (confirm(`Delete ${user.email}?`)) {
                                deleteMutation.mutate(user.id);
                              }
                            }}
                            className="text-gray-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                  <span className="text-xs text-gray-400 dark:text-zinc-500">
                    {usersData?.total} users
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-400 dark:text-zinc-500 px-1 tabular-nums">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Projects ── */}
          {active === 'projects' && (
            <SectionCard title="All Projects" description="View and manage all platform projects">
              {projectsLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#0d0d0d]">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Project</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Owner</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Members</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                    {(projectsData?.projects || []).map((project: any) => (
                      <tr key={project.id} className="hover:bg-gray-50 dark:hover:bg-[#0d0d0d]">
                        <td className="px-5 py-3.5">
                          <div className="text-sm font-medium text-gray-900 dark:text-zinc-200">{project.name}</div>
                          {project.description && (
                            <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate max-w-xs">{project.description}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm text-gray-600 dark:text-zinc-400">{project.owner_name || project.owner_email || '—'}</div>
                          {project.owner_name && (
                            <div className="text-xs text-gray-400 dark:text-zinc-500">{project.owner_email}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-gray-500 dark:text-zinc-400 tabular-nums">{project.member_count ?? 0}</span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 dark:text-zinc-500 text-xs">
                          {new Date(project.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Pagination */}
              {projectsTotalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                  <span className="text-xs text-gray-400 dark:text-zinc-500">
                    {projectsData?.total} projects
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setProjectsPage((p) => Math.max(1, p - 1))}
                      disabled={projectsPage === 1}
                      className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-400 dark:text-zinc-500 px-1 tabular-nums">
                      {projectsPage} / {projectsTotalPages}
                    </span>
                    <button
                      onClick={() => setProjectsPage((p) => Math.min(projectsTotalPages, p + 1))}
                      disabled={projectsPage === projectsTotalPages}
                      className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}
