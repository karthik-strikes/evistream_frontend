'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/logo';
import { useTheme } from '@/contexts/ThemeContext';

const MKT_STYLES = `
html, body { background: white !important; color: #0a0a0a !important; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --zinc-50: #fafafa; --zinc-100: #f4f4f5; --zinc-200: #e4e4e7;
  --zinc-300: #d4d4d8; --zinc-400: #a1a1aa; --zinc-500: #71717a;
  --zinc-700: #3f3f46; --zinc-900: #18181b; --black: #0a0a0a;
  --blue: #011F5B; --red: #990000;
  --blue-mid: #1e3a8a; --blue-tint: #e8edf5; --red-tint: #f5e8e8;
  --font-sans: 'Inter', sans-serif;
  --font-serif: 'Crimson Pro', Georgia, serif;
}
body { font-family: var(--font-sans); background: white; color: var(--black); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { text-decoration: none; color: inherit; }
img, svg { display: block; }

/* NAV */
#mkt-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(255,255,255,0.94); backdrop-filter: blur(12px);
  border-bottom: 1px solid transparent;
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}
#mkt-nav.scrolled { box-shadow: 0 1px 16px rgba(0,0,0,0.07); border-bottom-color: var(--zinc-200); }
.mkt-nav-inner {
  max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 60px;
  display: flex; align-items: center; justify-content: space-between;
}
.mkt-logo { display: flex; align-items: center; gap: 9px; }
.mkt-wordmark { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--black); }
.mkt-nav-cta { display: flex; gap: 10px; align-items: center; }
.mkt-btn-ghost { font-size: 14px; font-weight: 500; color: var(--zinc-700); padding: 8px 18px; border-radius: 999px; transition: background 0.2s; }
.mkt-btn-ghost:hover { background: var(--zinc-100); }
.mkt-btn-pill { font-size: 14px; font-weight: 600; color: white; background: var(--blue); padding: 8px 20px; border-radius: 999px; transition: opacity 0.2s; }
.mkt-btn-pill:hover { opacity: 0.85; }

/* MAIN */
.mkt-main { padding-top: 60px; min-height: 100vh; }

/* PAGE HERO */
.mkt-page-hero {
  max-width: 800px; margin: 0 auto; padding: 72px 24px 48px;
  border-bottom: 1px solid var(--zinc-100);
}
.mkt-page-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
  color: var(--red); display: block; margin-bottom: 12px;
}
.mkt-page-title {
  font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; letter-spacing: -0.04em;
  line-height: 1.1; margin-bottom: 16px; color: var(--black);
}
.mkt-page-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.mkt-page-lead {
  font-size: 16px; color: var(--zinc-500); line-height: 1.7; max-width: 600px;
}

/* CONTENT */
.mkt-content {
  max-width: 800px; margin: 0 auto; padding: 48px 24px 96px;
}
.mkt-section { margin-bottom: 56px; }
.mkt-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--zinc-400); margin-bottom: 20px; padding-bottom: 10px;
  border-bottom: 1px solid var(--zinc-100);
}
.mkt-section p { font-size: 14px; color: var(--zinc-700); line-height: 1.8; margin-bottom: 16px; }
.mkt-section p:last-child { margin-bottom: 0; }
.mkt-section h3 { font-size: 16px; font-weight: 700; color: var(--black); margin-bottom: 8px; margin-top: 28px; }
.mkt-section h3:first-child { margin-top: 0; }
.mkt-link {
  color: var(--blue); border-bottom: 1px solid rgba(1,31,91,0.2);
  transition: border-color 0.2s; font-weight: 500;
}
.mkt-link:hover { border-color: var(--blue); }
.mkt-link-ext {
  display: inline-flex; align-items: center; gap: 4px;
}
.mkt-link-ext::after { content: '↗'; font-size: 11px; opacity: 0.6; }

/* CARDS */
.mkt-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 4px; }
.mkt-card {
  border: 1px solid var(--zinc-200); border-radius: 12px; padding: 20px 20px 18px;
  background: white; transition: box-shadow 0.2s, transform 0.2s;
}
.mkt-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-2px); }
.mkt-card-icon { font-size: 22px; margin-bottom: 10px; }
.mkt-card-title { font-size: 13px; font-weight: 700; color: var(--black); margin-bottom: 5px; }
.mkt-card-body { font-size: 12px; color: var(--zinc-500); line-height: 1.6; }

/* SOCIAL LINKS */
.mkt-social-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.mkt-social-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  border: 1px solid var(--zinc-200); background: white; color: var(--zinc-700);
  transition: background 0.2s, border-color 0.2s, color 0.2s; cursor: pointer;
}
.mkt-social-btn:hover { background: var(--zinc-50); border-color: var(--zinc-300); color: var(--black); }
.mkt-social-btn svg { width: 16px; height: 16px; flex-shrink: 0; }

/* CHANGELOG */
.mkt-changelog { display: flex; flex-direction: column; gap: 0; }
.mkt-cl-entry {
  display: grid; grid-template-columns: 120px 1fr;
  gap: 0 32px; padding: 32px 0; border-bottom: 1px solid var(--zinc-100);
}
.mkt-cl-entry:last-child { border-bottom: none; }
.mkt-cl-meta { padding-top: 2px; }
.mkt-cl-version {
  font-size: 12px; font-weight: 700; color: var(--blue); letter-spacing: -0.01em;
  margin-bottom: 4px;
}
.mkt-cl-date { font-size: 11px; color: var(--zinc-400); }
.mkt-cl-tag {
  display: inline-block; margin-top: 6px;
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 999px;
}
.mkt-cl-tag.launch { background: var(--blue-tint); color: var(--blue); }
.mkt-cl-tag.feature { background: #f0fdf4; color: #16a34a; }
.mkt-cl-tag.fix { background: #fff7ed; color: #c2410c; }
.mkt-cl-body h3 { font-size: 15px; font-weight: 700; color: var(--black); margin-bottom: 8px; }
.mkt-cl-body p { font-size: 13px; color: var(--zinc-500); line-height: 1.7; margin-bottom: 12px; }
.mkt-cl-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.mkt-cl-list li {
  display: flex; align-items: baseline; gap: 9px;
  font-size: 13px; color: var(--zinc-700); line-height: 1.5;
}
.mkt-cl-list li::before { content: '—'; color: var(--zinc-300); flex-shrink: 0; font-size: 10px; }

/* SECURITY */
.mkt-security-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.mkt-security-item {
  padding: 20px; border: 1px solid var(--zinc-100); border-radius: 10px;
  background: var(--zinc-50);
}
.mkt-security-item-icon { font-size: 20px; margin-bottom: 10px; }
.mkt-security-item-title { font-size: 13px; font-weight: 700; color: var(--black); margin-bottom: 6px; }
.mkt-security-item-body { font-size: 12px; color: var(--zinc-500); line-height: 1.6; }

/* PLACEHOLDER */
.mkt-placeholder {
  text-align: center; padding: 64px 24px 80px;
  max-width: 540px; margin: 0 auto;
}
.mkt-placeholder-icon { font-size: 40px; margin-bottom: 16px; }
.mkt-placeholder-title { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; color: var(--black); margin-bottom: 10px; }
.mkt-placeholder-body { font-size: 14px; color: var(--zinc-500); line-height: 1.7; margin-bottom: 24px; }

/* FOOTER */
mkt-footer-wrap { background: var(--black); }
.mkt-footer {
  background: var(--black); border-top: 1px solid var(--zinc-200);
  padding: 48px 24px 20px;
  font-family: var(--font-sans);
}
.mkt-footer-inner {
  max-width: 1080px; margin: 0 auto;
  display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 44px;
  margin-bottom: 32px;
}
.mkt-footer-brand .mkt-wordmark { color: white; font-size: 16px; }
.mkt-footer-brand p { font-size: 12px; color: var(--zinc-500); line-height: 1.7; margin-top: 10px; max-width: 240px; }
.mkt-footer-col h4 { font-size: 12px; font-weight: 700; color: white; margin-bottom: 14px; }
.mkt-footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.mkt-footer-col ul li a { font-size: 12px; color: var(--zinc-500); transition: color 0.2s; }
.mkt-footer-col ul li a:hover { color: white; }
.mkt-footer-bottom {
  max-width: 1080px; margin: 0 auto;
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08);
}
.mkt-footer-bottom p { font-size: 11px; color: var(--zinc-500); }
.mkt-footer-legal { display: flex; gap: 12px; }
.mkt-footer-legal a { font-size: 11px; color: var(--zinc-500); transition: color 0.2s; }
.mkt-footer-legal a:hover { color: white; }

@media (max-width: 768px) {
  .mkt-footer-inner { grid-template-columns: 1fr; gap: 28px; }
  .mkt-cl-entry { grid-template-columns: 1fr; gap: 8px; }
}
`;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, [resolvedTheme]);

  useEffect(() => {
    const nav = document.getElementById('mkt-nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MKT_STYLES }} />

      <nav id="mkt-nav">
        <div className="mkt-nav-inner">
          <Link href="/" className="mkt-logo">
            <Logo size={28} className="text-[#011F5B]" />
            <span className="mkt-wordmark">eviStreams</span>
          </Link>
          <div className="mkt-nav-cta">
            <a href="/login" className="mkt-btn-ghost">Sign in</a>
            <a href="/register" className="mkt-btn-pill">Get started</a>
          </div>
        </div>
      </nav>

      <main className="mkt-main">{children}</main>

      <footer className="mkt-footer">
        <div className="mkt-footer-inner">
          <div className="mkt-footer-col mkt-footer-brand">
            <Link href="/" className="mkt-logo">
              <Logo size={20} className="text-white" />
              <span className="mkt-wordmark">eviStreams</span>
            </Link>
            <p>AI-powered systematic review extraction for medical research teams.</p>
          </div>
          <div className="mkt-footer-col">
            <h4>Platform</h4>
            <ul>
              <li><Link href="/how-it-works">How it works</Link></li>
              <li><a href="/security">Security</a></li>
              <li><a href="/changelog">Changelog</a></li>
            </ul>
          </div>
          <div className="mkt-footer-col">
            <h4>Company</h4>
            <ul>
              <li><a href="/about">About</a></li>
              <li><a href="https://www.dental.upenn.edu/research/center-for-integrative-global-oral-health/" target="_blank" rel="noopener noreferrer">Penn Dental Medicine</a></li>
              <li><a href="/contact">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="mkt-footer-bottom">
          <p>&copy; 2026 eviStreams</p>
          <div className="mkt-footer-legal">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/security">Security</a>
          </div>
        </div>
      </footer>
    </>
  );
}
