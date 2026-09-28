'use client';

import { useEffect, useState } from 'react';
import type { Project, ProjectMember } from '@/types/api';
import type { SettingsCaps } from './capabilities';
import { btnDanger, btnOutline, btnPrimary, fmtDate, inputCls, linkBtn, RolePill, SettingsCard } from './settingsUi';

export function GeneralTab({ project, caps, myRole, members, membersLoaded, onSave, onGoMembers, onArchive, onRestore, onDelete }: {
  project: Project;
  caps: SettingsCaps;
  myRole: string | null;
  members: ProjectMember[];
  membersLoaded: boolean;
  onSave: (name: string, description: string) => Promise<void>;
  onGoMembers: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const archived = !!project.archived_at;
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [copied, setCopied] = useState(false);

  // A saved value coming back through the project list resets the draft base.
  useEffect(() => { setName(project.name); setDesc(project.description ?? ''); }, [project.id, project.name, project.description]);

  const dirty = name !== project.name || desc !== (project.description ?? '');
  const editable = caps.canRename;
  const saveBusy = saving || !dirty || !name.trim();

  const save = async () => {
    setSaving(true); setSaveError(false);
    try {
      await onSave(name.trim(), desc.trim());
      setSavedNote('Saved');
    } catch {
      // The draft stays in the fields so nothing typed is lost.
      setSaveError(true);
    } finally { setSaving(false); }
  };
  const discard = () => { setName(project.name); setDesc(project.description ?? ''); setSavedNote(''); setSaveError(false); };

  const owner = members.find(m => m.role === 'owner' && m.user_id === project.user_id) ?? members.find(m => m.role === 'owner');
  const readOnlyReason = archived ? 'Archived projects are read-only' : 'You do not have permission to rename this project';
  const showLifecycle = caps.canTransferOwnership || caps.canArchive || caps.canDelete || caps.canRestore;

  const shortId = project.id.length > 12 ? `${project.id.slice(0, 8)}…${project.id.slice(-4)}` : project.id;
  const copyId = async () => {
    try { await navigator.clipboard.writeText(project.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const row = 'flex justify-between gap-4 border-b border-gray-100 py-2.5 text-[13px] dark:border-[#1f1f1f]';

  return (
    <>
      <SettingsCard id="g1" title="Project"
        right={!editable ? <span className="text-[12px] text-gray-400 dark:text-zinc-500">{readOnlyReason}</span> : undefined}>
        <div className="flex max-w-[640px] flex-col gap-3.5 px-5 py-4">
          <div>
            <label htmlFor="pname" className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-zinc-300">Project name</label>
            <input id="pname" type="text" value={name} disabled={!editable}
              onChange={e => { setName(e.target.value); setSavedNote(''); setSaveError(false); }}
              className={inputCls} />
            <div className="mt-1.5 text-[12px] text-gray-400 dark:text-zinc-500">Shown in the project selector and on Home.</div>
          </div>
          <div>
            <label htmlFor="pdesc" className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-zinc-300">
              Description <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea id="pdesc" rows={2} value={desc} disabled={!editable}
              onChange={e => { setDesc(e.target.value); setSavedNote(''); setSaveError(false); }}
              className={`${inputCls} h-auto resize-y py-[9px] leading-[18px]`} />
          </div>
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={saveBusy} className={btnPrimary}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {dirty && <button type="button" onClick={discard} className={btnOutline}>Discard</button>}
              {savedNote && <span role="status" className="text-[12px] text-[#177a4e] dark:text-emerald-400">{savedNote}</span>}
              {saveError && (
                <span role="alert" className="text-[12px] text-[#c22d47] dark:text-rose-300">
                  Could not save project details. Your changes are kept —{' '}
                  <button type="button" onClick={save} className="border-0 bg-transparent p-0 text-[12px] font-medium text-[#c22d47] underline dark:text-rose-300">retry</button>.
                </span>
              )}
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard id="g2" title="Details">
        <dl className="m-0 px-5 pb-2 pt-1">
          <div className={row}>
            <dt className="text-gray-500 dark:text-zinc-400">Owner</dt>
            <dd className="m-0 text-right font-medium text-[#0a0a0a] dark:text-zinc-100">
              {owner ? (owner.full_name || owner.email) : membersLoaded ? '—' : <span className="text-gray-400">…</span>}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-gray-500 dark:text-zinc-400">Your role</dt>
            <dd className="m-0 text-right">{myRole ? <RolePill role={myRole} /> : <span className="text-gray-400">…</span>}</dd>
          </div>
          <div className={row}>
            <dt className="text-gray-500 dark:text-zinc-400">Status</dt>
            <dd className="m-0 text-right font-medium text-[#0a0a0a] dark:text-zinc-100">{archived ? 'Archived · read-only' : 'Active'}</dd>
          </div>
          <div className={row}>
            <dt className="text-gray-500 dark:text-zinc-400">Created</dt>
            <dd className="m-0 text-right font-medium text-[#0a0a0a] dark:text-zinc-100">{fmtDate(project.created_at)}</dd>
          </div>
          {caps.canViewMembers && (
            <div className={row}>
              <dt className="text-gray-500 dark:text-zinc-400">Members</dt>
              <dd className="m-0 text-right">
                {membersLoaded
                  ? <button type="button" onClick={onGoMembers} className={linkBtn}>{members.length} member{members.length === 1 ? '' : 's'} →</button>
                  : <span className="text-gray-400">…</span>}
              </dd>
            </div>
          )}
          <div className={`${row} border-b-0`}>
            <dt className="text-gray-500 dark:text-zinc-400">Project ID</dt>
            <dd className="m-0 flex items-center justify-end gap-2 text-right">
              <code title={project.id} className="rounded bg-gray-100 px-1.5 py-px text-[12px] text-gray-600 dark:bg-[#1f1f1f] dark:text-zinc-300">{shortId}</code>
              <button type="button" onClick={copyId} className={`${btnOutline} h-[26px] px-2 text-[11px]`}>{copied ? 'Copied' : 'Copy'}</button>
            </dd>
          </div>
        </dl>
      </SettingsCard>

      {showLifecycle && (
        <SettingsCard id="g3" title="Lifecycle" tone="danger" sub="These actions affect every member. Each asks for confirmation.">
          <div className="flex flex-col px-5 pb-2 pt-1">
            {caps.canTransferOwnership && (
              <LifeRow title="Transfer ownership" body="Hand the owner role to another member. You stay a manager.">
                <button type="button" onClick={onGoMembers} className={btnOutline}>Choose member</button>
              </LifeRow>
            )}
            {caps.canArchive && (
              <LifeRow title="Archive project" body="Read-only for everyone; hidden from the project selector; results stay viewable. Restorable.">
                <button type="button" id="btn-archive" onClick={onArchive} className={btnOutline}>Archive…</button>
              </LifeRow>
            )}
            {caps.canRestore && (
              <LifeRow title="Restore project" body="Back to active. It does not become your current project until you open it.">
                <button type="button" onClick={onRestore} className={btnOutline}>Restore</button>
              </LifeRow>
            )}
            {caps.canDelete && (
              <LifeRow title="Delete project" danger last body="Removes documents, forms, results and syntheses for all members. Cannot be undone.">
                <button type="button" id="btn-delete" onClick={onDelete} className={btnDanger}>Delete…</button>
              </LifeRow>
            )}
          </div>
        </SettingsCard>
      )}
    </>
  );
}

function LifeRow({ title, body, danger, last, children }: { title: string; body: string; danger?: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 py-3 ${last ? '' : 'border-b border-gray-100 dark:border-[#1f1f1f]'}`}>
      <div className="min-w-0 flex-[1_1_280px]">
        <div className={`text-[13px] font-medium ${danger ? 'text-[#c22d47] dark:text-rose-300' : 'text-[#0a0a0a] dark:text-zinc-100'}`}>{title}</div>
        <div className="text-[12px] text-gray-500 dark:text-zinc-400">{body}</div>
      </div>
      {children}
    </div>
  );
}
