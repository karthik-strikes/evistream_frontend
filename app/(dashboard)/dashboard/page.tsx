'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { dashboardService } from '@/services/dashboard.service';
import Link from 'next/link';
import { statusColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

// ── Theme tokens ──────────────────────────────────────────────────────
const makeTokens = (d: boolean) => ({
  pageBg: d
    ? 'radial-gradient(ellipse at 15% 15%, rgba(244,63,94,0.05) 0%, transparent 55%), radial-gradient(ellipse at 85% 85%, rgba(59,130,246,0.05) 0%, transparent 55%), #050505'
    : '#ffffff',
  glassBg:    d ? 'rgba(255,255,255,0.03)' : '#ffffff',
  glassBorder:d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.11)',
  text:       d ? '#e8e8e8' : '#0a0a0a',
  textMuted:  d ? '#666' : '#6b7280',
  textDim:    d ? '#3a3a3a' : '#64748b',
  accent:     '#f43f5e',
  accentBlue: '#3b82f6',
  accentGreen:'#10b981',
  accentAmber:'#f59e0b',
  divider:    d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.09)',
  trackBg:    d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)',
  rowHover:   d ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)',
  cmdBg:      d ? '#0a0a0a' : '#ffffff',
  cmdBorder:  d ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.11)',
  panelBg:    d ? '#080808' : '#fafafa',
  cardShadow: d ? 'none' : '0 1px 4px rgba(0,0,0,0.06), 0 6px 24px rgba(0,0,0,0.08)',
});

// ── Hooks ─────────────────────────────────────────────────────────────
const useCountUp = (target: number, duration = 900) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return; }
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(e * target));
      if (p < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, duration]);
  return value;
};

// Map API form status to display label
const fmtFormStatus = (s: string) => {
  const map: Record<string, string> = { active: 'Active', generating: 'Generating', awaiting_review: 'Review', regenerating: 'Generating', draft: 'Draft', failed: 'Failed' };
  return map[s] || s;
};

