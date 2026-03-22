'use client';

import { useState } from 'react';
import { Users, Trash2, ChevronDown, ChevronUp, Save, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectMember, ProjectMemberUpdate } from '@/types/api';
import { useToast } from '@/hooks/use-toast';

interface MembersSectionProps {
  projectId: string;
  members: ProjectMember[];
  onMembersChange: (members: ProjectMember[]) => void;
  onInvite: () => void;
  ownerId?: string;
}

const isOwnerMember = (m: ProjectMember) => m.invited_by === null && m.created_at === null;

const ALL_PERMS: { key: keyof ProjectMemberUpdate; label: string }[] = [
  { key: 'can_view_docs', label: 'View Documents' },
  { key: 'can_upload_docs', label: 'Upload Documents' },
  { key: 'can_create_forms', label: 'Create Forms' },
  { key: 'can_run_extractions', label: 'Run Extractions' },
  { key: 'can_view_results', label: 'View Results' },
  { key: 'can_adjudicate', label: 'Adjudicate' },
  { key: 'can_qa_review', label: 'QA Review' },
  { key: 'can_manage_assignments', label: 'Manage Assignments' },
];

const PERM_BADGE_LABELS: { key: keyof ProjectMember; label: string }[] = [
  { key: 'can_view_docs', label: 'View' },
  { key: 'can_upload_docs', label: 'Upload' },
  { key: 'can_create_forms', label: 'Forms' },
  { key: 'can_run_extractions', label: 'Extract' },
  { key: 'can_view_results', label: 'Results' },
  { key: 'can_adjudicate', label: 'Adjudicate' },
  { key: 'can_qa_review', label: 'QA' },
  { key: 'can_manage_assignments', label: 'Assign' },
];

export function MembersSection({ projectId, members, onMembersChange, onInvite, ownerId }: MembersSectionProps) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<ProjectMemberUpdate>({});
  const [saving, setSaving] = useState(false);

  const handleExpand = (member: ProjectMember) => {
    if (expandedId === member.user_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(member.user_id);
    setEditPerms({
      can_view_docs: member.can_view_docs,
      can_upload_docs: member.can_upload_docs,
      can_create_forms: member.can_create_forms,
      can_run_extractions: member.can_run_extractions,
      can_view_results: member.can_view_results,
      can_adjudicate: member.can_adjudicate,
      can_qa_review: member.can_qa_review,
      can_manage_assignments: member.can_manage_assignments,
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
      const msg = err?.response?.data?.detail || 'Failed to update permissions';
      toast({ title: 'Error', description: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (!confirm(`Remove ${member.full_name || member.email} from this project?`)) return;
    try {
      await projectMembersService.removeMember(projectId, member.user_id);
      onMembersChange(members.filter(m => m.id !== member.id));
      toast({ title: 'Member removed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove member', variant: 'error' });
    }
  };

  if (members.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <Users size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No members yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Invite collaborators to give them access</div>
        <button
          onClick={onInvite}
          className="text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg py-2 px-4 hover:opacity-90 transition-opacity"
        >
          Invite Member
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">{members.length} member{members.length !== 1 ? 's' : ''} — click to edit permissions</p>
        <button
          onClick={onInvite}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-zinc-300 bg-gray-100 dark:bg-[#1f1f1f] hover:bg-gray-200 dark:hover:bg-[#2a2a2a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
        >
          <Users size={12} />
          Invite
        </button>
      </div>

      <div className="space-y-0">
        {members.map((member, i) => {
          const isOwner = ownerId === member.user_id || isOwnerMember(member);
          const isExpanded = !isOwner && expandedId === member.user_id;
          return (
            <div
              key={member.id}
              className={cn(
                i < members.length - 1 && !isExpanded && 'border-b border-gray-100 dark:border-[#1f1f1f]',
                isExpanded && 'bg-gray-50 dark:bg-[#0a0a0a] rounded-xl border border-gray-200 dark:border-[#1f1f1f] my-2',
              )}
            >
              {/* Member row */}
              <div
                onClick={() => !isOwner && handleExpand(member)}
                className={cn(
                  'flex items-start justify-between py-3 px-3 gap-4 transition-colors',
                  !isOwner && 'cursor-pointer',
                  !isExpanded && !isOwner && 'hover:bg-gray-50 dark:hover:bg-[#0a0a0a] rounded-lg',
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#1f1f1f] flex items-center justify-center shrink-0 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">
                    {(member.full_name || member.email).charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800 dark:text-zinc-300 truncate">
                        {member.full_name || member.email}
                      </p>
                      {isOwner && (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-1.5 py-0.5 rounded-full">
                          Owner
                        </span>
                      )}
                    </div>
                    {member.full_name && (
                      <p className="text-xs text-gray-400 dark:text-zinc-600 truncate">{member.email}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isExpanded && (
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {isOwner ? (
                        <span className="text-[10px] font-medium text-gray-400 dark:text-zinc-500">All permissions</span>
                      ) : (
                        PERM_BADGE_LABELS.map(({ key, label }) =>
                          member[key] ? (
                            <span key={key} className="text-[10px] font-medium rounded px-1.5 py-0.5 whitespace-nowrap bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400">
                              {label}
                            </span>
                          ) : null,
                        )
                      )}
                    </div>
                  )}
                  {!isOwner && (isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-300" />)}
                </div>
              </div>

              {/* Expanded permission editor */}
              {isExpanded && (
                <div className="px-4 pb-4" onClick={(e) => e.stopPropagation()}>
                  <div className="grid grid-cols-2 gap-y-2.5 gap-x-6 mb-4">
                    {ALL_PERMS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={editPerms[key] ?? false}
                          onChange={(e) => setEditPerms(prev => ({ ...prev, [key]: e.target.checked }))}
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
                      className="text-xs font-medium text-red-500 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
