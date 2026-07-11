'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus, Download, MoreHorizontal, Trash2, ToggleLeft, X, Copy, Check } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { adminService } from '@/services/admin.service';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import { exportToCsv } from '@/lib/csv';
import type { User, AdminUserUpdate } from '@/types/api';

type Tab = 'users' | 'projects';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', user: 'Member' };

const ROLE_PILL: Record<string, string> = {
  admin: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-400/10',
  user: 'text-gray-600 dark:text-zinc-400 bg-gray-100 dark:bg-[#1f1f1f]',
};

function genTempPassword(): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return [pick(upper), pick(upper), ...Array.from({ length: 6 }, () => pick(lower)), pick(digits), pick(digits)].join('');
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] px-4 py-3.5">
      <p className="text-[11px] font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-semibold text-gray-900 dark:text-white tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">{sub}</p>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn('text-left px-4 py-2.5 text-[11px] font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap', className)}>
      {children}
    </th>
  );
}

function PaginationBar({ page, total, totalPages, onPrev, onNext }: {
  page: number; total: number; totalPages: number;
  onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f]">
      <span className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">{total} total</span>
      <div className="flex items-center gap-2">
        <button onClick={onPrev} disabled={page === 1}
          className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
          Previous
        </button>
        <span className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">{page} / {totalPages}</span>
        <button onClick={onNext} disabled={page >= totalPages}
          className="text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
          Next
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { isAdmin, loading: guardLoading } = useAdminGuard();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('users');
  const [usersPage, setUsersPage] = useState(1);
  const [projectsPage, setProjectsPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [projectSearch, setProjectSearch] = useState('');

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [tempPassword] = useState(genTempPassword);
  const [copied, setCopied] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminService.getStats(),
    enabled: isAdmin,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', usersPage],
    queryFn: () => adminService.listUsers(usersPage, 20),
    enabled: isAdmin,
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['admin', 'projects', projectsPage],
    queryFn: () => adminService.listProjects(projectsPage, 20),
    enabled: isAdmin && tab === 'projects',
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: AdminUserUpdate }) =>
      adminService.updateUser(userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      toast({ title: 'User updated' });
    },
    onError: (error: any) => {
      toast({ title: 'Update failed', description: error?.response?.data?.detail ?? 'An error occurred', variant: 'error' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminService.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      toast({ title: 'User deleted' });
    },
    onError: (error: any) => {
      toast({ title: 'Delete failed', description: error?.response?.data?.detail ?? 'An error occurred', variant: 'error' });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => adminService.createUser(inviteEmail.trim(), inviteName.trim(), inviteRole, tempPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setInviteSuccess(true);
    },
    onError: (error: any) => {
      toast({ title: 'Failed to create account', description: error?.response?.data?.detail ?? 'An error occurred', variant: 'error' });
    },
  });

  const openInvite = () => {
    setInviteEmail('');
    setInviteName('');
    setInviteRole('user');
    setInviteSuccess(false);
    setCopied(false);
    setInviteOpen(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const allUsers: User[] = usersData?.users ?? [];
  const filteredUsers = useMemo(() => allUsers.filter(u => {
    const q = userSearch.toLowerCase();
    const matchSearch = !q || u.email.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? u.is_active : !u.is_active);
    return matchSearch && matchRole && matchStatus;
  }), [allUsers, userSearch, roleFilter, statusFilter]);

  const allProjects: any[] = projectsData?.projects ?? [];
  const filteredProjects = useMemo(() => {
    if (!projectSearch) return allProjects;
    const q = projectSearch.toLowerCase();
    return allProjects.filter(p => p.name?.toLowerCase().includes(q));
  }, [allProjects, projectSearch]);

  const usersTotalPages = Math.max(1, usersData ? Math.ceil(usersData.total / 20) : 1);
  const projectsTotalPages = Math.max(1, projectsData ? Math.ceil(projectsData.total / 20) : 1);

  const handleExportCsv = () => {
    if (tab === 'users') {
      exportToCsv(filteredUsers, [
        { key: 'full_name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' },
        { key: 'is_active', label: 'Active' },
        { key: 'project_count', label: 'Projects' },
        { key: 'created_at', label: 'Joined' },
        { key: 'last_seen_at', label: 'Last Active' },
      ], 'users.csv');
    } else if (tab === 'projects') {
      exportToCsv(filteredProjects, [
        { key: 'name', label: 'Project' },
        { key: 'description', label: 'Description' },
        { key: 'owner_name', label: 'Owner' },
        { key: 'owner_email', label: 'Owner Email' },
        { key: 'member_count', label: 'Members' },
        { key: 'created_at', label: 'Created' },
      ], 'projects.csv');
    }
  };

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

  return (
    <DashboardLayout>
      {/* ── Invite / Create account modal ── */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInviteOpen(false)}>
          <div className="bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Create account</h2>
              <button onClick={() => setInviteOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {inviteSuccess ? (
              <div className="px-5 py-6 space-y-4">
                <p className="text-sm text-gray-700 dark:text-zinc-300">
                  Account created for <span className="font-medium text-gray-900 dark:text-white">{inviteEmail}</span>. Share these credentials:
                </p>
                <div className="rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 dark:text-zinc-500">Email</span>
                    <span className="font-medium text-gray-800 dark:text-zinc-200 font-mono">{inviteEmail}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 dark:text-zinc-500">Temp password</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-gray-800 dark:text-zinc-200">{tempPassword}</span>
                      <button onClick={handleCopy} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 dark:text-zinc-500">The user should change their password after first login.</p>
                <button onClick={() => setInviteOpen(false)} className="w-full py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg hover:opacity-90 transition-opacity">
                  Done
                </button>
              </div>
            ) : (
              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
                  <input
                    autoFocus
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-gray-50 dark:bg-[#1a1a1a] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Full name <span className="text-gray-300 dark:text-zinc-600 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-gray-50 dark:bg-[#1a1a1a] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Role</label>
                  <div className="flex gap-2">
                    {(['user', 'admin'] as const).map(r => (
                      <label key={r} className={cn(
                        'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-colors',
                        inviteRole === r
                          ? 'border-gray-900 dark:border-white bg-gray-50 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
                          : 'border-gray-200 dark:border-[#2a2a2a] text-gray-400 dark:text-zinc-500 hover:border-gray-300 dark:hover:border-[#3a3a3a]',
                      )}>
                        <input type="radio" name="inviteRole" value={r} checked={inviteRole === r} onChange={() => setInviteRole(r)} className="sr-only" />
                        {ROLE_LABEL[r]}
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!inviteEmail.trim() || createMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {createMutation.isPending ? 'Creating…' : 'Create account'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Administration</p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">Admin Panel</h1>
            <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">Manage users, projects, and platform activity.</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={openInvite}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg hover:opacity-90 transition-opacity"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Create account
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center border-b border-gray-200 dark:border-[#1f1f1f] mb-6">
          {([
            { id: 'users' as Tab, label: 'Users', count: usersData?.total },
            { id: 'projects' as Tab, label: 'Projects', count: projectsData?.total },
          ] as { id: Tab; label: string; count?: number }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.id
                  ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300',
              )}
            >
              {t.label}
              {t.count != null && (
                <span className={cn(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums',
                  tab === t.id
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-400 dark:text-zinc-500',
                )}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Stats row — 5 cards */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard label="Users" value={statsData?.total_users ?? '—'} sub={statsData ? `${statsData.total_active_users} active` : '—'} />
          <StatCard label="Admins" value={statsData?.total_admins ?? '—'} sub="Elevated access" />
          <StatCard label="Projects" value={statsData?.total_projects ?? '—'} sub="All projects" />
          <StatCard label="Memberships" value={statsData?.total_memberships ?? '—'} sub="Across all projects" />
          <StatCard label="Documents" value={statsData?.total_documents ?? '—'} sub="Platform total" />
        </div>

        {/* ── Users tab ── */}
        {tab === 'users' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-[#1f1f1f]">
              <input
                type="search"
                placeholder="Search name or email…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-zinc-600 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}
                className="px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-gray-600 dark:text-zinc-300 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] dark:[color-scheme:dark]">
                <option value="all">All roles</option>
                <option value="admin">Admin</option>
                <option value="user">Member</option>
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                className="px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-gray-600 dark:text-zinc-300 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] dark:[color-scheme:dark]">
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <span className="text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap tabular-nums">
                {filteredUsers.length} of {usersData?.total ?? 0}
              </span>
            </div>

            {usersLoading ? (
              <div className="flex items-center justify-center p-10">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-[#0d0d0d]">
                  <tr>
                    <Th>User</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Projects</Th>
                    <Th>Last active</Th>
                    <Th>Joined</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                  {filteredUsers.map((user: User) => (
                    <tr key={user.id} className="hover:bg-gray-50/50 dark:hover:bg-[#0d0d0d]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar email={user.email} name={user.full_name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user.full_name || '—'}</p>
                            <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className={cn(
                              'text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity',
                              ROLE_PILL[user.role] ?? ROLE_PILL.user,
                            )}>
                              {ROLE_LABEL[user.role] ?? user.role}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onClick={() => updateMutation.mutate({ userId: user.id, updates: { role: 'user' } })}
                              disabled={user.role === 'user'}
                            >
                              Member
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updateMutation.mutate({ userId: user.id, updates: { role: 'admin' } })}
                              disabled={user.role === 'admin'}
                            >
                              Admin
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', user.is_active ? 'bg-green-500' : 'bg-gray-300 dark:bg-zinc-600')} />
                          <span className="text-xs text-gray-500 dark:text-zinc-400">{user.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-400 tabular-nums">
                        {user.project_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                        {user.last_seen_at ? formatRelativeTime(user.last_seen_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors p-0.5 rounded">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => updateMutation.mutate({ userId: user.id, updates: { is_active: !user.is_active } })}>
                              <ToggleLeft className="h-3.5 w-3.5" />
                              Toggle status
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onClick={() => {
                                if (confirm(`Delete ${user.email}? This cannot be undone.`)) {
                                  deleteMutation.mutate(user.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-zinc-600">
                        No users match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {usersTotalPages > 1 && (
              <PaginationBar
                page={usersPage} total={usersData?.total ?? 0} totalPages={usersTotalPages}
                onPrev={() => setUsersPage(p => Math.max(1, p - 1))}
                onNext={() => setUsersPage(p => Math.min(usersTotalPages, p + 1))}
              />
            )}
          </div>
        )}

        {/* ── Projects tab ── */}
        {tab === 'projects' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-[#1f1f1f]">
              <input
                type="search"
                placeholder="Search projects…"
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-zinc-600 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
              <span className="text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap tabular-nums">
                {filteredProjects.length} of {projectsData?.total ?? 0}
              </span>
            </div>

            {projectsLoading ? (
              <div className="flex items-center justify-center p-10">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-[#0d0d0d]">
                  <tr>
                    <Th>Project</Th>
                    <Th>Owner</Th>
                    <Th>Members</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                  {filteredProjects.map((project: any) => (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50/50 dark:hover:bg-[#0d0d0d] cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar email={project.owner_email || project.id} name={project.name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{project.name}</p>
                            {project.description && (
                              <p className="text-xs text-gray-400 dark:text-zinc-500 truncate max-w-xs">{project.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700 dark:text-zinc-300">{project.owner_name || '—'}</p>
                        {project.owner_name && (
                          <p className="text-xs text-gray-400 dark:text-zinc-500">{project.owner_email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-400 tabular-nums">
                        {project.member_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                        {formatRelativeTime(project.created_at)}
                      </td>
                    </tr>
                  ))}
                  {filteredProjects.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-zinc-600">
                        No projects found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {projectsTotalPages > 1 && (
              <PaginationBar
                page={projectsPage} total={projectsData?.total ?? 0} totalPages={projectsTotalPages}
                onPrev={() => setProjectsPage(p => Math.max(1, p - 1))}
                onNext={() => setProjectsPage(p => Math.min(projectsTotalPages, p + 1))}
              />
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