// ── Status Pill ───────────────────────────────────────────────────────
const Pill = ({ status, isDark }: { status: string; isDark: boolean }) => {
  const color = statusColor[status] || '#888';
  const bg = isDark ? `${color}18` : status === 'Active' || status === 'done' || status === 'Completed' ? '#f0fdf4'
    : status === 'running' || status === 'Generating' ? '#eff6ff'
    : status === 'failed' || status === 'Failed' ? '#fef2f2' : '#f5f5f5';
  return (
    <span style={{ color, background: bg, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
};

// ── Panel Section (slide-over) ────────────────────────────────────────
const PanelSection = ({ icon, iconColor, title, items, renderItem, T, isDark }: {
  icon: React.ReactNode; iconColor: string; title: string; items: any[]; isDark: boolean;
  renderItem: (item: any, i: number, hasBorder: boolean) => React.ReactElement;
  T: ReturnType<typeof makeTokens>;
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [showCount, setShowCount] = useState(8);

  const filtered = items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()));
  const visible = filtered.slice(0, showCount);
  const hasMore = filtered.length > showCount;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: `1px solid ${T.divider}`, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{title}</span>
          <span style={{ fontSize: 10, color: T.textMuted }}>{items.length}</span>
        </div>
        {items.length > 5 && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
            style={{ fontSize: 11, color: T.text, background: T.glassBg, border: `1px solid ${T.glassBorder}`, borderRadius: 6, padding: '2px 8px', outline: 'none', width: 120 }} />
        )}
      </div>
      {!collapsed && (
        <div style={{ border: `1px solid ${T.glassBorder}`, borderRadius: 8, overflow: 'hidden', background: T.glassBg }}>
          {visible.length === 0 && <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: T.textMuted }}>No matches</div>}
          {visible.map((item, i) => renderItem(item, i, i < visible.length - 1))}
          {(hasMore || showCount > 8) && (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '6px 0', borderTop: `1px solid ${T.divider}` }}>
              {hasMore && <button onClick={() => setShowCount((c) => c + 10)} style={{ fontSize: 11, color: T.accentBlue, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Show more</button>}
              {showCount > 8 && <button onClick={() => setShowCount(8)} style={{ fontSize: 11, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Collapse</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main Dashboard ────────────────────────────────────────────────────
export default function DashboardPage() {
  const { selectedProject: contextProject, projects: contextProjects } = useProject();

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const T = makeTokens(isDark);

  // Command palette
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const cmdListRef = useRef<HTMLDivElement>(null);

  // Slide-over panel
  const [selectedProject, setSelectedProjectPanel] = useState<any>(null);
  const [panelClosing, setPanelClosing] = useState(false);

  const [hoveredStat, setHoveredStat] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // Project switcher
  const [viewProject, setViewProject] = useState<any>(contextProject);
  const [projectDropOpen, setProjectDropOpen] = useState(false);
  const projectDropRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setViewProject(contextProject); }, [contextProject]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectDropRef.current && !projectDropRef.current.contains(e.target as Node)) setProjectDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'stats', viewProject?.id],
    queryFn: () => dashboardService.getStats(viewProject!.id),
    enabled: !!viewProject?.id,
    staleTime: 5 * 60 * 1000,
  });

  const loading = isLoading;
  const stats = data?.stats ?? { documents: 0, forms: 0, extractions: 0, results: 0 };
  const formCounts = data?.form_counts ?? {};
  const statusCounts = data?.extraction_status_counts ?? {};
  const runningExtractionCount = (statusCounts['running'] ?? 0) + (statusCounts['pending'] ?? 0);
  const doneExtractionCount = (statusCounts['completed'] ?? 0) + (statusCounts['done'] ?? 0);
  const recentExtractions = (data?.recent_extractions ?? []).map(e => ({
    id: e.id,
    name: e.doc_name || '—',
    form: e.form_name || 'Unknown',
    fields: e.status === 'running' || e.status === 'pending' ? null : e.fields_filled,
    total: e.total_fields,
    time: new Date(e.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    status: e.status === 'completed' ? 'done' : (e.status === 'pending') ? 'running' : e.status,
  }));
  const projectsData = (data?.projects_overview ?? []).map(p => ({
    id: p.id,
    name: p.name,
    desc: p.description || '',
    created: new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
    active: p.id === viewProject?.id,
    forms: [] as any[],
    documents: [] as any[],
    document_count: p.document_count,
    form_count: p.form_count,
  }));

  // Animated stat counters
  const cDocs = useCountUp(loading ? 0 : stats.documents);
  const cExtractions = useCountUp(loading ? 0 : stats.extractions);
  const cForms = useCountUp(loading ? 0 : stats.forms);
  const cResults = useCountUp(loading ? 0 : stats.results);

  // Derived
  const apFailed = formCounts['Failed'] || 0;
  const apReview = formCounts['Review'] || 0;
  const apNeedAttention = apFailed + apReview;

  // Stats strip config
  const statsStrip = [
    { label: 'DOCUMENTS',   value: cDocs,        color: T.accent },
    { label: 'EXTRACTIONS', value: cExtractions,  color: T.accentBlue },
    { label: 'FORMS',       value: cForms,        color: T.accentAmber },
    { label: 'RESULTS',     value: cResults,      color: T.accentGreen },
  ];

  const gridCols = '8px 1fr 1fr 150px 72px 80px';

  // Command palette
  const allCmdItems = [
    { label: 'Run new extraction', icon: '▶', category: 'Actions', shortcut: '⌘E', href: '/extractions' },
    { label: 'Upload documents', icon: '↑', category: 'Actions', shortcut: '⌘U', href: '/documents' },
    { label: 'Create new form', icon: '+', category: 'Actions', shortcut: '⌘N', href: '/forms' },
    { label: 'View all results', icon: '◎', category: 'Navigate', href: '/results' },
    { label: 'Forms library', icon: '☰', category: 'Navigate', href: '/forms' },
    { label: 'Jobs monitor', icon: '↻', category: 'Navigate', href: '/jobs' },
    { label: 'Export all data as CSV', icon: '↓', category: 'Export', href: '/results' },
    { label: 'Export all data as JSON', icon: '↓', category: 'Export', href: '/results' },
  ];
  const cmdItems = allCmdItems.filter((i) => !cmdQuery || i.label.toLowerCase().includes(cmdQuery.toLowerCase()));
  const cmdCategories = [...new Set(cmdItems.map((i) => i.category))];

  const closePanel = useCallback(() => {
    if (!selectedProject) return;
    setPanelClosing(true);
    setTimeout(() => { setSelectedProjectPanel(null); setPanelClosing(false); }, 200);
  }, [selectedProject]);

  useEffect(() => { setCmdIndex(0); }, [cmdQuery]);
  useEffect(() => { if (cmdOpen) cmdInputRef.current?.focus(); }, [cmdOpen]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); setCmdQuery(''); setCmdIndex(0); }
      if (e.key === 'Escape') { setCmdOpen(false); closePanel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closePanel]);
  const handleCmdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIndex((i) => Math.min(i + 1, cmdItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && cmdItems[cmdIndex]) { window.location.href = cmdItems[cmdIndex].href; setCmdOpen(false); }
  };
  useEffect(() => {
    cmdListRef.current?.querySelector(`[data-idx="${cmdIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cmdIndex]);

  let flatIdx = 0;

  // Sidebar nav links
  const navLinks = [
    { label: 'Jobs Monitor',  href: '/jobs',       icon: '↻' },
    { label: 'Forms',         href: '/forms',      icon: '☰' },
    { label: 'Consensus',     href: '/consensus',  icon: '⊕' },
  ];

  return (
    <DashboardLayout>
      <style>{`
        @keyframes live-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
        @keyframes row-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes card-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes db-shimmer { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes num-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scan-sweep { from { left: -35%; opacity: 1; } to { left: 130%; opacity: 0; } }
        @keyframes border-glow { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
        @keyframes drop-in { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      {isDark && <div style={{ position: 'fixed', inset: 0, background: T.pageBg, zIndex: -1, pointerEvents: 'none' }} />}
      <div style={{ minHeight: '100%', paddingBottom: 48 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px' }}>

          {/* ── Header ──────────────────────────────────────────── */}
          <div style={{ padding: '24px 4px 20px', animation: 'card-in 0.3s ease both', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 50 }}>

            {/* Project dropdown */}
            <div ref={projectDropRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setProjectDropOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 'none',
                  borderRadius: 8, padding: '4px 2px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.2 }}>
                    {viewProject?.name || 'Select a Project'}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.2, marginTop: 2 }}>
                    {contextProjects?.length || 0} project{(contextProjects?.length || 0) !== 1 ? 's' : ''}
                  </div>
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 0.2s ease', transform: projectDropOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0, marginTop: 1 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {projectDropOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 9999,
                  minWidth: 200,
                  background: isDark ? '#141414' : '#fff',
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                  borderRadius: 10,
                  boxShadow: isDark ? '0 20px 60px rgba(0,0,0,0.7)' : '0 8px 32px rgba(0,0,0,0.1)',
                  overflow: 'hidden',
                  animation: 'drop-in 0.15s ease both',
                }}>
                  <div style={{ padding: '8px 12px 6px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Switch project</span>
                  </div>
                  {(contextProjects || []).map((p: any) => {
                    const active = viewProject?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setViewProject(p); setProjectDropOpen(false); }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', background: active ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') : 'transparent',
                          border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') : 'transparent'; }}
                      >
                        <span style={{ fontSize: 13, fontWeight: active ? 500 : 400, color: active ? T.text : T.textMuted }}>{p.name}</span>
                        {active && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                  <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`, padding: '4px 4px' }}>
                    <Link href="/projects">
                      <button style={{ width: '100%', padding: '7px 8px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: T.textMuted, textAlign: 'left', borderRadius: 6 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; (e.currentTarget as HTMLElement).style.color = T.text; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textMuted; }}
                      >
                        Manage projects →
                      </button>
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <Link href="/extractions">
              <span style={{ fontSize: 13, fontWeight: 600, color: T.accentBlue, cursor: 'pointer', letterSpacing: '-0.01em' }}>
                New Extraction →
              </span>
            </Link>
          </div>

          {/* ── Stats Card ──────────────────────────────────────── */}
          {isDark ? (
            /* ── DARK: iridescent gradient border ── */
            <div style={{
              marginBottom: 20, borderRadius: 16, padding: 1,
              background: `linear-gradient(135deg, ${T.accent}90, ${T.accentBlue}90 33%, ${T.accentAmber}90 66%, ${T.accentGreen}90)`,
              animation: 'card-in 0.35s ease 0.06s both, border-glow 3s ease infinite',
            }}>
              <div style={{
                borderRadius: 15,
                background: 'rgba(6,6,6,0.93)',
                backdropFilter: 'blur(24px)',
                overflow: 'hidden', position: 'relative',
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              }}>
                {/* Dot matrix */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
                {/* Scan sweep */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, width: '32%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.045), transparent)', animation: 'scan-sweep 1.6s cubic-bezier(0.4,0,0.6,1) 0.4s both' }} />
                </div>
                {statsStrip.map((stat, i) => (
                  <div key={stat.label}
                    onMouseEnter={() => setHoveredStat(i)} onMouseLeave={() => setHoveredStat(null)}
                    style={{ position: 'relative', zIndex: 2, padding: '32px 24px 28px', textAlign: 'center', borderRight: i < 3 ? `1px solid ${T.divider}` : 'none', background: hoveredStat === i ? `${stat.color}0D` : 'transparent', transition: 'background 0.35s ease', cursor: 'default', overflow: 'hidden' }}>
                    {/* Glow orb — dim at rest, bright on hover */}
                    <div style={{ position: 'absolute', top: -48, left: '50%', transform: 'translateX(-50%)', width: 160, height: 100, background: `radial-gradient(ellipse at center, ${stat.color}${hoveredStat === i ? '2A' : '09'}, transparent 70%)`, transition: 'background 0.4s ease', pointerEvents: 'none' }} />
                    {/* Corner brackets */}
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 10, left: 14, opacity: hoveredStat === i ? 0.7 : 0.18, transition: 'opacity 0.3s' }}><path d="M0 8 L0 0 L8 0" fill="none" stroke={stat.color} strokeWidth="1.2" strokeLinecap="round" /></svg>
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 10, right: 14, opacity: hoveredStat === i ? 0.7 : 0.18, transition: 'opacity 0.3s' }}><path d="M10 8 L10 0 L2 0" fill="none" stroke={stat.color} strokeWidth="1.2" strokeLinecap="round" /></svg>
                    {/* Label */}
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: stat.color, marginBottom: 14, position: 'relative', opacity: hoveredStat === i ? 1 : 0.65, transition: 'opacity 0.3s' }}>{stat.label}</div>
                    {/* Number */}
                    <div style={{ fontSize: 58, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: hoveredStat === i ? stat.color : T.text, textShadow: hoveredStat === i ? `0 0 40px ${stat.color}70, 0 0 80px ${stat.color}30` : 'none', transition: 'color 0.3s ease, text-shadow 0.3s ease', animation: `num-in 0.6s cubic-bezier(0.2,0.8,0.2,1) ${0.12 + i * 0.09}s both`, position: 'relative' }}>
                      {loading ? <span style={{ color: T.textMuted, animation: 'db-shimmer 1.4s ease infinite', fontSize: 36 }}>—</span> : stat.value}
                    </div>
                    {/* Bottom bar */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${stat.color}, transparent)`, opacity: hoveredStat === i ? 1 : 0.22, transition: 'opacity 0.35s' }} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── LIGHT: same gradient-border treatment as dark, adapted for light ── */
            <div style={{
              marginBottom: 20, borderRadius: 16, padding: 1,
              background: `linear-gradient(135deg, ${T.accent}80, ${T.accentBlue}80 33%, ${T.accentAmber}80 66%, ${T.accentGreen}80)`,
              boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
              animation: 'card-in 0.35s ease 0.06s both, border-glow 3s ease infinite',
            }}>
              <div style={{
                borderRadius: 15,
                background: '#ffffff',
                overflow: 'hidden', position: 'relative',
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              }}>
                {/* Dot matrix */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
                {/* Scan sweep */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, width: '32%', background: 'linear-gradient(90deg, transparent, rgba(99,160,255,0.12), rgba(255,255,255,0.8), rgba(99,160,255,0.12), transparent)', animation: 'scan-sweep 1.6s cubic-bezier(0.4,0,0.6,1) 0.4s both' }} />
                </div>
                {statsStrip.map((stat, i) => (
                  <div key={stat.label}
                    onMouseEnter={() => setHoveredStat(i)} onMouseLeave={() => setHoveredStat(null)}
                    style={{ position: 'relative', zIndex: 2, padding: '32px 24px 28px', textAlign: 'center', borderRight: i < 3 ? '1px solid rgba(0,0,0,0.07)' : 'none', background: hoveredStat === i ? `${stat.color}08` : 'transparent', transition: 'background 0.35s ease', cursor: 'default', overflow: 'hidden' }}>
                    {/* Glow orb — only visible on hover in light mode */}
                    <div style={{ position: 'absolute', top: -48, left: '50%', transform: 'translateX(-50%)', width: 160, height: 100, background: `radial-gradient(ellipse at center, ${stat.color}${hoveredStat === i ? '22' : '00'}, transparent 70%)`, transition: 'background 0.4s ease', pointerEvents: 'none' }} />
                    {/* Corner brackets */}
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 12, left: 14, opacity: hoveredStat === i ? 0.8 : 0.28, transition: 'opacity 0.3s' }}><path d="M0 8 L0 0 L8 0" fill="none" stroke={stat.color} strokeWidth="1.4" strokeLinecap="round" /></svg>
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 12, right: 14, opacity: hoveredStat === i ? 0.8 : 0.28, transition: 'opacity 0.3s' }}><path d="M10 8 L10 0 L2 0" fill="none" stroke={stat.color} strokeWidth="1.4" strokeLinecap="round" /></svg>
                    {/* Label */}
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: stat.color, marginBottom: 14, position: 'relative', opacity: hoveredStat === i ? 1 : 0.85, transition: 'opacity 0.3s' }}>{stat.label}</div>
                    {/* Number */}
                    <div style={{ fontSize: 58, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: hoveredStat === i ? stat.color : '#111111', textShadow: hoveredStat === i ? `0 0 30px ${stat.color}50, 0 0 60px ${stat.color}20` : 'none', transition: 'color 0.3s ease, text-shadow 0.3s ease', animation: `num-in 0.6s cubic-bezier(0.2,0.8,0.2,1) ${0.12 + i * 0.09}s both`, position: 'relative' }}>
                      {loading ? <span style={{ color: '#bbb', animation: 'db-shimmer 1.4s ease infinite', fontSize: 36 }}>—</span> : stat.value}
                    </div>
                    {/* Bottom bar */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${stat.color}, transparent)`, opacity: hoveredStat === i ? 1 : 0.4, transition: 'opacity 0.35s' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Two-Column Main ──────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, marginBottom: 20 }}>

            {/* ── Left: Recent Extractions ──────────────────────── */}
            <div style={{
              background: T.glassBg,
              border: `1px solid ${T.glassBorder}`,
              borderRadius: 14,
              backdropFilter: 'blur(12px)',
              overflow: 'hidden',
              animation: 'card-in 0.4s ease 0.15s both',
              boxShadow: T.cardShadow,
              position: 'relative',
            }}>
              {/* Accent top strip — light mode only */}
              {!isDark && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${T.accent}, ${T.accentBlue})`, zIndex: 10 }} />}
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 16px', borderBottom: `1px solid ${T.divider}` }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: isDark ? T.textMuted : T.accent, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Recent Extractions</span>
                <Link href="/extractions">
                  <span style={{ fontSize: 11, color: T.accentBlue, cursor: 'pointer' }}>View all →</span>
                </Link>
              </div>

              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '10px 28px', borderBottom: `1px solid ${T.divider}` }}>
                {['', 'Document', 'Form', 'Coverage', 'Date', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>{h}</div>
                ))}
              </div>

              {/* Empty state */}
              {!loading && recentExtractions.length === 0 && (
                <div style={{ padding: '48px 28px', textAlign: 'center', fontSize: 13, color: T.textMuted }}>
                  No extractions yet — start one above
                </div>
              )}
              {loading && (
                <div style={{ padding: '48px 28px', textAlign: 'center', fontSize: 13, color: T.textMuted, animation: 'db-shimmer 1.4s ease infinite' }}>
                  Loading…
                </div>
              )}

              {/* Rows */}
              {recentExtractions.map((doc: any, i: number) => {
                const pct = doc.fields !== null && doc.total > 0 ? Math.round((doc.fields / doc.total) * 100) : 0;
                const isPartial = doc.status === 'done' && doc.total > 0 && doc.fields === 0;
                const dotColor = doc.status === 'failed' ? T.accent : doc.status === 'running' ? T.accentBlue : isPartial ? T.accentAmber : pct === 100 ? T.accentGreen : T.accentAmber;
                const barColor = doc.status === 'failed' ? T.accent : doc.status === 'running' ? T.accentBlue : pct === 100 ? T.accentGreen : T.accentAmber;
                const barWidth = pct > 0 ? Math.max(pct, 4) : 0;
                return (
                  <div key={doc.id || i}
                    onMouseEnter={() => setHoveredRow(i)} onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '18px 28px', alignItems: 'center',
                      borderBottom: i < recentExtractions.length - 1 ? `1px solid ${T.divider}` : 'none',
                      background: hoveredRow === i ? T.rowHover : 'transparent',
                      transition: 'background 0.15s',
                      animation: `row-in 0.25s ease ${i * 50}ms both`,
                    }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, animation: doc.status === 'running' ? 'live-pulse 1.5s ease infinite' : 'none' }} />
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                    <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.form}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: T.trackBg, overflow: 'hidden' }}>
                        {doc.status === 'running'
                          ? <div style={{ width: '100%', height: '100%', background: `linear-gradient(90deg, transparent, ${barColor}, transparent)`, backgroundSize: '200% 100%', animation: 'db-shimmer 1.5s ease infinite' }} />
                          : <div style={{ height: '100%', width: `${barWidth}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.accentBlue})`, borderRadius: 2, transition: 'width 0.5s ease', boxShadow: `0 0 4px ${barColor}40` }} />}
                      </div>
                      <span style={{ fontSize: 10, color: dotColor, fontWeight: 600, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {doc.status === 'running' ? '…' : `${doc.fields}/${doc.total}`}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: T.textMuted }}>{doc.time}</span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {doc.status === 'done' && !isPartial && (
                        <Link href={`/results?extraction=${doc.id}`}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? T.textMuted : T.accentBlue, border: `1px solid ${isDark ? T.glassBorder : T.accentBlue + '40'}`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>View</span>
                        </Link>
                      )}
                      {(doc.status === 'failed' || isPartial) && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: isPartial ? T.accentAmber : T.accent, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                          {isPartial ? 'Review' : 'Retry'}
                        </span>
                      )}
                      {doc.status === 'running' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: T.accentBlue }}>
                          <svg width="9" height="9" viewBox="0 0 16 16" style={{ animation: 'spin-slow 1.2s linear infinite' }}>
                            <circle cx="8" cy="8" r="6" fill="none" stroke={T.accentBlue} strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                          </svg>
                          Running
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Footer link */}
              {recentExtractions.length > 0 && (
                <div style={{ padding: '14px 28px', borderTop: `1px solid ${T.divider}` }}>
                  <Link href="/extractions">
                    <span style={{ fontSize: 12, color: T.accentBlue, cursor: 'pointer' }}>View all extractions →</span>
                  </Link>
                </div>
              )}
            </div>

            {/* ── Right: Status Sidebar ─────────────────────────── */}
            <div style={{
              background: T.glassBg,
              border: `1px solid ${T.glassBorder}`,
              borderRadius: 14,
              backdropFilter: 'blur(12px)',
              padding: '28px 24px',
              animation: 'card-in 0.4s ease 0.2s both',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: T.cardShadow,
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Accent top strip — light mode only, same brand gradient as extractions card */}
              {!isDark && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${T.accent}, ${T.accentBlue})` }} />}

              {/* System Status section */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: isDark ? T.textMuted : T.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 16 }}>
                  System Status
                </div>

                {/* Running */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${T.divider}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.accentBlue, display: 'inline-block', animation: runningExtractionCount > 0 ? 'live-pulse 1.6s ease infinite' : 'none', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>Running</span>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 700, color: T.accentBlue, fontVariantNumeric: 'tabular-nums' }}>
                    {loading ? '—' : runningExtractionCount}
                  </span>
                </div>

                {/* Done */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${T.divider}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, color: T.accentGreen, lineHeight: 1, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>Completed</span>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 700, color: T.accentGreen, fontVariantNumeric: 'tabular-nums' }}>
                    {loading ? '—' : doneExtractionCount}
                  </span>
                </div>

                {/* Need attention */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, color: T.accentAmber, lineHeight: 1, flexShrink: 0 }}>⚠</span>
                    <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>Need Attention</span>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 700, color: T.accentAmber, fontVariantNumeric: 'tabular-nums' }}>
                    {loading ? '—' : apNeedAttention}
                  </span>
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: T.divider, margin: '20px 0' }} />

              {/* Navigate section */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: isDark ? T.textMuted : T.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>
                  Navigate
                </div>
                {navLinks.map((link, i) => (
                  <Link key={link.href} href={link.href}>
                    <div
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.color = T.text;
                        const arrow = el.querySelector('.nav-arrow') as HTMLElement;
                        if (arrow) arrow.style.transform = 'translateX(2px)';
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.color = T.textMuted;
                        const arrow = el.querySelector('.nav-arrow') as HTMLElement;
                        if (arrow) arrow.style.transform = 'translateX(0)';
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 0',
                        borderBottom: i < navLinks.length - 1 ? `1px solid ${T.divider}` : 'none',
                        cursor: 'pointer',
                        color: T.textMuted,
                        transition: 'color 0.15s',
                      }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'inherit' }}>
                        › {link.label}
                      </span>
                      <span className="nav-arrow" style={{ fontSize: 13, color: 'inherit', transition: 'transform 0.15s ease' }}>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px', fontSize: 11, color: T.textDim }}>
            <span>{projectsData.reduce((s, p) => s + p.document_count, 0)} documents · {projectsData.reduce((s, p) => s + p.form_count, 0)} forms · {projectsData.length} projects</span>
          </div>

        </div>
      </div>

      {/* ── Project detail slide-over ────────────────────────── */}
      {selectedProject && (
        <div onClick={closePanel}
          className={cn('fixed inset-0 flex items-stretch justify-end z-[90]', panelClosing ? 'animate-dashboard-overlayOut' : 'animate-dashboard-overlayIn')}
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()}
            className={cn(panelClosing ? 'animate-dashboard-panelOut' : 'animate-dashboard-panelIn')}
            style={{ width: 520, background: T.panelBg, borderLeft: `1px solid ${T.glassBorder}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${T.divider}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M8 3v18" /></svg>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0 }}>{selectedProject.name}</h2>
                    {selectedProject.active && <Pill status="Active" isDark={isDark} />}
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted, paddingLeft: 23 }}>{selectedProject.desc}</div>
                  <div style={{ display: 'flex', gap: 16, paddingLeft: 23, marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: T.textMuted }}><span style={{ fontWeight: 600, color: T.text }}>{selectedProject.forms.length}</span> forms</span>
                    <span style={{ fontSize: 12, color: T.textMuted }}><span style={{ fontWeight: 600, color: T.text }}>{selectedProject.documents.length}</span> documents</span>
                    <span style={{ fontSize: 12, color: T.textMuted }}>{selectedProject.created}</span>
                  </div>
                </div>
                <button onClick={closePanel} style={{ fontSize: 16, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 8px', borderRadius: 6, fontFamily: 'inherit' }}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
              <PanelSection
                icon={<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />}
                iconColor={T.accentBlue} title="Forms" items={selectedProject.forms}
                T={T} isDark={isDark}
                renderItem={(form, i, hasBorder) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: hasBorder ? `1px solid ${T.divider}` : 'none', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 10 }}>{form.name}</span>
                    <Pill status={form.status} isDark={isDark} />
                  </div>
                )}
              />
              <PanelSection
                icon={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
                iconColor={T.accentAmber} title="Documents" items={selectedProject.documents}
                T={T} isDark={isDark}
                renderItem={(doc, i, hasBorder) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: hasBorder ? `1px solid ${T.divider}` : 'none', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 10 }}>{doc.name}</span>
                    <Pill status={doc.status} isDark={isDark} />
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Command palette ──────────────────────────────────── */}
      {cmdOpen && (
        <div onClick={() => setCmdOpen(false)}
          className="fixed inset-0 flex items-start justify-center z-[100]"
          style={{ paddingTop: 130, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', animation: 'row-in 0.1s ease' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, background: T.cmdBg, border: `1px solid ${T.cmdBorder}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.4)', animation: 'card-in 0.15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${T.divider}` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
              <input ref={cmdInputRef} autoFocus value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={handleCmdKeyDown}
                placeholder="Search actions, pages, exports..."
                style={{ fontSize: 13, color: T.text, background: 'transparent', border: 'none', outline: 'none', flex: 1, fontFamily: 'inherit' }} />
              <kbd style={{ fontSize: 11, color: T.textMuted, background: T.glassBg, border: `1px solid ${T.glassBorder}`, borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit' }}>ESC</kbd>
            </div>
            <div ref={cmdListRef} style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}>
              {cmdItems.length === 0 && <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: T.textMuted }}>No results for &quot;{cmdQuery}&quot;</div>}
              {cmdCategories.map((cat) => (
                <div key={cat}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 10px 4px' }}>{cat}</div>
                  {cmdItems.filter((item) => item.category === cat).map((item) => {
                    const idx = flatIdx++;
                    const isActive = idx === cmdIndex;
                    return (
                      <div key={item.label} data-idx={idx}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', borderRadius: 8, cursor: 'pointer', background: isActive ? T.rowHover : 'transparent', transition: 'background 0.1s' }}
                        onClick={() => { window.location.href = item.href; setCmdOpen(false); }}
                        onMouseEnter={() => setCmdIndex(idx)}>
                        <span style={{ width: 26, height: 26, borderRadius: 6, background: T.glassBg, border: `1px solid ${T.glassBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: T.textMuted, flexShrink: 0 }}>{item.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, flex: 1, color: isActive ? T.text : T.textMuted }}>{item.label}</span>
                        {(item as any).shortcut && <kbd style={{ fontSize: 11, color: T.textDim, background: 'none', border: 'none', fontFamily: 'inherit' }}>{(item as any).shortcut}</kbd>}
                      </div>
                    );
                  })}
                </div>
              ))}
              <span className="hidden">{(flatIdx = 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: `1px solid ${T.divider}`, fontSize: 11, color: T.textMuted }}>
              <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
