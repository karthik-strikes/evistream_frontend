'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout';
import { projectMembersService } from '@/services/project-members.service';
import type { InvitationPreview } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Users, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_BADGE: Record<string, string> = {
  manager: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  member:  'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-400/15',
  viewer:  'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-400/15',
};
const ROLE_LABEL: Record<string, string> = { manager: 'Manager', member: 'Member', viewer: 'Viewer' };

export default function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'invalid' | 'expired'>('loading');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    projectMembersService.getInvitationPreview(token)
      .then(data => {
        setPreview(data);
        setLoadState('ready');
      })
      .catch(err => {
        const status = err?.response?.status;
        setLoadState(status === 410 ? 'expired' : 'invalid');
      });
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const result = await projectMembersService.acceptInvitation(token);
      setAccepted(true);
      toast({ title: 'Welcome!', description: `You've joined the project as ${ROLE_LABEL[result.role] || result.role}.` });
      setTimeout(() => router.push(`/projects/${result.project_id}`), 1500);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Failed to accept invitation';
      toast({ title: 'Error', description: msg, variant: 'error' });
      setAccepting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="w-full max-w-sm">

          {loadState === 'loading' && (
            <div className="flex flex-col items-center gap-3 text-gray-400 dark:text-zinc-500">
              <Loader2 size={24} className="animate-spin" />
              <p className="text-sm">Loading invitation…</p>
            </div>
          )}

          {(loadState === 'invalid' || loadState === 'expired') && (
            <div className="rounded-2xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-400/10 flex items-center justify-center mx-auto mb-4">
                {loadState === 'expired'
                  ? <Clock size={22} className="text-red-400" />
                  : <XCircle size={22} className="text-red-400" />}
              </div>
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-1">
                {loadState === 'expired' ? 'Invitation expired' : 'Invalid invitation'}
              </h2>
              <p className="text-sm text-gray-400 dark:text-zinc-500">
                {loadState === 'expired'
                  ? 'This invitation link has expired. Ask the project owner to send a new one.'
                  : 'This invitation link is invalid or has already been used.'}
              </p>
            </div>
          )}

          {loadState === 'ready' && preview && (
            <div className="rounded-2xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
              {/* Header */}
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-[#1f1f1f]">
                <div className="w-11 h-11 rounded-xl bg-gray-100 dark:bg-[#1f1f1f] flex items-center justify-center mb-4">
                  <Users size={20} className="text-gray-500 dark:text-zinc-400" />
                </div>
                <h1 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
                  You&apos;ve been invited
                </h1>
                <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">
                  {preview.invited_by_name
                    ? <><span className="font-medium text-gray-700 dark:text-zinc-300">{preview.invited_by_name}</span> invited you to join</>
                    : "You've been invited to join"}{' '}
                  <span className="font-medium text-gray-700 dark:text-zinc-300">{preview.project_name}</span>.
                </p>
              </div>

              {/* Details */}
              <div className="px-6 py-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 dark:text-zinc-500">Project</span>
                  <span className="font-medium text-gray-800 dark:text-zinc-200">{preview.project_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 dark:text-zinc-500">Your role</span>
                  <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', ROLE_BADGE[preview.role] || ROLE_BADGE.member)}>
                    {ROLE_LABEL[preview.role] || preview.role}
                  </span>
                </div>
                {preview.invited_by_name && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400 dark:text-zinc-500">Invited by</span>
                    <span className="font-medium text-gray-800 dark:text-zinc-200">{preview.invited_by_name}</span>
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="px-6 pb-6">
                {accepted ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium py-2">
                    <CheckCircle size={16} />
                    Joined! Redirecting…
                  </div>
                ) : (
                  <button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-xl py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {accepting && <Loader2 size={14} className="animate-spin" />}
                    {accepting ? 'Joining…' : 'Accept invitation'}
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}
