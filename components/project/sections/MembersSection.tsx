'use client';

import { useState, useEffect } from 'react';
import {
  Users, Search, ChevronDown, Loader2,
  MoreHorizontal, Link2, Mail, Trash2, Check,
  UserCog, Crown, X, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectMember, ProjectInvitation, ProjectMemberUpdate, ProjectRole } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PermissionGate } from '@/components/ui/permission-gate';
import {
  PERMISSION_KEYS, PermissionGroupList, grantedCount, MICRO_LABEL,
  type PermissionKey,
} from '@/components/project/permissionCatalog';

// ── Constants ────────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  owner:   'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
  manager: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  member:  'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-400/15',
  viewer:  'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-400/15',
};
const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer',
};

const EDITABLE_ROLES: { value: ProjectRole; label: string }[] = [
  { value: 'owner',   label: 'Owner'   },
  { value: 'manager', label: 'Manager' },
  { value: 'member',  label: 'Member'  },
  { value: 'viewer',  label: 'Viewer'  },
];

// What each preset actually means, shown under the role pills in the drawer.
const ROLE_SUMMARY: Record<string, string> = {
  owner:   'Complete project control, including ownership transfer and project deletion.',
  manager: 'Administrative workflow access without ownership transfer or project deletion.',
  member:  'Custom access — grant only the capabilities this person needs.',
  viewer:  'Read-only by default. The individual permissions below still apply.',
};

// Roles whose access is fixed by the preset: the backend resolves owner and
// manager from ROLE presets and never reads the stored per-member flags, so
// showing editable switches for them would be a lie.
const PRESET_ROLES = new Set<ProjectRole>(['owner', 'manager']);

// House pill, lifted from app/(dashboard)/results/page.tsx:134.
const PILL_BASE =
  'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40';
const PILL_ON =
  'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100';
const PILL_OFF =
  'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:text-gray-800 dark:hover:text-zinc-200';

// ── Props ────────────────────────────────────────────────────────────────────

