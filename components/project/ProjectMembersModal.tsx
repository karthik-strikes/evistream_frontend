'use client';

import { useState, useEffect } from 'react';
import { X, UserPlus, Lock } from 'lucide-react';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectMemberInvite } from '@/types/api';
import { useToast } from '@/hooks/use-toast';

interface ProjectMembersModalProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PERMISSIONS: Omit<ProjectMemberInvite, 'email'> = {
  can_view_docs: true,
  can_upload_docs: false,
  can_create_forms: false,
  can_run_extractions: false,
  can_view_results: true,
  can_adjudicate: false,
  can_qa_review: false,
  can_manage_assignments: false,
};

const PERMISSION_LABELS: Record<string, string> = {
  can_view_docs: 'View Documents',
  can_upload_docs: 'Upload Documents',
  can_create_forms: 'Create Forms',
  can_run_extractions: 'Run Extractions',
  can_view_results: 'View Results',
  can_adjudicate: 'Adjudicate',
  can_qa_review: 'QA Review',
  can_manage_assignments: 'Manage Assignments',
};

export function ProjectMembersModal({ projectId, projectName, isOpen, onClose }: ProjectMembersModalProps) {
  const { toast } = useToast();
  const [notOwner, setNotOwner] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePerms, setInvitePerms] = useState({ ...DEFAULT_PERMISSIONS });
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInviteEmail('');
      setInvitePerms({ ...DEFAULT_PERMISSIONS });
      setNotOwner(false);
    }
  }, [isOpen]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await projectMembersService.inviteMember(projectId, {
        email: inviteEmail.trim(),
        ...invitePerms,
      });
      setInviteEmail('');
      setInvitePerms({ ...DEFAULT_PERMISSIONS });
      toast({ title: 'Member invited successfully' });
      onClose();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setNotOwner(true);
      } else {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to invite member';
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
        className="bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Invite Member</h2>
            {projectName && <p className="text-xs text-gray-400 mt-0.5">{projectName}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {notOwner ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
            <Lock className="h-7 w-7 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Owner access required</p>
            <p className="text-xs text-gray-400 mt-1">Only the project owner can invite members.</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Email input */}
            <div className="flex gap-2">
              <input
                autoFocus
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-gray-50 dark:bg-[#1a1a1a] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-40 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {inviting ? 'Inviting...' : 'Invite'}
              </button>
            </div>

            {/* Permissions */}
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {(Object.keys(DEFAULT_PERMISSIONS) as Array<keyof typeof DEFAULT_PERMISSIONS>).map((perm) => (
                <label key={perm} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={invitePerms[perm]}
                    onChange={(e) => setInvitePerms((prev) => ({ ...prev, [perm]: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded accent-gray-900 dark:accent-white"
                  />
                  {PERMISSION_LABELS[perm]}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
