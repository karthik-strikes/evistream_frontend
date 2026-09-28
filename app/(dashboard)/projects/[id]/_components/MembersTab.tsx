'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectInvitation, ProjectMember, ProjectMemberUpdate, ProjectRole } from '@/types/api';
import { PERMISSION_KEYS, PermissionGroupList, type PermissionKey } from '@/components/project/permissionCatalog';
import { btnOutline, btnPrimary, ConfirmDialog, fmtDate, initialsOf, RolePill, SettingsCard } from './settingsUi';

// ── Responsibilities ─────────────────────────────────────────────────────────
// Informational only: extraction seats are set per paper in Assignments; RoB
// and synthesis roles live in their protocols.

export type SeatKey = 'R1' | 'R2' | 'CR' | 'RoB' | 'AP';
export type Responsibilities = Map<string, Set<SeatKey>>;

const SEAT: Record<SeatKey, { text: string; where: string; title: string; cls: string }> = {
  R1: { text: 'Extraction R1', where: 'Assignments', title: 'Reviewer 1 on allocated papers', cls: 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900' },
  R2: { text: 'Extraction R2', where: 'Assignments', title: 'Reviewer 2 on allocated papers', cls: 'border-gray-200 bg-gray-200 text-gray-700 dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
  CR: { text: 'Consensus', where: 'Assignments', title: 'Consensus reviewer', cls: 'border-[#c7d2fe] bg-white text-[#4338ca] dark:border-indigo-800 dark:bg-transparent dark:text-indigo-300' },
  RoB: { text: 'RoB reviewer', where: 'the Risk of bias protocol', title: 'Risk of bias protocol seat', cls: 'border-[#0a0a0a] bg-white text-[#0a0a0a] dark:border-zinc-300 dark:bg-transparent dark:text-zinc-100' },
  AP: { text: 'Synthesis approver', where: 'the Synthesis protocol', title: 'Synthesis protocol approver', cls: 'border-[#bde9d3] bg-[#eaf8f1] text-[#177a4e] dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' },
};
const SEAT_ORDER: SeatKey[] = ['R1', 'R2', 'CR', 'RoB', 'AP'];

function SeatChip({ seat, onClick }: { seat: SeatKey; onClick?: () => void }) {
  const s = SEAT[seat];
  const body = (
    <>
      <span className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-[3px] text-[8px] font-bold', s.cls)}>{seat}</span>
      {s.text}
    </>
  );
  const cls = 'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-full border border-gray-200 bg-white py-0 pl-[3px] pr-2 text-[11px] text-gray-700 no-underline dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-300';
  const title = `${s.title} · managed in ${s.where}`;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={cn(cls, 'hover:bg-gray-50 dark:hover:bg-[#1a1a1a]')}>{body}</button>
    : <span title={title} className={cls}>{body}</span>;
}

// ── Row menu ─────────────────────────────────────────────────────────────────

function RowMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => els[(n + els.length) % els.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focus(0); }
    else if (e.key === 'End') { e.preventDefault(); focus(els.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  if (!items.length) return null;
  return (
    <div className="relative inline-block">
      <button ref={btn} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-100 dark:text-zinc-400 dark:hover:border-[#2a2a2a] dark:hover:bg-[#1a1a1a]">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div ref={menu} role="menu" onKeyDown={onKey}
          className="absolute right-0 top-full z-30 mt-1 flex w-[180px] flex-col rounded-lg border border-gray-200 bg-white p-1 text-left shadow-[0_12px_40px_rgba(0,0,0,.1)] dark:border-[#2a2a2a] dark:bg-[#141414]">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={cn('w-full rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[13px] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-[#1f1f1f] dark:focus:bg-[#1f1f1f]',
                it.danger ? 'text-[#c22d47] dark:text-rose-300' : 'text-[#0a0a0a] dark:text-zinc-100')}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Access dialog (role + per-permission switches) ───────────────────────────

const EDIT_ROLES: { value: ProjectRole; label: string; sub: string }[] = [
  { value: 'manager', label: 'Manager', sub: 'Administrative workflow access without ownership transfer or deletion.' },
  { value: 'member', label: 'Member', sub: 'Custom access — grant only the capabilities this person needs.' },
  { value: 'viewer', label: 'Viewer', sub: 'Read-only by default. The switches below still apply.' },
];

function AccessDialog({ member, onClose, onSaved }: { member: ProjectMember; onClose: () => void; onSaved: (m: ProjectMember) => void }) {
  const { toast } = useToast();
  const [role, setRole] = useState<ProjectRole>(member.role);
  const [perms, setPerms] = useState<Record<PermissionKey, boolean>>(
    () => Object.fromEntries(PERMISSION_KEYS.map(k => [k, !!(member as any)[k]])) as Record<PermissionKey, boolean>);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    // Send `role` only when it changed (same rule as MembersSection): otherwise
    // the backend re-derives the role from the flag set.
    const payload: ProjectMemberUpdate = role !== member.role ? { ...perms, role } : { ...perms };
    setSaving(true);
    try {
      const updated = await projectMembersService.updateMember(member.project_id, member.user_id, payload);
      onSaved({ ...member, ...updated });
      toast({ title: 'Access updated' });
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      toast({ title: 'Error', description: detail.includes('at least one owner') ? 'A project must have at least one owner. Promote someone else first.' : detail || 'Failed to update member', variant: 'error' });
    } finally { setSaving(false); }
  };

  const fixed = role === 'manager';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,10,10,.35)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="access-title" onClick={e => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,.15)] dark:border-[#2a2a2a] dark:bg-[#141414]">
        <h2 id="access-title" className="m-0 text-[16px] font-semibold text-[#0a0a0a] dark:text-zinc-100">
          Access for {member.full_name || member.email}
        </h2>
        <div role="radiogroup" aria-label="Project role" className="flex flex-col gap-1.5">
          {EDIT_ROLES.map((r, i) => (
            <button key={r.value} ref={i === 0 ? first : undefined} type="button" role="radio" aria-checked={role === r.value}
              onClick={() => setRole(r.value)}
              className={cn('flex flex-col items-start rounded-lg border px-3 py-2 text-left',
                role === r.value ? 'border-[#0a0a0a] dark:border-zinc-200' : 'border-gray-200 hover:bg-gray-50 dark:border-[#2a2a2a] dark:hover:bg-[#1a1a1a]')}>
              <span className="text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{r.label}</span>
              <span className="text-[12px] text-gray-500 dark:text-zinc-400">{r.sub}</span>
            </button>
          ))}
        </div>
        {fixed
          ? <p className="m-0 text-[12px] text-gray-500 dark:text-zinc-400">Managers get a fixed set of capabilities.</p>
          : <PermissionGroupList value={perms} onChange={(k, v) => setPerms(p => ({ ...p, [k]: v }))} />}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save access'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function MembersTab({ projectId, members, loaded, loadFailed, onRetry, onMembersChange, canManage, canTransfer,
  responsibilities, responsibilitiesPartial, onInvite, onGoAssignments, onOwnerTransferred }: {
  projectId: string;
  members: ProjectMember[];
  loaded: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  onMembersChange: (m: ProjectMember[]) => void;
  canManage: boolean;
  canTransfer: boolean;
  responsibilities: Responsibilities | null;
  /** Extraction seats could not be read for this viewer. */
  responsibilitiesPartial: boolean;
  onInvite: () => void;
  onGoAssignments: () => void;
  onOwnerTransferred: () => void;
}) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [editing, setEditing] = useState<ProjectMember | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'transfer'; member: ProjectMember } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);

  useEffect(() => {
    if (!canManage) return;
    projectMembersService.listInvitations(projectId).then(setInvitations).catch(() => setInvitations([]));
  }, [projectId, canManage, members.length]);

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    const m = confirm.member;
    try {
      if (confirm.kind === 'remove') {
        await projectMembersService.removeMember(projectId, m.user_id);
        onMembersChange(members.filter(x => x.user_id !== m.user_id));
        toast({ title: 'Member removed' });
      } else {
        await projectMembersService.transferOwnership(projectId, m.user_id, 'manager');
        onMembersChange(await projectMembersService.listMembers(projectId));
        onOwnerTransferred();
        toast({ title: 'Ownership transferred', description: 'You are now a manager of this project.' });
      }
      setConfirm(null);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      toast({ title: 'Error', description: detail.includes('at least one owner') ? 'A project must have at least one owner. Promote someone else first.' : detail || 'That change failed', variant: 'error' });
    } finally { setBusy(false); }
  };

  const revoke = async (inv: ProjectInvitation) => {
    try {
      await projectMembersService.revokeInvitation(projectId, inv.id);
      setInvitations(prev => prev.filter(i => i.id !== inv.id));
      toast({ title: 'Invitation revoked' });
    } catch { toast({ title: 'Error', description: 'Failed to revoke invitation', variant: 'error' }); }
  };

  const th = 'border-b border-gray-100 px-4 py-2 font-semibold dark:border-[#1f1f1f]';
  return (
    <SettingsCard id="m1" title="Members" count={loaded ? members.length : undefined}
      sub="Project role sets capabilities here. Responsibilities are informational: extraction seats are set per paper in Assignments; RoB and synthesis roles in their protocols."
      action={canManage ? <button type="button" onClick={onInvite} className={btnPrimary}>Invite member</button> : undefined}>
      {!loaded && !loadFailed && (
        <div aria-busy="true" className="flex flex-col gap-4 p-5">
          {[0, 1, 2].map(i => <div key={i} className="settings-pulse h-3 rounded bg-gray-100 dark:bg-[#1f1f1f]" style={{ width: `${60 - i * 10}%` }} />)}
        </div>
      )}
      {loadFailed && (
        <p role="alert" className="m-0 flex items-center gap-2 px-5 py-4 text-[13px] text-[#c22d47] dark:text-rose-300">
          Members unavailable.
          <button type="button" onClick={onRetry} className="border-0 bg-transparent p-0 text-[13px] font-medium text-[#c22d47] underline dark:text-rose-300">Retry</button>
        </p>
      )}
      {loaded && (
        <div role="region" aria-label="Members" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">
                <th scope="col" className={`${th} pl-5`}>Member</th>
                <th scope="col" className={th}>Project role</th>
                <th scope="col" className={th}>Responsibilities</th>
                <th scope="col" className={th}>Added</th>
                <th scope="col" className={`${th} pr-5 text-right`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const name = m.full_name || m.email;
                const seats = responsibilities?.get(m.user_id);
                const isSelf = m.user_id === String(currentUser?.id ?? '');
                const items = canManage ? [
                  ...(m.role !== 'owner' ? [{ label: 'Edit access…', onSelect: () => setEditing(m) }] : []),
                  ...(canTransfer && m.role !== 'owner' ? [{ label: 'Make owner…', onSelect: () => setConfirm({ kind: 'transfer', member: m }) }] : []),
                  ...(!(m.role === 'owner') && !isSelf ? [{ label: 'Remove from project…', danger: true, onSelect: () => setConfirm({ kind: 'remove', member: m }) }] : []),
                ] : [];
                return (
                  <tr key={m.user_id} className="border-b border-gray-100 dark:border-[#1f1f1f]">
                    <th scope="row" className="px-5 py-2.5 text-left font-medium">
                      <div className="flex items-center gap-2.5">
                        <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-700 dark:text-zinc-200">{initialsOf(name)}</span>
                        <span className="min-w-0">
                          <span className="block text-[#0a0a0a] dark:text-zinc-100">{name}</span>
                          {m.full_name && <span className="block text-[12px] font-normal text-gray-500 dark:text-zinc-400">{m.email}</span>}
                        </span>
                      </div>
                    </th>
                    <td className="px-4 py-2.5"><RolePill role={m.role} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {responsibilities === null
                          ? <span className="text-[12px] text-gray-400">…</span>
                          : seats && seats.size
                            ? SEAT_ORDER.filter(s => seats.has(s)).map(s => (
                                <SeatChip key={s} seat={s} onClick={s === 'R1' || s === 'R2' || s === 'CR' ? onGoAssignments : undefined} />
                              ))
                            : <span className="text-[12px] text-gray-400 dark:text-zinc-500">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-zinc-400">{fmtDate(m.created_at)}</td>
                    <td className="px-5 py-2.5 text-right"><RowMenu label={`Options for ${name}`} items={items} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && invitations.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 dark:border-[#1f1f1f]">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">Pending invitations</div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {invitations.map(inv => (
              <li key={inv.id} className="flex items-center gap-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-zinc-300">{inv.email}</span>
                <RolePill role={inv.role} />
                <button type="button" onClick={() => revoke(inv)} className="border-0 bg-transparent p-0 text-[12px] text-gray-500 underline hover:text-[#c22d47] dark:text-zinc-400">Revoke</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 py-2.5 text-[12px] text-gray-400 dark:text-zinc-500">
        <span>R1 / R2 / CR · extraction seats, set per paper in <button type="button" onClick={onGoAssignments} className="border-0 bg-transparent p-0 text-[12px] text-gray-500 underline dark:text-zinc-400">Assignments</button></span>
        <span>RoB · reviewer seat in the Risk of bias protocol</span>
        <span>AP · approver in the Synthesis protocol</span>
        {responsibilitiesPartial && <span>Extraction seats are visible to people who manage assignments.</span>}
      </div>

      {editing && (
        <AccessDialog member={editing} onClose={() => setEditing(null)}
          onSaved={u => onMembersChange(members.map(x => x.user_id === u.user_id ? u : x))} />
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'transfer' ? 'Transfer ownership' : 'Remove member'}
        description={confirm
          ? confirm.kind === 'transfer'
            ? `Make ${confirm.member.full_name || confirm.member.email} the owner of this project? You stay a manager.`
            : `Remove ${confirm.member.full_name || confirm.member.email} from this project?`
          : ''}
        confirmLabel={confirm?.kind === 'transfer' ? 'Transfer ownership' : 'Remove'}
        danger={confirm?.kind === 'remove'}
        busy={busy}
        typed="" onTyped={() => {}}
        onCancel={() => setConfirm(null)}
        onConfirm={doConfirm}
      />
    </SettingsCard>
  );
}
