'use client';

import { useState, useEffect } from 'react';
import {
  Users, Search, ChevronDown, Save, Loader2,
  MoreHorizontal, Link2, Mail, Trash2, Shield, Copy, Check,
  UserCog, Crown, X,
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

const ALL_PERMS: { key: keyof ProjectMemberUpdate; label: string }[] = [
  { key: 'can_view_docs',               label: 'View Documents'        },
  { key: 'can_upload_docs',             label: 'Upload Documents'      },
  { key: 'can_create_forms',            label: 'Create Forms'          },
  { key: 'can_run_extractions',         label: 'Run AI Extractions'    },
  { key: 'can_run_manual_extractions',  label: 'Run Manual Extractions'},
  { key: 'can_view_results',            label: 'View Results'          },
  { key: 'can_adjudicate',              label: 'Consensus'             },
  { key: 'can_manage_assignments',      label: 'Manage Assignments'    },
  { key: 'can_manage_members',          label: 'Manage Members'        },
];

const VISIBLE_PERM_KEYS = ALL_PERMS
  .map(p => p.key)
  .filter(k => k !== 'can_manage_members' && k !== 'can_manage_assignments') as (keyof ProjectMember)[];

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

const isOwnerMember = (m: ProjectMember) => m.role === 'owner';

function permSummary(m: ProjectMember, role: string): string {
  if (role === 'owner') return 'Full access';
  const count = VISIBLE_PERM_KEYS.filter(k => m[k]).length;
  return `${count} of ${VISIBLE_PERM_KEYS.length} permissions`;
}

function lastActiveDot(last_seen_at: string | null) {
  if (!last_seen_at) return null;
  const diff = Date.now() - new Date(last_seen_at).getTime();
  const isRecent = diff < 5 * 60 * 1000;
  return (
    <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', isRecent ? 'bg-green-500' : 'bg-gray-300 dark:bg-zinc-600')} />
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<ProjectMemberUpdate>({});
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

  const handleExpand = (member: ProjectMember) => {
    if (expandedId === member.user_id) { setExpandedId(null); return; }
    setExpandedId(member.user_id);
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
  };

  const handleSave = async (userId: string) => {
    setSaving(true);
    try {
      const updated = await projectMembersService.updateMember(projectId, userId, editPerms);
      onMembersChange(members.map(m => m.user_id === userId ? { ...m, ...updated } : m));
      setExpandedId(null);
      toast({ title: 'Permissions updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.response?.data?.detail || 'Failed to update member', variant: 'error' });
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
      setExpandedId(null);
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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <PermissionGate permission="can_manage_members">
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Members</h2>
          <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">Manage who can access this project and what they can do.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
          >
            {copiedLink ? <Check size={12} className="text-green-500" /> : <Link2 size={12} />}
            Copy invite link
          </button>
          <button
            onClick={onInvite}
            className="flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
          >
            <Users size={12} />
            Invite members
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-px bg-gray-100 dark:bg-[#1f1f1f] rounded-xl overflow-hidden border border-gray-100 dark:border-[#1f1f1f]">
        {[
          { label: 'Total members',   value: members.length,    sub: 'All roles' },
          { label: 'Managers',        value: totalManagers,     sub: 'Owner + managers' },
          { label: 'Members',         value: totalMembers,      sub: 'Custom permissions' },
          { label: 'Viewers',         value: totalViewers,      sub: 'Read-only' },
          { label: 'Pending invites', value: invitations.length, sub: 'Awaiting response', accent: invitations.length > 0 },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="bg-white dark:bg-[#111111] px-4 py-4">
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-1">{label}</p>
            <p className={cn('text-2xl font-bold tracking-tight', accent ? 'text-amber-500' : 'text-gray-900 dark:text-white')}>{value}</p>
            <p className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-400/20 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-400/5 border-b border-amber-200 dark:border-amber-400/20">
            <Mail size={13} className="text-amber-500" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Pending invitations</span>
            <span className="text-xs font-bold text-amber-500 bg-amber-100 dark:bg-amber-400/20 px-1.5 py-0.5 rounded-full">{invitations.length}</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#111111]">
                <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-[#1f1f1f] flex items-center justify-center shrink-0">
                  <Mail size={12} className="text-gray-400 dark:text-zinc-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 truncate">{inv.email}</p>
                  <p className="text-xs text-gray-400 dark:text-zinc-500">
                    {inv.invited_by_name ? `Invited by ${inv.invited_by_name}` : 'Invited'} · {formatRelativeTime(inv.created_at)}
                  </p>
                </div>
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', ROLE_BADGE[inv.role] || ROLE_BADGE.member)}>
                  {ROLE_LABEL[inv.role] || inv.role}
                </span>
                <button
                  onClick={() => handleResend(inv)}
                  disabled={resendingId === inv.id}
                  className="text-xs font-medium text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-40 shrink-0"
                >
                  {resendingId === inv.id ? <Loader2 size={11} className="animate-spin" /> : 'Resend'}
                </button>
                <button
                  onClick={() => handleRevoke(inv)}
                  disabled={revokingId === inv.id}
                  className="text-xs font-medium text-red-500 border border-red-200 dark:border-red-400/20 rounded-md px-2.5 py-1 hover:bg-red-50 dark:hover:bg-red-400/5 transition-colors disabled:opacity-40 shrink-0"
                >
                  {revokingId === inv.id ? <Loader2 size={11} className="animate-spin" /> : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-600 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}
          className="text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 px-3 py-1.5 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
        >
          <option value="all">All roles</option>
          <option value="manager">Manager</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
        <span className="text-xs text-gray-400 dark:text-zinc-500 ml-auto">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Member list */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400 dark:text-zinc-500">No members match your search.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f]">
          {(() => {
            const me = members.find(m => m.user_id === currentUser?.id);
            const isCurrentUserOwner = me?.role === 'owner';
            const canManageMembers = isCurrentUserOwner || me?.role === 'manager' || !!me?.can_manage_members;
            return filtered.map((member, i) => {
            const isOwner = member.role === 'owner';
            const memberRole = member.role || 'member';
            const canCustomizePerms = memberRole === 'manager' || memberRole === 'member' || memberRole === 'viewer';
            const isExpanded = canCustomizePerms && expandedId === member.user_id;
            const isCurrentUser = currentUser?.id === member.user_id;

            return (
              <div
                key={member.user_id}
                className={cn(i < filtered.length - 1 && 'border-b border-gray-100 dark:border-[#1a1a1a]')}
              >
                {/* Row */}
                <div
                  onClick={() => canCustomizePerms && handleExpand(member)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors',
                    canCustomizePerms && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#0d0d0d]',
                    isExpanded && 'bg-gray-50 dark:bg-[#0d0d0d]',
                  )}
                >
                  <Avatar email={member.email} name={member.full_name} size="md" />

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-gray-800 dark:text-zinc-200 truncate">
                        {member.full_name || member.email}
                      </span>
                      {isCurrentUser && (
                        <span className="text-[10px] font-medium text-gray-400 dark:text-zinc-500">(you)</span>
                      )}
                    </div>
                    {member.full_name && (
                      <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{member.email}</p>
                    )}
                  </div>

                  {/* Last active */}
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500 shrink-0 w-28 justify-start">
                    {member.last_seen_at ? (
                      <>
                        {lastActiveDot(member.last_seen_at)}
                        <span className="whitespace-nowrap">{formatRelativeTime(member.last_seen_at)}</span>
                      </>
                    ) : (
                      <span className="text-gray-300 dark:text-zinc-700">—</span>
                    )}
                  </div>

                  {/* Permission summary */}
                  <div className="hidden md:block text-xs text-gray-400 dark:text-zinc-500 shrink-0 w-32 text-right">
                    {canCustomizePerms ? (
                      <span className="flex items-center justify-end gap-1">
                        <Shield size={11} className="text-gray-300 dark:text-zinc-600" />
                        {permSummary(member, memberRole)}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-zinc-500">{permSummary(member, memberRole)}</span>
                    )}
                  </div>

                  {/* Role pill / dropdown */}
                  <div className="w-20 flex justify-end shrink-0" onClick={e => e.stopPropagation()}>
                    {canManageMembers && !isOwner ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={cn(
                            'flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-opacity hover:opacity-80 focus:outline-none',
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
                              <span className={cn('w-2 h-2 rounded-full', {
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
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', ROLE_BADGE[memberRole] || ROLE_BADGE.member)}>
                        {ROLE_LABEL[memberRole] || memberRole}
                      </span>
                    )}
                  </div>

                  {/* Kebab menu — visible to anyone with manage perms on non-owner, non-self rows */}
                  <div className="w-6 flex items-center justify-end shrink-0" onClick={e => e.stopPropagation()}>
                    {canManageMembers && !isCurrentUser && !isOwner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors">
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canCustomizePerms && (
                            <DropdownMenuItem onClick={() => handleExpand(member)}>
                              <UserCog size={13} />
                              Edit permissions
                            </DropdownMenuItem>
                          )}
                          {!isOwner && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleTransferOwnership(member)}>
                                <Crown size={13} />
                                Transfer ownership
                              </DropdownMenuItem>
                            </>
                          )}
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

                {/* Expanded permission editor */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50 dark:bg-[#0d0d0d]" onClick={e => e.stopPropagation()}>
                    {/* Permission toggles */}
                    <div className="grid grid-cols-2 gap-y-2.5 gap-x-6 mb-4 pt-3">
                      {ALL_PERMS
                        .filter(({ key }) => VISIBLE_PERM_KEYS.includes(key as keyof ProjectMember))
                        .map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!editPerms[key]}
                            onChange={e => setEditPerms(prev => ({ ...prev, [key]: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded accent-gray-900 dark:accent-white"
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSave(member.user_id)}
                        disabled={saving}
                        className="flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-40"
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                      <button
                        onClick={() => setExpandedId(null)}
                        className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg px-3 py-1.5 hover:bg-gray-200 dark:hover:bg-[#2a2a2a] transition-colors"
                      >
                        Cancel
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => handleRemove(member)}
                        disabled={saving}
                        className="text-xs font-medium text-red-500 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          });
          })()}
        </div>
      )}

      {/* Role legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-gray-100 dark:border-[#1f1f1f]">
        {[
          { role: 'owner',   desc: 'Full control. Can transfer ownership and delete the project.' },
          { role: 'manager', desc: 'Manage members, run extractions, reach consensus and QA review.' },
          { role: 'member',  desc: 'Custom permissions. Set granular access per member.' },
          { role: 'viewer',  desc: 'Read-only access to documents and results.' },
        ].map(({ role, desc }) => (
          <div key={role} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] p-3">
            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block mb-2', ROLE_BADGE[role])}>
              {ROLE_LABEL[role]}
            </span>
            <p className="text-xs text-gray-400 dark:text-zinc-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

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

    </div>
    </PermissionGate>
  );
}
