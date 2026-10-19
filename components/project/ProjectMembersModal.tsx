'use client';

import { useState, useEffect, useRef } from 'react';
import { X, UserPlus, Lock, Search } from 'lucide-react';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectMemberInvite, ProjectRole } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

interface UserResult {
  id: string;
  email: string;
  full_name: string | null;
}

interface ProjectMembersModalProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_OPTIONS: { value: ProjectRole; label: string; description: string }[] = [
  { value: 'owner',   label: 'Owner',   description: 'Full control — manage everything, promote/demote owners, delete the project' },
  { value: 'manager', label: 'Manager', description: 'Full access — manage members, run extractions, reach consensus, QA review' },
  { value: 'member',  label: 'Member',  description: 'Custom permissions — configure individual access below' },
  { value: 'viewer',  label: 'Viewer',  description: 'Read-only — can view documents and results only' },
];

const DEFAULT_MEMBER_PERMISSIONS = {
  can_view_docs: true,
  can_upload_docs: false,
  can_create_forms: false,
  can_run_extractions: false,
  can_run_manual_extractions: false,
  can_view_results: true,
  can_adjudicate: false,
  can_qa_review: false,
  can_manage_assignments: false,
  can_manage_members: false,
};

const PERMISSION_LABELS: Record<string, string> = {
  can_view_docs: 'View Documents',
  can_upload_docs: 'Upload Documents',
  can_create_forms: 'Create Forms',
  can_run_extractions: 'Run AI Extractions',
  can_run_manual_extractions: 'Run Manual Extractions',
  can_view_results: 'View Results',
  can_adjudicate: 'Consensus',
  can_manage_assignments: 'Manage Assignments',
  can_manage_members: 'Manage Members',
};

export function ProjectMembersModal({ projectId, projectName, isOpen, onClose }: ProjectMembersModalProps) {
  const { toast } = useToast();
  const { isOwner, isAdmin } = useProjectPermissions();
  const canInviteManagerOrOwner = isOwner || isAdmin;
  const availableRoles = ROLE_OPTIONS.filter(r =>
    canInviteManagerOrOwner ? true : r.value === 'member' || r.value === 'viewer'
  );
  const [notOwner, setNotOwner] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selected, setSelected] = useState<UserResult | null>(null);

  // Invite state
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('member');
  const [memberPerms, setMemberPerms] = useState({ ...DEFAULT_MEMBER_PERMISSIONS });
  const [inviting, setInviting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelected(null);
      setDropdownOpen(false);
      setSelectedRole('member');
      setMemberPerms({ ...DEFAULT_MEMBER_PERMISSIONS });
      setNotOwner(false);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await projectMembersService.searchUsers(query);
        setResults(data);
        setDropdownOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, selected]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const selectUser = (user: UserResult) => {
    setSelected(user);
    setQuery('');
    setDropdownOpen(false);
  };

  const clearSelected = () => {
    setSelected(null);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInvite = async () => {
    if (!selected) return;
    setInviting(true);
    try {
      const invite: ProjectMemberInvite = {
        email: selected.email,
        role: selectedRole,
        ...(selectedRole === 'member' ? memberPerms : {
          can_view_docs: false, can_upload_docs: false, can_create_forms: false,
          can_run_extractions: false, can_run_manual_extractions: false,
          can_view_results: false, can_adjudicate: false,
          can_qa_review: false, can_manage_assignments: false, can_manage_members: false,
        }),
      };
      await projectMembersService.inviteMember(projectId, invite);
      toast({ title: 'Member added successfully' });
      onClose();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setNotOwner(true);
      } else {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to add member';
        toast({ title: 'Error', description: msg, variant: 'error' });
      }
    } finally {
      setInviting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add Member</h2>
            {projectName && <p className="text-xs text-gray-400 mt-0.5">{projectName}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {notOwner ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
            <Lock className="h-7 w-7 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Access required</p>
            <p className="text-xs text-gray-400 mt-1">You need member management permissions to add users.</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">

            {/* User search / selected */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">User</label>

              {selected ? (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-900 dark:border-white bg-gray-50 dark:bg-[#1a1a1a]">
                  <Avatar email={selected.email} name={selected.full_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{selected.full_name || selected.email}</p>
                    {selected.full_name && <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{selected.email}</p>}
                  </div>
                  <button onClick={clearSelected} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative" ref={dropdownRef}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300 dark:text-zinc-600 pointer-events-none" />
                    <input
                      ref={inputRef}
                      autoFocus
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name or email…"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-gray-50 dark:bg-[#1a1a1a] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                    />
                    {searching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-gray-300 dark:border-zinc-600 border-t-gray-600 dark:border-t-zinc-300 rounded-full animate-spin" />
                    )}
                  </div>

                  {dropdownOpen && results.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#161616] shadow-lg py-1 max-h-52 overflow-y-auto">
                      {results.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => selectUser(user)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-[#1f1f1f] transition-colors text-left"
                        >
                          <Avatar email={user.email} name={user.full_name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user.full_name || user.email}</p>
                            {user.full_name && <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{user.email}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {query.trim().length >= 2 && !searching && results.length === 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#161616] shadow-lg px-3 py-3">
                      <p className="text-xs text-gray-400 dark:text-zinc-500">No users found for &ldquo;{query}&rdquo;</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Role selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Role</label>
              <div className="space-y-1.5">
                {availableRoles.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
                      selectedRole === option.value
                        ? 'border-gray-900 dark:border-white bg-gray-50 dark:bg-[#1a1a1a]'
                        : 'border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#3a3a3a]',
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={option.value}
                      checked={selectedRole === option.value}
                      onChange={() => setSelectedRole(option.value)}
                      className="mt-0.5 accent-gray-900 dark:accent-white"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Individual permissions — only for Member role */}
            {selectedRole === 'member' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Permissions</label>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  {(Object.keys(PERMISSION_LABELS) as Array<keyof typeof DEFAULT_MEMBER_PERMISSIONS>)
                    .filter((perm) => perm !== 'can_manage_members' && perm !== 'can_manage_assignments')
                    .map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={memberPerms[perm]}
                        onChange={(e) => setMemberPerms((prev) => ({ ...prev, [perm]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded accent-gray-900 dark:accent-white"
                      />
                      {PERMISSION_LABELS[perm]}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Invite button */}
            <button
              onClick={handleInvite}
              disabled={inviting || !selected}
              className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {inviting ? 'Adding…' : 'Add member'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
