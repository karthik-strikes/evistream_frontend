'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import {
  User, Lock, Download, Bell, Save, Loader2,
  AlertCircle, Key,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authService, settingsService } from '@/services';
import type { UserSettingsUpdate } from '@/services/settings.service';
import { cn } from '@/lib/utils';

type Section = 'profile' | 'security' | 'export' | 'notifications';

const NAV_GROUPS = [
  {
    label: 'Account',
    items: [
      { id: 'profile' as Section, label: 'Profile', icon: User },
      { id: 'security' as Section, label: 'Security', icon: Lock },
      { id: 'export' as Section, label: 'Export', icon: Download },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { id: 'notifications' as Section, label: 'Notifications', icon: Bell },
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
      <div className="flex-shrink-0 w-64">
        {children}
      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        checked ? "bg-gray-900 dark:bg-zinc-100" : "bg-gray-200 dark:bg-[#2a2a2a]"
      )}
    >
      <span className={cn(
        "inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-gray-900 transition-transform shadow-sm",
        checked ? "translate-x-4.5" : "translate-x-0.5"
      )} style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

// ── Input ─────────────────────────────────────────────────────────
const inputCls = "w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600";
const selectCls = inputCls + " cursor-pointer dark:[color-scheme:dark]";

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

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Section>('profile');
  const [saving, setSaving] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const [profile, setProfile] = useState({ fullName: '', email: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [notificationSettings, setNotificationSettings] = useState({ email: true, browser: true, extractionComplete: true, extractionFailed: true, codeGeneration: true });
  const [exportSettings, setExportSettings] = useState({ format: 'csv', dateFormat: 'ISO', includeMetadata: true, includeConfidence: true });

  const { isLoading: loading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const user = await authService.getCurrentUser();
      setProfile(prev => ({ ...prev, fullName: user.full_name, email: user.email }));
      return user;
    },
  });

  // Load persisted settings from API
  const { data: savedSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['userSettings'],
    queryFn: () => settingsService.getSettings(),
  });

  // Sync API settings into local state when loaded
  useEffect(() => {
    if (savedSettings) {
      setExportSettings({
        format: savedSettings.export_format,
        dateFormat: savedSettings.export_date_format,
        includeMetadata: savedSettings.export_include_metadata,
        includeConfidence: savedSettings.export_include_confidence,
      });
      setNotificationSettings({
        email: savedSettings.notify_email,
        browser: savedSettings.notify_browser,
        extractionComplete: savedSettings.notify_extraction_completed,
        extractionFailed: savedSettings.notify_extraction_failed,
        codeGeneration: savedSettings.notify_code_generation,
      });
    }
  }, [savedSettings]);

  const settingsMutation = useMutation({
    mutationFn: (data: UserSettingsUpdate) => settingsService.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSettings'] });
    },
  });

  const save = async (fn?: () => Promise<void>) => {
    setSaving(true);
    try {
      if (fn) await fn();
      else await new Promise(r => setTimeout(r, 700));
      toast({ title: 'Saved', description: 'Changes saved successfully', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to save', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const saveExport = () =>
    save(async () => {
      if (exportSettings.format === 'xlsx') {
        toast({ title: 'Coming soon', description: 'Excel export is not yet available. Your other preferences have been saved.', variant: 'warning' });
      }
      await settingsMutation.mutateAsync({
        export_format: exportSettings.format === 'xlsx' ? 'csv' : exportSettings.format,
        export_date_format: exportSettings.dateFormat,
        export_include_metadata: exportSettings.includeMetadata,
        export_include_confidence: exportSettings.includeConfidence,
      });
    });

  const saveNotifications = () =>
    save(async () => {
      await settingsMutation.mutateAsync({
        notify_email: notificationSettings.email,
        notify_browser: notificationSettings.browser,
        notify_extraction_completed: notificationSettings.extractionComplete,
        notify_extraction_failed: notificationSettings.extractionFailed,
        notify_code_generation: notificationSettings.codeGeneration,
      });
    });

  const validateAndSavePassword = async () => {
    const errors: string[] = [];
    if (!profile.currentPassword) errors.push('Current password is required');
    if (profile.newPassword.length < 8) errors.push('New password must be at least 8 characters');
    if (profile.newPassword !== profile.confirmPassword) errors.push('Passwords do not match');
    setPasswordErrors(errors);
    if (errors.length > 0) return;
    await save(async () => {
      await new Promise(r => setTimeout(r, 700));
      setProfile(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      setPasswordErrors([]);
    });
  };

  // Section title lookup
  const sectionTitle: Record<Section, string> = {
    profile: 'Profile',
    security: 'Security',
    export: 'Export',
    notifications: 'Notifications',
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto flex gap-0 pt-10">

        {/* ── Left nav ─────────────────────────────────────────────── */}
        <div className="w-48 flex-shrink-0 flex flex-col pr-8 overflow-y-auto">
          {/* User info */}
          {!loading && (
            <div className="mb-5 pb-5 border-b border-gray-100 dark:border-[#1f1f1f]">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{profile.fullName || 'Account'}</p>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">{profile.email}</p>
            </div>
          )}

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

          {(loading || settingsLoading) ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
            </div>
          ) : (
            <>
              {/* Section heading */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{sectionTitle[active]}</h2>
              </div>

              {/* ── Profile ── */}
              {active === 'profile' && (
                <>
                  <SectionCard title="Personal Information" description="Update your name and email address">
                    <SettingRow label="Full name" description="Your display name across the platform">
                      <input type="text" value={profile.fullName} onChange={e => setProfile(p => ({ ...p, fullName: e.target.value }))} placeholder="Your full name" className={inputCls} />
                    </SettingRow>
                    <SettingRow label="Email address" description="Used for login and notifications" last>
                      <input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} placeholder="you@example.com" className={inputCls} />
                    </SettingRow>
                  </SectionCard>

                  <div className="flex justify-end">
                    <button
                      onClick={() => save()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 transition-colors"
                    >
                      {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5" />Save changes</>}
                    </button>
                  </div>
                </>
              )}

              {/* ── Security ── */}
              {active === 'security' && (
                <>
                  {passwordErrors.length > 0 && (
                    <div className="flex gap-2.5 px-4 py-3 mb-5 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        {passwordErrors.map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>)}
                      </div>
                    </div>
                  )}

                  <SectionCard title="Change Password" description="Use a strong password with letters, numbers and symbols">
                    <SettingRow label="Current password">
                      <input type="password" value={profile.currentPassword} onChange={e => setProfile(p => ({ ...p, currentPassword: e.target.value }))} placeholder="Enter current password" className={inputCls} />
                    </SettingRow>
                    <SettingRow label="New password" description="At least 8 characters">
                      <input type="password" value={profile.newPassword} onChange={e => setProfile(p => ({ ...p, newPassword: e.target.value }))} placeholder="Enter new password" className={inputCls} />
                    </SettingRow>
                    <SettingRow label="Confirm password" last>
                      <input type="password" value={profile.confirmPassword} onChange={e => setProfile(p => ({ ...p, confirmPassword: e.target.value }))} placeholder="Repeat new password" className={inputCls} />
                    </SettingRow>
                  </SectionCard>

                  <div className="flex justify-end">
                    <button
                      onClick={validateAndSavePassword}
                      disabled={saving || !profile.newPassword}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 transition-colors"
                    >
                      {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><Key className="w-3.5 h-3.5" />Change password</>}
                    </button>
                  </div>
                </>
              )}

              {/* ── Export ── */}
              {active === 'export' && (
                <>
                  <SectionCard title="Export Defaults" description="Default options applied when exporting results">
                    <SettingRow label="File format" description="Default format for exported data">
                      <select value={exportSettings.format} onChange={e => setExportSettings(p => ({ ...p, format: e.target.value }))} className={selectCls}>
                        <option value="csv">CSV (Comma-separated)</option>
                        <option value="json">JSON</option>
                        <option value="xlsx">Excel (XLSX)</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Date format" description="How dates are formatted in exports" last>
                      <select value={exportSettings.dateFormat} onChange={e => setExportSettings(p => ({ ...p, dateFormat: e.target.value }))} className={selectCls}>
                        <option value="ISO">ISO 8601  (2026-02-04)</option>
                        <option value="US">US (02/04/2026)</option>
                        <option value="EU">EU (04/02/2026)</option>
                        <option value="Long">Long (February 4, 2026)</option>
                      </select>
                    </SettingRow>
                  </SectionCard>

                  <SectionCard title="Included Fields">
                    <SettingRow label="Include metadata" description="Document IDs, timestamps, and other metadata">
                      <Toggle checked={exportSettings.includeMetadata} onChange={v => setExportSettings(p => ({ ...p, includeMetadata: v }))} />
                    </SettingRow>
                    <SettingRow label="Include confidence scores" description="AI confidence scores alongside extracted values" last>
                      <Toggle checked={exportSettings.includeConfidence} onChange={v => setExportSettings(p => ({ ...p, includeConfidence: v }))} />
                    </SettingRow>
                  </SectionCard>

                  <div className="flex justify-end">
                    <button onClick={saveExport} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 transition-colors">
                      {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5" />Save changes</>}
                    </button>
                  </div>
                </>
              )}

              {/* ── Notifications ── */}
              {active === 'notifications' && (
                <>
                  <SectionCard title="Channels" description="How you want to receive notifications">
                    <SettingRow label="Email notifications" description="Receive updates to your email address">
                      <Toggle checked={notificationSettings.email} onChange={v => setNotificationSettings(p => ({ ...p, email: v }))} />
                    </SettingRow>
                    <SettingRow label="Browser notifications" description="Push notifications in the browser" last>
                      <Toggle checked={notificationSettings.browser} onChange={v => setNotificationSettings(p => ({ ...p, browser: v }))} />
                    </SettingRow>
                  </SectionCard>

                  <SectionCard title="Events" description="Choose which events trigger a notification">
                    <SettingRow label="Extraction completed" description="When an extraction finishes successfully">
                      <Toggle checked={notificationSettings.extractionComplete} onChange={v => setNotificationSettings(p => ({ ...p, extractionComplete: v }))} />
                    </SettingRow>
                    <SettingRow label="Extraction failed" description="When an extraction encounters an error">
                      <Toggle checked={notificationSettings.extractionFailed} onChange={v => setNotificationSettings(p => ({ ...p, extractionFailed: v }))} />
                    </SettingRow>
                    <SettingRow label="Code generation" description="When form code generation completes" last>
                      <Toggle checked={notificationSettings.codeGeneration} onChange={v => setNotificationSettings(p => ({ ...p, codeGeneration: v }))} />
                    </SettingRow>
                  </SectionCard>

                  <div className="flex justify-end">
                    <button onClick={saveNotifications} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 transition-colors">
                      {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5" />Save changes</>}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