interface MembersSectionProps {
  projectId: string;
  members: ProjectMember[];
  onMembersChange: (members: ProjectMember[]) => void;
  onInvite: () => void;
  onOwnerTransferred?: () => Promise<void>;
  ownerId?: string;
  projectName?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function accessSummary(m: ProjectMember, role: string): { title: string; sub: string } {
  if (role === 'owner')   return { title: 'Full access',    sub: 'All capabilities' };
  if (role === 'manager') return { title: 'Administrative', sub: 'Preset role' };
  const n = grantedCount(m as Partial<Record<PermissionKey, boolean>>);
  if (role === 'viewer')  return { title: 'Read only',      sub: `${n} of ${PERMISSION_KEYS.length} permissions` };
  return { title: `${n} permission${n === 1 ? '' : 's'}`, sub: 'Custom access' };
}

function lastActiveDot(last_seen_at: string | null) {
  if (!last_seen_at) return null;
  const diff = Date.now() - new Date(last_seen_at).getTime();
  const isRecent = diff < 5 * 60 * 1000;
  return (
    <span className={cn(
      'inline-block w-1.5 h-1.5 rounded-full shrink-0',
      isRecent ? 'bg-green-500' : 'bg-gray-300 dark:bg-zinc-600',
    )} />
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function MembersSection({
  projectId, members, onMembersChange, onInvite, onOwnerTransferred, ownerId, projectName,
}: MembersSectionProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<ProjectRole | 'all'>('all');
  const [drawerMember, setDrawerMember] = useState<ProjectMember | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  const [editPerms, setEditPerms] = useState<ProjectMemberUpdate>({});
  const [draftRole, setDraftRole] = useState<ProjectRole>('member');
  const [saving, setSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<ProjectMember | null>(null);
  const [transferRole, setTransferRole] = useState<'manager' | 'member' | 'viewer' | 'none'>('manager');
  const [transferring, setTransferring] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<ProjectMember | null>(null);
  const [promoting, setPromoting] = useState(false);

  // Fetch invitations whenever member list changes (including after invite modal close)
  useEffect(() => {
    setLoadingInvitations(true);
    projectMembersService.listInvitations(projectId)
      .then(setInvitations)
      .catch(() => setInvitations([]))
      .finally(() => setLoadingInvitations(false));
  }, [projectId, members.length]);

  // Slide the drawer in on the frame after mount. There is no animation plugin
  // in this Tailwind build, so the transition is driven by a state flag — same
  // approach as ImportedTrialDrawer.
  useEffect(() => {
    if (!drawerMember) return;
    const raf = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(raf);
  }, [drawerMember]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerMember) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerMember]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalManagers = members.filter(m => m.role === 'owner' || m.role === 'manager').length;
  const totalMembers  = members.filter(m => m.role === 'member').length;
  const totalViewers  = members.filter(m => m.role === 'viewer').length;

  // ── Filtering ────────────────────────────────────────────────────────────
  const filtered = members.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || (m.full_name || '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || m.role === roleFilter || (roleFilter === 'manager' && m.role === 'owner');
    return matchSearch && matchRole;
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  const openDrawer = (member: ProjectMember) => {
    setDraftRole((member.role || 'member') as ProjectRole);
    setEditPerms({
      can_view_docs: member.can_view_docs,
      can_upload_docs: member.can_upload_docs,
      can_create_forms: member.can_create_forms,
      can_run_extractions: member.can_run_extractions,
      can_run_manual_extractions: member.can_run_manual_extractions,
      can_view_results: member.can_view_results,
      can_adjudicate: member.can_adjudicate,
      can_qa_review: member.can_qa_review,
      can_manage_assignments: member.can_manage_assignments,
      can_manage_members: member.can_manage_members,
    });
    setDrawerMember(member);
  };

  const closeDrawer = () => {
    setDrawerIn(false);
    setTimeout(() => setDrawerMember(null), 240);
  };

  const handleSave = async (userId: string) => {
    const original = members.find(m => m.user_id === userId);
    // Only send `role` when the pill actually changed. Otherwise the backend
    // re-derives the role from the resulting flag set, which is the behaviour
    // this screen has always had.
    const payload: ProjectMemberUpdate = draftRole !== (original?.role || 'member')
      ? { ...editPerms, role: draftRole }
      : editPerms;
    setSaving(true);
    try {
      const updated = await projectMembersService.updateMember(projectId, userId, payload);
      onMembersChange(members.map(m => m.user_id === userId ? { ...m, ...updated } : m));
      closeDrawer();
      toast({ title: 'Access updated' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      const msg = detail.includes('at least one owner')
        ? 'A project must have at least one owner. Promote someone else first.'
        : detail || 'Failed to update member';
      toast({ title: 'Error', description: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleQuickRoleChange = async (member: ProjectMember, newRole: ProjectRole) => {
    if (newRole === 'owner' && member.role !== 'owner') {
      setPromoteTarget(member);
      return;
    }
    try {
      const updated = await projectMembersService.updateMember(projectId, member.user_id, { role: newRole });
      onMembersChange(members.map(m => m.user_id === member.user_id ? { ...m, ...updated } : m));
      toast({ title: 'Role updated' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      const msg = detail.includes('at least one owner')
        ? 'A project must have at least one owner. Promote someone else first.'
        : detail || 'Failed to update role';
      toast({ title: 'Error', description: msg, variant: 'error' });
    }
  };

  const handlePromoteConfirm = async () => {
    if (!promoteTarget) return;
    setPromoting(true);
    try {
      const updated = await projectMembersService.updateMember(projectId, promoteTarget.user_id, { role: 'owner' });
      onMembersChange(members.map(m => m.user_id === promoteTarget.user_id ? { ...m, ...updated } : m));
      toast({ title: 'Promoted to owner' });
      setPromoteTarget(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.response?.data?.detail || 'Failed to promote member', variant: 'error' });
    } finally {
      setPromoting(false);
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (!confirm(`Remove ${member.full_name || member.email} from this project?`)) return;
    try {
      await projectMembersService.removeMember(projectId, member.user_id);
      onMembersChange(members.filter(m => m.user_id !== member.user_id));
      closeDrawer();
      toast({ title: 'Member removed' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      const msg = detail.includes('at least one owner')
        ? 'A project must have at least one owner. Promote someone else first.'
        : 'Failed to remove member';
      toast({ title: 'Error', description: msg, variant: 'error' });
    }
  };

  const handleTransferOwnership = (member: ProjectMember) => {
    setTransferRole('manager');
    setTransferTarget(member);
  };

  const handleTransferConfirm = async () => {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      await projectMembersService.transferOwnership(projectId, transferTarget.user_id, transferRole);
      toast({ title: 'Ownership transferred' });
      setTransferTarget(null);
      const refreshed = await projectMembersService.listMembers(projectId);
      onMembersChange(refreshed);
      await onOwnerTransferred?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.response?.data?.detail || 'Failed to transfer ownership', variant: 'error' });
    } finally {
      setTransferring(false);
    }
  };

  const handleCopyLink = async () => {
    const url = invitations[0]?.accept_url;
    if (!url) {
      toast({ title: 'No pending invitations', description: 'Invite a member first to get a link.' });
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast({ title: 'Link copied' });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRevoke = async (inv: ProjectInvitation) => {
    setRevokingId(inv.id);
    try {
      await projectMembersService.revokeInvitation(projectId, inv.id);
      setInvitations(prev => prev.filter(i => i.id !== inv.id));
      toast({ title: 'Invitation revoked' });
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke invitation', variant: 'error' });
    } finally {
      setRevokingId(null);
    }
  };

  const handleResend = async (inv: ProjectInvitation) => {
    setResendingId(inv.id);
    try {
      const updated = await projectMembersService.resendInvitation(projectId, inv.id);
      setInvitations(prev => prev.map(i => i.id === inv.id ? updated : i));
      if (updated.accept_url) {
        await navigator.clipboard.writeText(updated.accept_url);
        toast({ title: 'Link refreshed & copied' });
      } else {
        toast({ title: 'Invitation refreshed' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to resend invitation', variant: 'error' });
    } finally {
      setResendingId(null);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const me = members.find(m => m.user_id === currentUser?.id);
  const isCurrentUserOwner = me?.role === 'owner';
  const canManageMembers = isCurrentUserOwner || me?.role === 'manager' || !!me?.can_manage_members;
  const drawerIsPreset = PRESET_ROLES.has(draftRole);
  const draftGranted = grantedCount(editPerms as Partial<Record<PermissionKey, boolean>>);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <PermissionGate permission="can_manage_members">
    <>
    <div className="space-y-5">

      {/* ── Header band — same treatment as the Documents evidence-search panel ── */}
      <div className="rounded-2xl px-6 py-6 sm:px-8 sm:py-7 bg-gradient-to-br from-[#0d1526] via-[#141d35] to-[#1c2b4d]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-blue-400">
              Team workspace
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Members &amp; access</h2>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">
              Keep the project simple for collaborators and precise for admins. Use a role preset
              for most people, or open custom access when someone needs something specific.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleCopyLink}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/15"
            >
              {copiedLink ? <Check className="h-4 w-4 text-green-400" /> : <Link2 className="h-4 w-4" />}
              Copy invite link
            </button>
            <button
              onClick={onInvite}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Users className="h-4 w-4" />
              Invite member
            </button>
          </div>
        </div>
      </div>

      {/* ── Metrics ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-100 bg-gray-100 dark:border-[#1f1f1f] dark:bg-[#1f1f1f] sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Total people',  value: members.length,     sub: 'All active members' },
          { label: 'Admins',        value: totalManagers,      sub: 'Owners + managers' },
          { label: 'Custom access', value: totalMembers,       sub: 'Granular permissions' },
          { label: 'Viewers',       value: totalViewers,       sub: 'Read-only' },
          {
            label: 'Pending',
            value: invitations.length,
            sub: invitations.length === 0 ? 'None waiting' : 'Awaiting response',
            accent: invitations.length > 0,
          },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="bg-white px-4 py-4 dark:bg-[#111111]">
            <p className={MICRO_LABEL}>{label}</p>
            <p className={cn(
              'mt-1.5 text-2xl font-bold leading-none tracking-tight tabular-nums',
              accent ? 'text-amber-500' : 'text-gray-900 dark:text-white',
            )}>
              {value}
            </p>
            <p className="mt-1.5 text-[11px] text-gray-400 dark:text-zinc-600">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Pending invitations ────────────────────────────────────────── */}
      {invitations.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 dark:border-amber-400/20">
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-400/20 dark:bg-amber-400/5">
            <Mail size={13} className="text-amber-500" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Pending invitations</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-500 dark:bg-amber-400/20">
              {invitations.length}
            </span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-[#111111]">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-[#1f1f1f]">
                  <Mail size={12} className="text-gray-400 dark:text-zinc-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-zinc-200">{inv.email}</p>
                  <p className="text-xs text-gray-400 dark:text-zinc-500">
                    {inv.invited_by_name ? `Invited by ${inv.invited_by_name}` : 'Invited'} · {formatRelativeTime(inv.created_at)}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', ROLE_BADGE[inv.role] || ROLE_BADGE.member)}>
                  {ROLE_LABEL[inv.role] || inv.role}
                </span>
                <button
                  onClick={() => handleResend(inv)}
                  disabled={resendingId === inv.id}
                  className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
                >
                  {resendingId === inv.id ? <Loader2 size={11} className="animate-spin" /> : 'Resend'}
                </button>
                <button
                  onClick={() => handleRevoke(inv)}
                  disabled={revokingId === inv.id}
                  className="shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-400/20 dark:hover:bg-red-400/5"
                >
                  {revokingId === inv.id ? <Loader2 size={11} className="animate-spin" /> : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── People ─────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-[#1a1a1a] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2.5">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search people or email"
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 transition-colors placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-white dark:placeholder-zinc-600 dark:focus:border-[#3f3f3f]"
              />
            </div>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors focus:border-gray-400 focus:outline-none dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300 dark:focus:border-[#3f3f3f]"
            >
              <option value="all">All roles</option>
              <option value="manager">Manager</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <span className="shrink-0 text-xs text-gray-400 dark:text-zinc-500">
            {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
          </span>
        </div>

        {/* Column head */}
        <div className={cn(
          'hidden items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-2 dark:border-[#1a1a1a] dark:bg-[#0d0d0d] md:grid',
          'grid-cols-[minmax(0,2.1fr)_0.8fr_1fr_auto_32px]',
          MICRO_LABEL,
        )}>
          <div>Person</div>
          <div>Last active</div>
          <div>Access</div>
          <div className="w-20">Role</div>
          <div />
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">No members match your search.</div>
        ) : (
          filtered.map((member, i) => {
            const isOwner = member.role === 'owner';
            const memberRole = (member.role || 'member') as ProjectRole;
            const canCustomizePerms = memberRole === 'manager' || memberRole === 'member' || memberRole === 'viewer';
            const isCurrentUser = currentUser?.id === member.user_id;
            const access = accessSummary(member, memberRole);

            return (
              <div
                key={member.user_id}
                onClick={() => canCustomizePerms && openDrawer(member)}
                className={cn(
                  'group grid grid-cols-[minmax(0,1fr)_auto_32px] items-center gap-3 px-4 py-3 transition-colors',
                  'md:grid-cols-[minmax(0,2.1fr)_0.8fr_1fr_auto_32px]',
                  i > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]',
                  canCustomizePerms && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#0d0d0d]',
                )}
              >
                {/* Person */}
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar email={member.email} name={member.full_name} size="md" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-800 dark:text-zinc-200">
                        {member.full_name || member.email}
                      </span>
                      {isCurrentUser && (
                        <span className="shrink-0 text-[10px] font-medium text-gray-400 dark:text-zinc-500">(you)</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-400 dark:text-zinc-500">{member.email}</p>
                  </div>
                </div>

                {/* Last active */}
                <div className="hidden items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500 md:flex">
                  {member.last_seen_at ? (
                    <>
                      {lastActiveDot(member.last_seen_at)}
                      <span className="whitespace-nowrap">{formatRelativeTime(member.last_seen_at)}</span>
                    </>
                  ) : (
                    <span className="text-gray-300 dark:text-zinc-700">—</span>
                  )}
                </div>

                {/* Access */}
                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-xs font-medium text-gray-600 dark:text-zinc-300">{access.title}</p>
                  <p className="truncate text-[11px] text-gray-400 dark:text-zinc-600">{access.sub}</p>
                </div>

                {/* Role */}
                <div className="flex w-20 justify-start" onClick={e => e.stopPropagation()}>
                  {canManageMembers && !isOwner ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={cn(
                          'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80 focus:outline-none',
                          ROLE_BADGE[memberRole] || ROLE_BADGE.member,
                        )}>
                          {ROLE_LABEL[memberRole] || memberRole}
                          <ChevronDown size={9} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {EDITABLE_ROLES.filter(r => r.value !== 'owner' || isCurrentUserOwner).map(r => (
                          <DropdownMenuItem
                            key={r.value}
                            onClick={() => handleQuickRoleChange(member, r.value)}
                          >
                            <span className={cn('h-2 w-2 rounded-full', {
                              'bg-amber-400': r.value === 'owner',
                              'bg-blue-400':  r.value === 'manager',
                              'bg-gray-400':  r.value === 'member',
                              'bg-green-400': r.value === 'viewer',
                            })} />
                            {r.label}
                            {member.role === r.value && <Check size={12} className="ml-auto text-gray-400" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      ROLE_BADGE[memberRole] || ROLE_BADGE.member,
                    )}>
                      {ROLE_LABEL[memberRole] || memberRole}
                    </span>
                  )}
                </div>

                {/* Kebab */}
                <div className="flex w-8 justify-end" onClick={e => e.stopPropagation()}>
                  {canManageMembers && !isCurrentUser && !isOwner && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-zinc-500 dark:hover:bg-[#1f1f1f]">
                          <MoreHorizontal size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canCustomizePerms && (
                          <DropdownMenuItem onClick={() => openDrawer(member)}>
                            <UserCog size={13} />
                            Edit access
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleTransferOwnership(member)}>
                          <Crown size={13} />
                          Transfer ownership
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onClick={() => handleRemove(member)}>
                          <Trash2 size={13} />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ── Role legend ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-[#1f1f1f] md:grid-cols-4">
        {[
          { role: 'owner',   desc: 'Full control. Can transfer ownership and delete the project.' },
          { role: 'manager', desc: 'Manage members, run extractions and reach consensus.' },
          { role: 'member',  desc: 'Custom permissions. Set granular access per member.' },
          { role: 'viewer',  desc: 'Read-only access to documents and results.' },
        ].map(({ role, desc }) => (
          <div key={role} className="rounded-lg border border-gray-100 p-3 dark:border-[#1f1f1f]">
            <span className={cn('mb-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold', ROLE_BADGE[role])}>
              {ROLE_LABEL[role]}
            </span>
            <p className="text-xs leading-relaxed text-gray-400 dark:text-zinc-500">{desc}</p>
          </div>
        ))}
      </div>

    </div>

      {/* ── Overlays ────────────────────────────────────────────────────
          These live OUTSIDE the `space-y-5` wrapper on purpose. Tailwind's
          space-y applies `margin-top` to every child but the first via
          `> * + *`, and a margin on a `position: fixed` element shifts it off
          its inset — which pushed the drawer and its scrim 20px down the
          viewport and left a chopped strip of navbar above them. */}

      {/* Access drawer — same frame as ImportedTrialDrawer */}
      {drawerMember && (
        <>
          <div
            onClick={closeDrawer}
            className={cn(
              'fixed inset-0 z-[60] bg-black/15 transition-opacity duration-200 dark:bg-black/40',
              drawerIn ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          />
          <aside
            role="dialog"
            aria-label={`Access for ${drawerMember.full_name || drawerMember.email}`}
            className={cn(
              'fixed right-0 top-0 z-[70] flex h-screen w-[min(560px,95vw)] flex-col',
              'border-l border-gray-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#0f0f0f]',
              'transition-transform duration-300 ease-out',
              drawerIn ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            {/* Head */}
            <div className="shrink-0 border-b border-gray-100 px-5 pb-4 pt-5 dark:border-[#1a1a1a]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar email={drawerMember.email} name={drawerMember.full_name} size="lg" />
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
                      {drawerMember.full_name || drawerMember.email}
                    </h3>
                    <p className="truncate text-xs text-gray-400 dark:text-zinc-500">{drawerMember.email}</p>
                  </div>
                </div>
                <button
                  onClick={closeDrawer}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-zinc-500 dark:hover:bg-[#1f1f1f]"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Role preset pills */}
              <div className="mt-4">
                <p className={cn(MICRO_LABEL, 'mb-2')}>Role preset</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {EDITABLE_ROLES.map(r => {
                    const active = draftRole === r.value;
                    const locked = r.value === 'owner' && !isCurrentUserOwner;
                    return (
                      <button
                        key={r.value}
                        type="button"
                        disabled={locked}
                        onClick={() => setDraftRole(r.value)}
                        className={cn(PILL_BASE, active ? PILL_ON : PILL_OFF)}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500 dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-400">
                  {ROLE_SUMMARY[draftRole]}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className={MICRO_LABEL}>
                    {drawerIsPreset ? 'Included capabilities' : 'Custom permissions'}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
                    {drawerIsPreset
                      ? 'Fixed by the role — switch to Member or Viewer to change them.'
                      : 'Only what you switch on is granted.'}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-400 dark:text-zinc-600">
                  {drawerIsPreset ? PERMISSION_KEYS.length : draftGranted} of {PERMISSION_KEYS.length} on
                </span>
              </div>

              <div className={cn('transition-opacity', drawerIsPreset && 'pointer-events-none opacity-60')}>
                <PermissionGroupList
                  disabled={drawerIsPreset}
                  value={
                    drawerIsPreset
                      ? Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])) as Record<PermissionKey, boolean>
                      : editPerms as Partial<Record<PermissionKey, boolean>>
                  }
                  onChange={(key, next) => setEditPerms(prev => ({ ...prev, [key]: next }))}
                />
              </div>

              {drawerIsPreset && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-3 dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
                  <ShieldCheck size={14} className="mt-px shrink-0 text-gray-400 dark:text-zinc-500" />
                  <p className="text-xs leading-relaxed text-gray-500 dark:text-zinc-400">
                    The <strong className="font-semibold text-gray-700 dark:text-zinc-200">{ROLE_LABEL[draftRole]}</strong> role
                    resolves permissions from a preset, so per-person switches are not read for this role.
                  </p>
                </div>
              )}

              {/* Danger zone */}
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-[#1f1f1f]">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-zinc-200">Remove from project</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500">This person immediately loses project access.</p>
                </div>
                <button
                  onClick={() => handleRemove(drawerMember)}
                  disabled={saving}
                  className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-400/20 dark:hover:bg-red-400/5"
                >
                  Remove member
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3.5 dark:border-[#1a1a1a]">
              <p className="text-[11px] text-gray-400 dark:text-zinc-500">Changes apply as soon as you save.</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeDrawer}
                  disabled={saving}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-[#1a1a1a] dark:text-zinc-400 dark:hover:bg-[#2a2a2a]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSave(drawerMember.user_id)}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-gray-900"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  Save access
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Transfer ownership dialog */}
      {transferTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
              <div className="flex items-center gap-3">
                <Avatar email={transferTarget.email} name={transferTarget.full_name} size="md" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Transfer ownership</h3>
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                    {transferTarget.full_name || transferTarget.email} will become the new owner.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTransferTarget(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors shrink-0 ml-2"
              >
                <X size={14} />
              </button>
            </div>

            {/* Role selector */}
            <div className="px-5 py-4 space-y-2">
              <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
                Your role after transfer
              </p>
              {([
                { value: 'manager', label: 'Manager',       desc: 'Full access except project deletion.' },
                { value: 'member',  label: 'Member',        desc: 'Custom granular permissions (all off by default).' },
                { value: 'viewer',  label: 'Viewer',        desc: 'Read-only access to documents and results.' },
                { value: 'none',    label: 'Leave project', desc: 'You will no longer have access.' },
              ] as const).map(opt => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    transferRole === opt.value
                      ? 'border-gray-400 dark:border-zinc-500 bg-gray-50 dark:bg-[#1a1a1a]'
                      : 'border-gray-100 dark:border-[#1f1f1f] hover:border-gray-200 dark:hover:border-[#2a2a2a]',
                  )}
                >
                  <input
                    type="radio"
                    name="transferRole"
                    value={opt.value}
                    checked={transferRole === opt.value}
                    onChange={() => setTransferRole(opt.value)}
                    className="mt-0.5 accent-gray-900 dark:accent-white"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-zinc-200">{opt.label}</p>
                    <p className="text-xs text-gray-400 dark:text-zinc-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-[#1f1f1f]">
              <button
                onClick={() => setTransferTarget(null)}
                disabled={transferring}
                className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg px-4 py-2 hover:bg-gray-200 dark:hover:bg-[#2a2a2a] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleTransferConfirm}
                disabled={transferring}
                className="flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {transferring && <Loader2 size={12} className="animate-spin" />}
                Transfer ownership
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promote to owner confirm dialog */}
      {promoteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
              <div className="flex items-center gap-3">
                <Avatar email={promoteTarget.email} name={promoteTarget.full_name} size="md" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Promote to owner</h3>
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                    {promoteTarget.full_name || promoteTarget.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPromoteTarget(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors shrink-0 ml-2"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                What this means
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                This person will get full control — they can manage all members, run extractions, reach consensus on results, promote or demote other owners, and delete the project. You will remain an owner.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-[#1f1f1f]">
              <button
                onClick={() => setPromoteTarget(null)}
                disabled={promoting}
                className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg px-4 py-2 hover:bg-gray-200 dark:hover:bg-[#2a2a2a] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handlePromoteConfirm}
                disabled={promoting}
                className="flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {promoting && <Loader2 size={12} className="animate-spin" />}
                Promote to owner
              </button>
            </div>
          </div>
        </div>
      )}
    </>
    </PermissionGate>
  );
}
