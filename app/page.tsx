'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from '@/contexts/ThemeContext';
import { Logo } from '@/components/ui/logo';

const UPENN_LOGO = "/PennDental_UPenn_Logo_300_dpi.jpg";

export default function LandingPage() {
  const { resolvedTheme } = useTheme();
  const initialDarkRef = useRef<boolean | null>(null);

  // Capture original dark state once; restore on unmount
  useEffect(() => {
    initialDarkRef.current = document.documentElement.classList.contains('dark');
    return () => {
      if (initialDarkRef.current) {
        document.documentElement.classList.add('dark');
      }
    };
  }, []);

  // Remove dark class whenever ThemeContext (re-)applies it
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, [resolvedTheme]);

  useEffect(() => {
    // Nav scroll shadow
    const nav = document.getElementById('main-nav');
    if (nav) {
      const handleScroll = () => { nav.classList.toggle('scrolled', window.scrollY > 40); };
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, []);

  useEffect(() => {
    // Scroll reveal
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.10 });
    document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));
    return () => revealObs.disconnect();
  }, []);

  useEffect(() => {
    // Hero extraction rows animation
    const heroRows = [
      { barId: 'pb2', badgeId: 'badge-pb2' },
      { barId: 'pb3', badgeId: 'badge-pb3' },
      { barId: 'pb4', badgeId: 'badge-pb4' },
    ];
    let heroIdx = 0, heroPct = 44, heroWait = false;
    const iv = setInterval(() => {
      if (heroWait) return;
      const row = heroRows[heroIdx % heroRows.length];
      const bar = document.getElementById(row.barId) as HTMLElement | null;
      const badge = document.getElementById(row.badgeId) as HTMLElement | null;
      if (!bar) return;
      heroPct = Math.min(100, heroPct + 3);
      bar.style.width = heroPct + '%';
      if (heroPct >= 100) {
        heroWait = true;
        if (badge) { badge.className = 'badge badge-done'; badge.textContent = 'Done'; }
        bar.classList.remove('blue'); bar.classList.add('done-bar');
        setTimeout(() => {
          heroIdx++; heroPct = 5; heroWait = false;
          const next = heroRows[heroIdx % heroRows.length];
          const nb = document.getElementById(next.barId) as HTMLElement | null;
          const nbadge = document.getElementById(next.badgeId) as HTMLElement | null;
          if (nb) { nb.style.width = '5%'; nb.classList.add('blue'); nb.classList.remove('done-bar'); }
          if (nbadge) { nbadge.className = 'badge badge-running'; nbadge.textContent = 'Running'; }
        }, 700);
      }
    }, 80);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    // Decomposition tree build animation
    const decompEl = document.getElementById('decomp-tree');
    if (decompEl) {
      let dtriggered = false;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !dtriggered) {
            dtriggered = true; obs.disconnect();
            const seq = ['ts1', 'tf1a', 'tf1b', 'ts2', 'tf2a', 'tf2b', 'ts3', 'tf3a', 'tf3b'];
            seq.forEach((id, i) => {
              setTimeout(() => { const el = document.getElementById(id); if (el) el.classList.add('visible'); }, i * 220);
            });
          }
        });
      }, { threshold: 0.3 });
      obs.observe(decompEl);
      return () => obs.disconnect();
    }
  }, []);

  useEffect(() => {
    // Match % count-up
    const matchEl = document.getElementById('match-count');
    if (matchEl) {
      let mtriggered = false;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !mtriggered) {
            mtriggered = true; obs.disconnect();
            let count = 0;
            const step = 94 / (1400 / 14);
            const iv = setInterval(() => {
              count = Math.min(94, count + step);
              matchEl.textContent = String(Math.round(count));
              if (count >= 94) clearInterval(iv);
            }, 14);
          }
        });
      }, { threshold: 0.5 });
      obs.observe(matchEl);
      return () => obs.disconnect();
    }
  }, []);

  useEffect(() => {
    // Typewriter code block
    const codeEl = document.getElementById('typewriter-code');
    if (codeEl) {
      let ttriggered = false;
      const codeText = `{
  "paper_id": "paper_014",
  "extraction_date": "2026-02-24",
  "fields": {
    "sample_size": {
      "value": "124 patients",
      "source": "We enrolled 124..."
    },
    "intervention": {
      "value": "SDF treatment",
      "source": "...38% silver..."
    }
  }
}`;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !ttriggered) {
            ttriggered = true; obs.disconnect();
            let i = 0;
            (function typeNext() {
              if (i < codeText.length) { codeEl.textContent += codeText[i++]; setTimeout(typeNext, 18); }
            })();
          }
        });
      }, { threshold: 0.3 });
      obs.observe(codeEl);
      return () => obs.disconnect();
    }
  }, []);

  useEffect(() => {
    // Consensus adjudication animation
    const consensusFill = document.getElementById('consensus-fill');
    const consensusPct = document.getElementById('consensus-pct');
    const consensusRows = ['cr1', 'cr2', 'cr3', 'cr4'];
    if (consensusFill) {
      let ctriggered = false;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !ctriggered) {
            ctriggered = true; obs.disconnect();
            // Animate rows appearing one by one
            consensusRows.forEach((id, i) => {
              setTimeout(() => {
                const el = document.getElementById(id);
                if (el) el.classList.add('show');
              }, i * 350);
            });
            // Animate agreement meter after rows
            setTimeout(() => {
              if (consensusFill) consensusFill.style.width = '83%';
              // Count up percentage
              if (consensusPct) {
                let count = 0;
                const iv = setInterval(() => {
                  count = Math.min(83, count + 2);
                  consensusPct.textContent = count + '% agreed';
                  if (count >= 83) clearInterval(iv);
                }, 20);
              }
            }, consensusRows.length * 350 + 200);
          }
        });
      }, { threshold: 0.3 });
      obs.observe(consensusFill.closest('.consensus-demo')!);
      return () => obs.disconnect();
    }
  }, []);

  useEffect(() => {
    // Hero product window hover perspective
    const win = document.querySelector('.product-window') as HTMLElement | null;
    if (win) {
      const onEnter = () => { win.style.transform = 'perspective(1200px) rotateX(0deg) scale(1)'; win.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'; };
      const onLeave = () => { win.style.transform = 'perspective(1200px) rotateX(3deg) scale(.97)'; win.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'; };
      win.addEventListener('mouseenter', onEnter);
      win.addEventListener('mouseleave', onLeave);
      return () => { win.removeEventListener('mouseenter', onEnter); win.removeEventListener('mouseleave', onLeave); };
    }
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
html, body { background: white !important; color: #0a0a0a !important; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --zinc-50: #fafafa; --zinc-100: #f4f4f5; --zinc-200: #e4e4e7;
  --zinc-300: #d4d4d8; --zinc-400: #a1a1aa; --zinc-500: #71717a;
  --zinc-700: #3f3f46; --zinc-900: #18181b; --black: #0a0a0a;
  --blue: #011F5B; --red: #990000;
  --blue-mid: #1e3a8a; --blue-tint: #e8edf5; --red-tint: #f5e8e8;
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --font-sans: 'Inter', sans-serif;
  --font-serif: 'Crimson Pro', Georgia, serif;
}
body { font-family: var(--font-sans); background: white; color: var(--black); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { text-decoration: none; color: inherit; }
img, svg { display: block; }

#main-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(255,255,255,0.94); backdrop-filter: blur(12px);
  border-bottom: 1px solid transparent;
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}
#main-nav.scrolled { box-shadow: 0 1px 16px rgba(0,0,0,0.07); border-bottom-color: var(--zinc-200); }
.nav-inner {
  max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 60px;
  display: flex; align-items: center; justify-content: space-between;
}
.logo { display: flex; align-items: center; gap: 9px; }
.wordmark { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.nav-links { display: flex; gap: 28px; }
.nav-links a { font-size: 13px; color: var(--zinc-500); transition: color 0.2s; }
.nav-links a:hover { color: var(--black); }
.nav-cta { display: flex; gap: 10px; align-items: center; }
.btn-ghost { font-size: 14px; font-weight: 500; color: var(--zinc-700); padding: 8px 18px; border-radius: 999px; transition: background 0.2s; }
.btn-ghost:hover { background: var(--zinc-100); }
.btn-pill { font-size: 14px; font-weight: 600; color: white; background: var(--blue); padding: 8px 20px; border-radius: 999px; transition: opacity 0.2s; }
.btn-pill:hover { opacity: 0.85; }

/* MESH BLOBS */
.mesh-wrap {
  position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none;
}
.mesh-blob {
  position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.35;
  animation: blobFloat 12s ease-in-out infinite;
}
.mesh-blob-1 {
  width: 520px; height: 520px; top: -120px; left: -100px;
  background: radial-gradient(circle, rgba(1,31,91,0.5) 0%, transparent 70%);
  animation-duration: 14s;
}
.mesh-blob-2 {
  width: 420px; height: 420px; top: 10%; right: -80px;
  background: radial-gradient(circle, rgba(153,0,0,0.4) 0%, transparent 70%);
  animation-duration: 10s; animation-delay: -4s;
}
.mesh-blob-3 {
  width: 360px; height: 360px; bottom: 5%; left: 35%;
  background: radial-gradient(circle, rgba(30,58,138,0.35) 0%, transparent 70%);
  animation-duration: 16s; animation-delay: -8s;
}
@keyframes blobFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%       { transform: translate(30px, -40px) scale(1.05); }
  66%       { transform: translate(-20px, 25px) scale(0.97); }
}

.hero {
  min-height: 70vh; padding-top: 60px;
  display: grid; grid-template-columns: 1fr 1.05fr;
  gap: 40px; align-items: center;
  max-width: 1200px; margin: 0 auto;
  padding-left: 24px; padding-right: 24px; padding-bottom: 40px;
}
.hero-left { padding-top: 16px; }
.hero-h1 {
  font-size: clamp(1.9rem, 3.5vw, 2.6rem);
  font-weight: 800; line-height: 1.05;
  letter-spacing: -0.05em; margin-bottom: 14px;
}
.hero-h1 em { font-family: var(--font-serif); font-style: italic; font-weight: 400; color: var(--red); }
.hero-sub { font-size: 14px; color: var(--zinc-500); max-width: 400px; line-height: 1.65; margin-bottom: 24px; }
.btn-cta {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--black); color: white;
  font-size: 15px; font-weight: 600;
  padding: 13px 26px; border-radius: 999px;
  transition: opacity 0.2s, transform 0.2s var(--spring); cursor: pointer;
}
.btn-cta:hover { opacity: 0.85; transform: translateY(-1px); }
.btn-cta-alt {
  display: inline-flex; align-items: center; gap: 8px;
  background: white; color: var(--blue); border: 1.5px solid var(--blue);
  font-size: 15px; font-weight: 600;
  padding: 12px 26px; border-radius: 999px;
  transition: background 0.2s, transform 0.2s var(--spring); cursor: pointer;
}
.btn-cta-alt:hover { background: var(--blue-tint); transform: translateY(-1px); }

.hero-right { position: relative; padding: 32px 0; }
.ambient-glow {
  position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%);
  width: 70%; height: 50px;
  background: radial-gradient(ellipse, rgba(1,31,91,0.18) 0%, transparent 70%);
  filter: blur(18px); pointer-events: none; z-index: 0;
}
.product-window {
  position: relative; z-index: 1;
  background: white; border: 1px solid var(--zinc-200); border-radius: 10px;
  border-top: 2px solid var(--blue);
  box-shadow: 0 16px 48px rgba(0,0,0,0.10), 0 3px 12px rgba(0,0,0,0.05);
  overflow: hidden;
  transform: perspective(1200px) rotateX(3deg) scale(.97);
  transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
}
.browser-chrome { display: flex; align-items: center; gap: 5px; padding: 9px 12px; background: var(--zinc-50); border-bottom: 1px solid var(--zinc-200); }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.dot-red { background: #ff5f57; } .dot-yellow { background: #ffbd2e; } .dot-green { background: #28c840; }
.tab-bar { display: flex; border-bottom: 1px solid var(--zinc-200); background: white; padding: 0 12px; overflow-x: auto; }
.tab { padding: 7px 12px; font-size: 11px; font-weight: 500; color: var(--zinc-400); cursor: default; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab.active { color: var(--blue); border-bottom-color: var(--blue); font-weight: 600; }
.app-layout { display: flex; height: 288px; }
.sidebar { width: 120px; border-right: 1px solid var(--zinc-200); padding: 8px 0; flex-shrink: 0; overflow: hidden; }
.sidebar-item { padding: 5px 10px; font-size: 10px; color: var(--zinc-400); cursor: default; white-space: nowrap; border-radius: 5px; margin: 1px 5px; }
.sidebar-item.active { background: var(--blue-tint); color: var(--blue); font-weight: 600; }
.main-content { flex: 1; padding: 10px; overflow: hidden; }
.stat-cards { display: grid; grid-template-columns: repeat(4,1fr); gap: 5px; margin-bottom: 10px; }
.stat-card { background: var(--zinc-50); border: 1px solid var(--zinc-200); border-radius: 7px; padding: 7px 9px; text-align: center; }
.stat-value { font-size: 17px; font-weight: 800; letter-spacing: -0.03em; }
.stat-label { font-size: 8px; color: var(--zinc-400); margin-top: 1px; text-transform: uppercase; letter-spacing: 0.05em; }
.extraction-rows { display: flex; flex-direction: column; gap: 5px; }
.extraction-row { display: flex; align-items: center; gap: 7px; background: white; border: 1px solid var(--zinc-100); border-radius: 7px; padding: 6px 9px; }
.row-info { flex: 1; min-width: 0; }
.row-title { font-size: 10px; font-weight: 600; }
.row-sub { font-size: 8px; color: var(--zinc-400); }
.row-progress { flex: 1; }
.progress-bar-bg { background: var(--zinc-100); border-radius: 999px; height: 3px; overflow: hidden; }
.progress-bar { height: 100%; border-radius: 999px; transition: width 0.5s ease; }
.progress-bar.blue { background: var(--blue); }
.progress-bar.done-bar { background: var(--zinc-400); }
.badge { font-size: 8px; font-weight: 600; padding: 2px 6px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
.badge-done { background: var(--blue-tint); color: var(--blue); }
.badge-running { background: var(--zinc-100); color: var(--zinc-700); }
.badge-queued { background: var(--zinc-100); color: var(--zinc-400); }

.upenn-band {
  border-top: 1px solid var(--zinc-200); border-bottom: 1px solid var(--zinc-200);
  background: var(--zinc-50); padding: 28px 24px;
  display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap;
}
.partner-label { font-size: 10px; font-weight: 700; letter-spacing: 0.15em; color: var(--zinc-400); text-transform: uppercase; }
.upenn-text { display: flex; flex-direction: column; gap: 2px; }
.upenn-logo-img { height: 48px; width: auto; display: block; }
.upenn-sub { font-size: 11px; color: var(--zinc-500); }

.stats-band { border-top: 1px solid var(--zinc-200); border-bottom: 1px solid var(--zinc-200); background: white; padding: 56px 24px; }
.stats-inner { max-width: 860px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); }
.stat-item { padding: 0 28px; text-align: center; border-right: 1px solid var(--zinc-200); }
.stat-item:last-child { border-right: none; }
.stat-num { font-size: clamp(2.2rem, 4vw, 3rem); font-weight: 900; letter-spacing: -0.04em; line-height: 1; margin-bottom: 7px; }
.stat-unit { font-family: var(--font-serif); font-style: italic; font-size: 0.55em; }
.stat-lbl { font-size: 10px; color: var(--zinc-400); text-transform: uppercase; letter-spacing: 0.12em; font-weight: 500; }

.quote-band { background: var(--black); padding: 88px 24px; text-align: center; border-left: 4px solid var(--red); border-left: none; position: relative; overflow: hidden; }
.quote-band::before { content: \'\'; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--red) 0%, var(--blue) 100%); }
.quote-text { font-family: var(--font-serif); font-style: italic; font-size: clamp(1.6rem, 3.5vw, 2.6rem); font-weight: 300; line-height: 1.2; color: white; max-width: 760px; margin: 0 auto; }

.pipeline-section {
  background: #08090f; padding: 64px 0 72px; position: relative; overflow: hidden;
  border-top: 1px solid rgba(255,255,255,0.05);
}
.pipeline-inner { max-width: 1100px; margin: 0 auto; padding: 0 28px; }
.pipeline-header { text-align: center; margin-bottom: 36px; }
.pipeline-title { font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 800; letter-spacing: -0.04em; color: white; margin-bottom: 10px; }
.pipeline-subtitle { font-size: 14px; color: var(--zinc-400); max-width: 480px; margin: 0 auto; line-height: 1.6; }
.pipeline-topbar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 28px;
}
.pipe-active { display: flex; align-items: center; gap: 7px; font-size: 12px; color: rgba(255,255,255,0.45); }
.pipe-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; flex-shrink: 0; animation: pulse-dot 2.5s ease-in-out infinite; }
@keyframes pulse-dot { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); } 60% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } }
.pipe-meta { font-size: 12px; color: rgba(255,255,255,0.25); letter-spacing: 0.02em; }
.pipeline-main {
  display: grid; grid-template-columns: 210px 1fr 256px;
  height: 440px; gap: 0; position: relative;
}
.pipeline-nodes { display: flex; flex-direction: column; padding-right: 8px; }
.pdf-card {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.09);
  border-radius: 8px; padding: 11px 13px; margin-bottom: 14px;
  display: flex; align-items: flex-start; gap: 10px;
}
.pdf-icon {
  width: 32px; height: 36px; border-radius: 5px;
  background: rgba(153,0,0,0.25); border: 1px solid rgba(153,0,0,0.4);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.pdf-info { flex: 1; min-width: 0; }
.pdf-title { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pdf-meta { font-size: 9px; color: rgba(255,255,255,0.3); margin-top: 2px; }
.pdf-badge { font-size: 9px; font-weight: 600; color: #3b82f6; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.25); padding: 2px 7px; border-radius: 999px; display: inline-block; margin-top: 6px; }
.pnode { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.pnode:last-child { border-bottom: none; }
.pnode-num { font-size: 9px; font-weight: 500; color: rgba(255,255,255,0.18); width: 14px; text-align: right; flex-shrink: 0; }
.pnode-icon {
  width: 34px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.pnode-text { flex: 1; min-width: 0; }
.pnode-title { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.80); }
.pnode-sub { font-size: 9px; color: rgba(255,255,255,0.28); margin-top: 1px; }
.pipeline-curves { position: relative; overflow: hidden; }
.pipeline-curves svg { width: 100%; height: 100%; display: block; }
.scatter-dot { position: absolute; border-radius: 50%; pointer-events: none; animation: scatter-pulse 3s ease-in-out infinite; }
@keyframes scatter-pulse { 0%,100% { opacity: 0.18; } 50% { opacity: 0.55; } }
.pipeline-output {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px; display: flex; flex-direction: column; overflow: hidden;
}
.output-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.07);
}
.output-title { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.75); }
.output-live { display: flex; align-items: center; gap: 5px; font-size: 10px; color: rgba(255,255,255,0.3); }
.output-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #10b981; animation: pulse-dot 2.5s ease-in-out infinite; }
.output-field { padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); flex: 1; display: flex; flex-direction: column; justify-content: center; }
.output-field:last-of-type { border-bottom: none; }
.field-name { font-size: 9px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 4px; }
.field-value { font-size: 11px; color: rgba(255,255,255,0.50); line-height: 1.4; }
.output-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 9px 14px; border-top: 1px solid rgba(255,255,255,0.07);
}
.output-format { font-size: 9px; color: rgba(255,255,255,0.22); letter-spacing: 0.05em; }
.output-complete { font-size: 10px; color: #10b981; font-weight: 600; }
.pipeline-stats {
  display: grid; grid-template-columns: repeat(4,1fr);
  border-top: 1px solid rgba(255,255,255,0.06); margin-top: 32px;
}
.pstat { text-align: center; padding: 26px 16px; border-right: 1px solid rgba(255,255,255,0.05); }
.pstat:last-child { border-right: none; }
.pstat-num { font-size: clamp(2rem, 3.5vw, 2.8rem); font-weight: 900; letter-spacing: -0.04em; line-height: 1; margin-bottom: 6px; }
.pstat-label { font-size: 11px; color: rgba(255,255,255,0.28); }

.decomp-card { background: white; border: 1px solid var(--zinc-200); border-radius: 10px; overflow: hidden; transition: transform 0.4s var(--spring), box-shadow 0.4s ease; cursor: default; }
.decomp-card:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(0,0,0,0.08); }
.decomp-tree { padding: 14px 16px; }
.tree-root { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; margin-bottom: 10px; padding: 8px 10px; background: var(--blue-tint); border: 1px solid rgba(1,31,91,0.15); border-radius: 7px; color: var(--blue); }
.tree-root-icon { width: 6px; height: 6px; border-radius: 1px; background: var(--blue); flex-shrink: 0; }
.tree-stage { margin-left: 12px; margin-bottom: 8px; }
.tree-stage-row { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; margin-bottom: 5px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--zinc-100); opacity: 0; transform: translateX(-8px); transition: opacity 0.3s ease, transform 0.3s ease; }
.tree-stage-row.visible { opacity: 1; transform: translateX(0); }
.stage-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.stage-badge-parallel { font-size: 8px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--blue-tint); color: var(--blue); margin-left: auto; }
.stage-badge-seq { font-size: 8px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--zinc-100); color: var(--zinc-500); margin-left: auto; }
.tree-fields { margin-left: 28px; display: flex; flex-direction: column; gap: 3px; }
.tree-field { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--zinc-500); padding: 3px 8px; border-radius: 4px; border-left: 2px solid var(--zinc-200); opacity: 0; transform: translateX(-6px); transition: opacity 0.25s ease, transform 0.25s ease; }
.tree-field.visible { opacity: 1; transform: translateX(0); }
.field-type { font-size: 8px; font-weight: 600; padding: 1px 5px; border-radius: 3px; background: var(--zinc-100); color: var(--zinc-400); margin-left: auto; }

.features-section { max-width: 1200px; margin: 0 auto; padding: 64px 24px; }
.section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--red); display: block; margin-bottom: 6px; }
.feature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; padding: 56px 0; border-bottom: 1px solid var(--zinc-100); }
.feature-block:last-child { border-bottom: none; }
.feature-block.reverse { direction: rtl; }
.feature-block.reverse > * { direction: ltr; }
.feature-label { font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--zinc-400); display: block; margin-bottom: 12px; }
.feature-h2 { font-size: clamp(1.5rem, 2.5vw, 2rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; margin-bottom: 16px; }
.feature-h2 em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.feature-body { font-size: 14px; color: var(--zinc-500); line-height: 1.7; margin-bottom: 18px; }
.feature-list { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.feature-list li { font-size: 13px; color: var(--zinc-700); display: flex; align-items: center; gap: 8px; }
.feature-list li::before { content: '\\2713'; color: var(--blue); font-weight: 700; font-size: 11px; }
.feature-card { background: white; border: 1px solid var(--zinc-200); border-radius: 10px; overflow: hidden; transition: transform 0.4s var(--spring), box-shadow 0.4s ease; cursor: default; }
.feature-card:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(0,0,0,0.08); }
.card-tab-bar { padding: 9px 12px; background: var(--zinc-50); border-bottom: 1px solid var(--zinc-200); display: flex; align-items: center; gap: 8px; }
.card-tab-label { font-size: 10px; font-weight: 600; color: var(--zinc-500); }
.card-tab-sub { font-size: 9px; color: var(--zinc-400); }
.card-content { padding: 14px; }
.pipeline-step { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 7px; background: var(--zinc-50); margin-bottom: 5px; }
.step-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--zinc-300); flex-shrink: 0; }
.step-dot.running { background: var(--red); }
.step-dot.done { background: var(--blue); }
.step-name { font-size: 10px; font-weight: 500; flex: 1; }
.step-badge { font-size: 8px; font-weight: 600; padding: 2px 7px; border-radius: 999px; }
.step-badge.waiting { background: var(--zinc-100); color: var(--zinc-500); }
.step-badge.running { background: var(--red-tint); color: var(--red); }
.step-badge.done { background: var(--blue-tint); color: var(--blue); }
.match-display { text-align: center; padding: 18px 0; }
.match-number { font-size: 2.8rem; font-weight: 900; letter-spacing: -0.04em; color: var(--blue); }
.match-label { font-size: 10px; color: var(--zinc-400); text-transform: uppercase; letter-spacing: 0.1em; }
.comparison-table { display: flex; flex-direction: column; gap: 3px; }
.comp-row { display: grid; grid-template-columns: 84px 1fr 1fr 18px; gap: 5px; align-items: center; font-size: 9px; padding: 4px 7px; background: var(--zinc-50); border-radius: 5px; }
.comp-field { font-weight: 600; color: var(--zinc-700); }
.comp-val { color: var(--zinc-500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.comp-match { text-align: center; }
.code-block { background: #0f172a; padding: 12px; min-height: 160px; overflow: auto; }
.code-block pre { font-family: \'Fira Code\', \'Consolas\', monospace; font-size: 10px; line-height: 1.6; color: #94a3b8; white-space: pre; }

.consensus-demo { display: flex; flex-direction: column; gap: 10px; }
.consensus-meter { display: flex; align-items: center; gap: 10px; }
.consensus-meter-bar { flex: 1; height: 6px; background: var(--zinc-100); border-radius: 3px; overflow: hidden; }
.consensus-meter-fill { height: 100%; background: linear-gradient(90deg, var(--blue), var(--red)); border-radius: 3px; transition: width 1.5s ease-out; }
.consensus-meter-label { font-size: 10px; font-weight: 700; color: var(--zinc-500); white-space: nowrap; min-width: 65px; text-align: right; }
.consensus-rows { display: flex; flex-direction: column; gap: 2px; }
.consensus-header-row { display: grid; grid-template-columns: 72px 1fr 1fr 1fr 48px; gap: 4px; padding: 3px 7px; }
.consensus-header-row span { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--zinc-400); }
.consensus-row { display: grid; grid-template-columns: 72px 1fr 1fr 1fr 48px; gap: 4px; align-items: center; font-size: 9px; padding: 5px 7px; background: var(--zinc-50); border-radius: 5px; opacity: 0; transform: translateY(6px); }
.consensus-row.show { opacity: 1; transform: translateY(0); transition: opacity 0.4s ease, transform 0.4s ease; }
.consensus-col-field { font-weight: 600; color: var(--zinc-700); }
.consensus-col-src { color: var(--zinc-500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.consensus-col-status { font-size: 8px; font-weight: 700; text-align: center; border-radius: 3px; padding: 1px 4px; }
.consensus-agreed { background: rgba(59,130,246,0.1); color: var(--blue); }
.consensus-conflict { background: rgba(244,63,94,0.1); color: var(--red); }

.beta-tag { font-size: 8px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: rgba(244,63,94,0.1); color: #f43f5e; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-left: 6px; }

.grid-section { padding: 72px 24px; background: var(--zinc-50); border-top: 1px solid var(--zinc-200); }
.grid-header { text-align: center; margin-bottom: 48px; }
.grid-h2 { font-size: clamp(1.6rem, 2.8vw, 2.2rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; margin-bottom: 10px; }
.grid-h2 em { font-family: var(--font-serif); font-style: italic; font-weight: 400; color: var(--red); }
.grid-sub { font-size: 14px; color: var(--zinc-500); max-width: 440px; margin: 0 auto; }
.feature-grid { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid-card { background: white; border: 1px solid var(--zinc-200); border-radius: 10px; padding: 22px; position: relative; transition: border-color 0.2s, box-shadow 0.25s; }
.grid-card:hover { border-color: var(--zinc-300); box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
.grid-card:nth-child(odd) { border-top: 2px solid var(--blue); }
.grid-card:nth-child(even) { border-top: 2px solid var(--red); }
.card-num { position: absolute; top: 18px; right: 18px; font-size: 10px; font-weight: 700; color: var(--zinc-300); }
.card-icon { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--zinc-200); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; background: white; }
.card-title { font-size: 14px; font-weight: 700; margin-bottom: 7px; }
.card-body { font-size: 12px; color: var(--zinc-500); line-height: 1.6; margin-bottom: 14px; }
.card-tag { font-size: 9px; font-family: \'Fira Code\', monospace; font-weight: 500; color: var(--zinc-400); background: var(--zinc-50); border: 1px solid var(--zinc-200); padding: 2px 7px; border-radius: 4px; }

.cta-section { padding: 104px 24px; background: white; text-align: center; border-top: 1px solid var(--zinc-200); }
.cta-heading { font-size: clamp(2.2rem, 4.5vw, 3.6rem); font-weight: 800; letter-spacing: -0.05em; line-height: 1.05; margin-bottom: 28px; }
.cta-heading em { font-family: var(--font-serif); font-style: italic; font-weight: 400; color: var(--red); }
footer { border-top: 1px solid var(--zinc-200); padding: 48px 24px 20px; background: var(--black); }
.footer-inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 44px; margin-bottom: 40px; }
.footer-brand { display: flex; flex-direction: column; gap: 10px; }
.footer-brand .logo { display: flex; align-items: center; gap: 8px; }
.footer-brand .wordmark { color: white; }
.footer-brand p { font-size: 12px; color: var(--zinc-500); max-width: 260px; line-height: 1.6; }
.footer-col h4 { font-size: 12px; font-weight: 700; margin-bottom: 12px; color: white; }
.footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.footer-col li a { font-size: 12px; color: var(--zinc-500); cursor: pointer; transition: color 0.2s; }
.footer-col li a:hover { color: white; }
.footer-bottom { max-width: 1080px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08); }
.footer-bottom p { font-size: 11px; color: var(--zinc-500); }
.footer-legal { display: flex; gap: 14px; }
.footer-legal a { font-size: 11px; color: var(--zinc-500); cursor: pointer; }
.footer-legal a:hover { color: white; }

.reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.55s ease, transform 0.55s var(--spring); }
.reveal.visible { opacity: 1; transform: translateY(0); }

@media (max-width: 900px) {
  .pipeline-main { grid-template-columns: 1fr; height: auto; }
  .pipeline-curves { display: none; }
  .pipeline-output { display: none; }
  .pipeline-nodes { flex-direction: row; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .pnode { flex: 0 0 calc(50% - 4px); }
  .pdf-card { width: 100%; }
}
@media (max-width: 768px) {
  .hero { grid-template-columns: 1fr; min-height: auto; padding-top: 72px; }
  .hero-right { display: none; }
  .stats-inner { grid-template-columns: repeat(2,1fr); }
  .stat-item { border-right: none; border-bottom: 1px solid var(--zinc-200); padding: 20px; }
  .stat-item:nth-child(odd) { border-right: 1px solid var(--zinc-200); }
  .feature-block { grid-template-columns: 1fr; gap: 28px; }
  .feature-block.reverse { direction: ltr; }
  .feature-grid { grid-template-columns: 1fr; }
  .footer-inner { grid-template-columns: 1fr; gap: 28px; }
  .nav-links { display: none; }
  .pipeline-stats { grid-template-columns: repeat(2,1fr); }
}
      ` }} />

      {/* NAV */}
      <nav id="main-nav">
        <div className="nav-inner">
          <Link className="logo" href="/">
            <Logo size={30} className="text-[#011F5B]" />
            <span className="wordmark">eviStreams</span>
          </Link>
          <div className="nav-cta">
            <a href="/login" className="btn-ghost">Sign in</a>
            <a href="/register" className="btn-pill">Get started</a>
          </div>
        </div>
      </nav>

      {/* MESH BLOBS */}
      <div className="mesh-wrap" aria-hidden="true">
        <div className="mesh-blob mesh-blob-1" />
        <div className="mesh-blob mesh-blob-2" />
        <div className="mesh-blob mesh-blob-3" />
      </div>

      {/* HERO */}
      <section className="hero">
        <div className="hero-left">
          <h1 className="hero-h1">The <em>fastest</em> way to<br/>extract data from<br/>research papers.</h1>
          <p className="hero-sub">eviStreams automatically generates AI pipelines that extract structured data from hundreds of research papers — in minutes, not months.</p>
          <a href="/register" className="btn-cta">Start extracting →</a>
        </div>
        <div className="hero-right">
          <div className="ambient-glow"></div>
          <div className="product-window">
            <div className="browser-chrome">
              <span className="dot dot-red"></span>
              <span className="dot dot-yellow"></span>
              <span className="dot dot-green"></span>
            </div>
            <div className="tab-bar">
              <span className="tab">Documents</span>
              <span className="tab">Forms</span>
              <span className="tab active">Extractions</span>
              <span className="tab">Results</span>
              <span className="tab">Compare</span>
            </div>
            <div className="app-layout">
              <div className="sidebar">
                <div className="sidebar-item">Dashboard</div>
                <div className="sidebar-item">Projects</div>
                <div className="sidebar-item">Documents</div>
                <div className="sidebar-item">Forms</div>
                <div className="sidebar-item active">Extractions</div>
                <div className="sidebar-item">Results</div>
                <div className="sidebar-item">Compare</div>
                <div className="sidebar-item">Chat</div>
                <div className="sidebar-item">Jobs</div>
              </div>
              <div className="main-content">
                <div className="stat-cards">
                  <div className="stat-card"><div className="stat-value">48</div><div className="stat-label">Total</div></div>
                  <div className="stat-card"><div className="stat-value" style={{ color: 'var(--blue)' }}>31</div><div className="stat-label">Done</div></div>
                  <div className="stat-card"><div className="stat-value" style={{ color: 'var(--zinc-700)' }}>3</div><div className="stat-label">Running</div></div>
                  <div className="stat-card"><div className="stat-value" style={{ color: 'var(--red)' }}>0</div><div className="stat-label">Failed</div></div>
                </div>
                <div className="extraction-rows">
                  <div className="extraction-row">
                    <div className="row-info"><div className="row-title">Smith et al. 2024</div><div className="row-sub">NEJM</div></div>
                    <div className="row-progress"><div className="progress-bar-bg"><div className="progress-bar done-bar" id="pb1" style={{ width: '100%' }}></div></div></div>
                    <span className="badge badge-done" id="badge-pb1">Done</span>
                  </div>
                  <div className="extraction-row">
                    <div className="row-info"><div className="row-title">Johnson et al. 2023</div><div className="row-sub">Lancet</div></div>
                    <div className="row-progress"><div className="progress-bar-bg"><div className="progress-bar blue" id="pb2" style={{ width: '44%' }}></div></div></div>
                    <span className="badge badge-running" id="badge-pb2">Running</span>
                  </div>
                  <div className="extraction-row">
                    <div className="row-info"><div className="row-title">Williams et al. 2024</div><div className="row-sub">JAMA</div></div>
                    <div className="row-progress"><div className="progress-bar-bg"><div className="progress-bar blue" id="pb3" style={{ width: '0%' }}></div></div></div>
                    <span className="badge badge-running" id="badge-pb3">Running</span>
                  </div>
                  <div className="extraction-row">
                    <div className="row-info"><div className="row-title">Chen et al. 2023</div><div className="row-sub">BMJ</div></div>
                    <div className="row-progress"><div className="progress-bar-bg"><div className="progress-bar" id="pb4" style={{ width: '0%' }}></div></div></div>
                    <span className="badge badge-queued" id="badge-pb4">Queued</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* UPENN BAND */}
      <section className="upenn-band reveal" id="research">
        <span className="partner-label">Built by</span>
        <Image src={UPENN_LOGO} alt="University of Pennsylvania" width={146} height={48} className="upenn-logo-img" priority />
      </section>

      {/* STATS BAND */}
      <section className="stats-band reveal">
        <div className="stats-inner">
          <div className="stat-item"><div className="stat-num" style={{ color: 'var(--red)' }}>4</div><div className="stat-lbl">Processing stages</div></div>
          <div className="stat-item"><div className="stat-num" style={{ color: 'var(--blue)' }}>12</div><div className="stat-lbl">Fields extracted</div></div>
          <div className="stat-item"><div className="stat-num">&lt;1<span className="stat-unit">s</span></div><div className="stat-lbl">Avg. per paper</div></div>
          <div className="stat-item"><div className="stat-num" style={{ color: 'var(--blue)' }}>94<span className="stat-unit">%</span></div><div className="stat-lbl">Extraction accuracy</div></div>
        </div>
      </section>

      {/* PIPELINE SECTION */}
      <section className="pipeline-section" id="how-it-works">
        <div className="scatter-dot" style={{ top: '10%', left: '17%', width: '5px', height: '5px', background: '#f43f5e', animationDelay: '0s' }}></div>
        <div className="scatter-dot" style={{ top: '7%', left: '63%', width: '4px', height: '4px', background: '#3b82f6', animationDelay: '0.7s' }}></div>
        <div className="scatter-dot" style={{ top: '18%', left: '82%', width: '3px', height: '3px', background: '#f59e0b', animationDelay: '1.2s' }}></div>
        <div className="scatter-dot" style={{ top: '55%', left: '8%', width: '4px', height: '4px', background: '#f43f5e', animationDelay: '0.3s' }}></div>
        <div className="scatter-dot" style={{ top: '70%', left: '50%', width: '3px', height: '3px', background: '#10b981', animationDelay: '0.9s' }}></div>
        <div className="scatter-dot" style={{ top: '80%', left: '78%', width: '5px', height: '5px', background: '#3b82f6', animationDelay: '1.5s' }}></div>
        <div className="scatter-dot" style={{ top: '40%', left: '91%', width: '3px', height: '3px', background: '#f43f5e', animationDelay: '0.5s' }}></div>
        <div className="scatter-dot" style={{ top: '25%', left: '35%', width: '4px', height: '4px', background: '#f59e0b', animationDelay: '2s' }}></div>
        <div className="pipeline-inner">
          <div className="pipeline-header">
            <h2 className="pipeline-title">How it works</h2>
            <p className="pipeline-subtitle">From initial form creation to structured output — automated end-to-end.</p>
          </div>
          <div className="pipeline-topbar">
            <div className="pipe-active">
              <span className="pipe-dot"></span>
              Pipeline active
            </div>
            <div className="pipe-meta">4 stages &nbsp;·&nbsp; 12 fields &nbsp;·&nbsp; &lt;1s / paper</div>
          </div>
          <div className="pipeline-main">
            <div className="pipeline-nodes">
              <div className="pdf-card">
                <div className="pdf-icon">
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="#990000" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 1 h7 l3 3 v11 H2 Z"/><path d="M9 1 v3 h3"/>
                    <line x1="4" y1="7" x2="10" y2="7"/><line x1="4" y1="10" x2="8" y2="10"/>
                  </svg>
                </div>
                <div className="pdf-info">
                  <div className="pdf-title">research_paper.pdf</div>
                  <div className="pdf-meta">12 pages · 8.4 MB</div>
                  <div className="pdf-badge">· reading</div>
                </div>
              </div>
              <div className="pnode">
                <span className="pnode-num">01</span>
                <div className="pnode-icon" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.25)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="1" width="12" height="14" rx="1.5"/>
                    <line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="8" y2="11"/>
                  </svg>
                </div>
                <div className="pnode-text">
                  <div className="pnode-title">Form Definition</div>
                  <div className="pnode-sub">fields → tasks</div>
                </div>
              </div>
              <div className="pnode">
                <span className="pnode-num">02</span>
                <div className="pnode-icon" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="3" r="2"/><circle cx="3" cy="13" r="2"/><circle cx="13" cy="13" r="2"/>
                    <line x1="8" y1="5" x2="8" y2="9"/><line x1="8" y1="9" x2="3" y2="11"/><line x1="8" y1="9" x2="13" y2="11"/>
                  </svg>
                </div>
                <div className="pnode-text">
                  <div className="pnode-title">Decomposition</div>
                  <div className="pnode-sub">atomic stages</div>
                </div>
              </div>
              <div className="pnode">
                <span className="pnode-num">03</span>
                <div className="pnode-icon" style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="4,5 2,8 4,11"/><polyline points="12,5 14,8 12,11"/>
                    <line x1="9" y1="3" x2="7" y2="13"/>
                  </svg>
                </div>
                <div className="pnode-text">
                  <div className="pnode-title">Code Generation</div>
                  <div className="pnode-sub">signatures + modules</div>
                </div>
              </div>
              <div className="pnode">
                <span className="pnode-num">04</span>
                <div className="pnode-icon" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="8,2 14,5 14,11 8,14 2,11 2,5"/>
                    <polyline points="5,8 7,10 11,6"/>
                  </svg>
                </div>
                <div className="pnode-text">
                  <div className="pnode-title">Pipeline Execution</div>
                  <div className="pnode-sub">parallel extract</div>
                </div>
              </div>
            </div>
            <div className="pipeline-curves">
              <svg viewBox="0 0 580 440" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <path id="lp1" d="M0,118 C140,118 200,215 290,220 C380,225 420,82 580,82"/>
                  <path id="lp2" d="M0,200 C140,200 215,218 290,220 C365,220 420,168 580,168"/>
                  <path id="lp3" d="M0,282 C140,282 210,222 290,220 C370,218 420,256 580,256"/>
                  <path id="lp4" d="M0,362 C140,362 200,228 290,220 C380,216 420,346 580,346"/>
                </defs>
                <use href="#lp1" fill="none" stroke="#f43f5e" strokeWidth="1.2" opacity={0.25}/>
                <use href="#lp2" fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity={0.25}/>
                <use href="#lp3" fill="none" stroke="#3b82f6" strokeWidth="1.2" opacity={0.25}/>
                <use href="#lp4" fill="none" stroke="#10b981" strokeWidth="1.2" opacity={0.25}/>
                <g opacity={0.55}>
                  <circle cx="268" cy="195" r="2" fill="#f43f5e"/>
                  <circle cx="310" cy="188" r="1.5" fill="#f59e0b"/>
                  <circle cx="328" cy="215" r="2" fill="#3b82f6"/>
                  <circle cx="305" cy="248" r="1.5" fill="#10b981"/>
                  <circle cx="272" cy="240" r="2" fill="#f43f5e" opacity={0.6}/>
                  <circle cx="345" cy="200" r="1.5" fill="#f59e0b" opacity={0.6}/>
                  <circle cx="258" cy="222" r="1.5" fill="#3b82f6" opacity={0.5}/>
                  <circle cx="318" cy="238" r="1.5" fill="#10b981" opacity={0.5}/>
                  <circle cx="290" cy="200" r="1" fill="white" opacity={0.4}/>
                  <circle cx="296" cy="230" r="1" fill="white" opacity={0.3}/>
                </g>
                <g stroke="rgba(255,255,255,0.1)" strokeWidth="0.7" fill="none">
                  <line x1="268" y1="195" x2="310" y2="188"/>
                  <line x1="310" y1="188" x2="328" y2="215"/>
                  <line x1="328" y1="215" x2="305" y2="248"/>
                  <line x1="305" y1="248" x2="272" y2="240"/>
                  <line x1="272" y1="240" x2="268" y2="195"/>
                  <line x1="268" y1="195" x2="258" y2="222"/>
                  <line x1="328" y1="215" x2="345" y2="200"/>
                  <line x1="310" y1="188" x2="290" y2="200"/>
                  <line x1="305" y1="248" x2="296" y2="230"/>
                </g>
                <circle r="3.5" fill="#f43f5e">
                  <animateMotion dur="2.8s" repeatCount="indefinite" begin="0s"><mpath href="#lp1"/></animateMotion>
                </circle>
                <circle r="2" fill="#f43f5e" opacity={0.5}>
                  <animateMotion dur="2.8s" repeatCount="indefinite" begin="0.9s"><mpath href="#lp1"/></animateMotion>
                </circle>
                <circle r="3.5" fill="#f59e0b">
                  <animateMotion dur="3.2s" repeatCount="indefinite" begin="0.4s"><mpath href="#lp2"/></animateMotion>
                </circle>
                <circle r="2" fill="#f59e0b" opacity={0.5}>
                  <animateMotion dur="3.2s" repeatCount="indefinite" begin="1.3s"><mpath href="#lp2"/></animateMotion>
                </circle>
                <circle r="3.5" fill="#3b82f6">
                  <animateMotion dur="3s" repeatCount="indefinite" begin="0.7s"><mpath href="#lp3"/></animateMotion>
                </circle>
                <circle r="2" fill="#3b82f6" opacity={0.5}>
                  <animateMotion dur="3s" repeatCount="indefinite" begin="1.6s"><mpath href="#lp3"/></animateMotion>
                </circle>
                <circle r="3.5" fill="#10b981">
                  <animateMotion dur="3.4s" repeatCount="indefinite" begin="1s"><mpath href="#lp4"/></animateMotion>
                </circle>
                <circle r="2" fill="#10b981" opacity={0.5}>
                  <animateMotion dur="3.4s" repeatCount="indefinite" begin="2s"><mpath href="#lp4"/></animateMotion>
                </circle>
              </svg>
            </div>
            <div className="pipeline-output">
              <div className="output-header">
                <span className="output-title">Extracted Data</span>
                <span className="output-live"><span className="output-live-dot"></span>live</span>
              </div>
              <div className="output-field">
                <div className="field-name" style={{ color: '#f43f5e' }}>Patient Population</div>
                <div className="field-value">Adults 18–65, dental implant patients, n=312</div>
              </div>
              <div className="output-field">
                <div className="field-name" style={{ color: '#f59e0b' }}>Study Design</div>
                <div className="field-value">Randomized controlled trial, 12-month follow-up</div>
              </div>
              <div className="output-field">
                <div className="field-name" style={{ color: '#3b82f6' }}>Intervention</div>
                <div className="field-value">Single-stage vs two-stage implant placement</div>
              </div>
              <div className="output-field">
                <div className="field-name" style={{ color: '#10b981' }}>Outcomes</div>
                <div className="field-value">Implant survival rate, marginal bone loss (mm)</div>
              </div>
              <div className="output-footer">
                <span className="output-format">JSON · CSV</span>
                <span className="output-complete">&#10003; Complete</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE BLOCKS */}
      <section className="features-section" id="features">

        {/* Block 01 — Decomposition */}
        <div className="feature-block reveal">
          <div className="feature-text">
            <span className="feature-label">AI DECOMPOSITION</span>
            <h2 className="feature-h2">AI that writes its own<br/><em>extraction code.</em></h2>
            <p className="feature-body">Define your form once. eviStreams&apos;s AI decomposes it into atomic extraction tasks, generates DSPy signatures and modules, then assembles a staged pipeline — automatically.</p>
            <ul className="feature-list">
              <li>Cognitive decomposition of form fields</li>
              <li>Auto-generated DSPy signatures</li>
              <li>Multi-stage pipeline assembly</li>
            </ul>
          </div>
          <div className="feature-visual">
            <div className="decomp-card" style={{ borderTop: '2px solid var(--red)' }}>
              <div className="card-tab-bar">
                <span className="card-tab-label">Decomposition</span>
                <span className="card-tab-sub">Patient RCT Form · 3 stages</span>
              </div>
              <div className="decomp-tree" id="decomp-tree">
                <div className="tree-root">
                  <div className="tree-root-icon"></div>
                  Patient RCT Extraction Form
                </div>
                <div className="tree-stage">
                  <div className="tree-stage-row" id="ts1">
                    <div className="stage-dot" style={{ background: 'var(--red)' }}></div>
                    <span>Stage 1 — Extract Population</span>
                    <span className="stage-badge-parallel">parallel</span>
                  </div>
                  <div className="tree-fields">
                    <div className="tree-field" id="tf1a"><span>sample_size</span><span className="field-type">numeric</span></div>
                    <div className="tree-field" id="tf1b"><span>age_range</span><span className="field-type">text</span></div>
                  </div>
                </div>
                <div className="tree-stage">
                  <div className="tree-stage-row" id="ts2">
                    <div className="stage-dot" style={{ background: 'var(--blue)' }}></div>
                    <span>Stage 2 — Extract Intervention</span>
                    <span className="stage-badge-parallel">parallel</span>
                  </div>
                  <div className="tree-fields">
                    <div className="tree-field" id="tf2a"><span>treatment</span><span className="field-type">text</span></div>
                    <div className="tree-field" id="tf2b"><span>control_group</span><span className="field-type">text</span></div>
                  </div>
                </div>
                <div className="tree-stage">
                  <div className="tree-stage-row" id="ts3">
                    <div className="stage-dot" style={{ background: 'var(--zinc-500)' }}></div>
                    <span>Stage 3 — Extract Outcomes</span>
                    <span className="stage-badge-seq">sequential</span>
                  </div>
                  <div className="tree-fields">
                    <div className="tree-field" id="tf3a"><span>primary_outcome</span><span className="field-type">text</span></div>
                    <div className="tree-field" id="tf3b"><span>follow_up_months</span><span className="field-type">numeric</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Block 02 — Quality Control */}
        <div className="feature-block reverse reveal">
          <div className="feature-text">
            <span className="feature-label">QUALITY CONTROL</span>
            <h2 className="feature-h2"><em>AI vs Human.</em><br/>Field by field.</h2>
            <p className="feature-body">Every extracted field is compared against human annotation at the field level. Semantic matching catches paraphrasing. Exact matching flags discrepancies.</p>
            <ul className="feature-list">
              <li>Semantic field-level comparison</li>
              <li>94% average match rate</li>
              <li>Side-by-side diff viewer</li>
            </ul>
          </div>
          <div className="feature-visual">
            <div className="feature-card" style={{ borderTop: '2px solid var(--blue)' }}>
              <div className="card-tab-bar">
                <span className="card-tab-label">Comparison</span>
                <span className="card-tab-sub">Paper #14 · 12 fields</span>
              </div>
              <div className="card-content">
                <div className="match-display">
                  <div><span id="match-count" className="match-number">0</span><span className="match-number" style={{ fontSize: '1.4rem' }}>%</span></div>
                  <div className="match-label">Overall Match Score</div>
                </div>
                <div className="comparison-table">
                  <div className="comp-row">
                    <span className="comp-field">Sample size</span>
                    <span className="comp-val">124 patients</span>
                    <span className="comp-val">124 patients</span>
                    <span className="comp-match" style={{ color: 'var(--blue)' }}>&#10003;</span>
                  </div>
                  <div className="comp-row">
                    <span className="comp-field">Intervention</span>
                    <span className="comp-val">SDF treatment</span>
                    <span className="comp-val">SDF application</span>
                    <span className="comp-match" style={{ color: 'var(--zinc-400)' }}>~</span>
                  </div>
                  <div className="comp-row">
                    <span className="comp-field">Follow-up</span>
                    <span className="comp-val">12 months</span>
                    <span className="comp-val">12 months</span>
                    <span className="comp-match" style={{ color: 'var(--blue)' }}>&#10003;</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Block 03 — Export */}
        <div className="feature-block reveal">
          <div className="feature-text">
            <span className="feature-label">EXPORT</span>
            <h2 className="feature-h2">Structured data,<br/><em>source-grounded.</em></h2>
            <p className="feature-body">Every extracted value links back to the exact sentence in the paper that supports it. Export to JSON, CSV, or connect to your review management tool.</p>
            <ul className="feature-list">
              <li>Source text grounding per field</li>
              <li>JSON + CSV export</li>
              <li>Review management integration</li>
            </ul>
          </div>
          <div className="feature-visual">
            <div className="feature-card" style={{ borderTop: '2px solid var(--zinc-700)' }}>
              <div className="card-tab-bar">
                <span className="card-tab-label">paper_014_export.json</span>
              </div>
              <div className="card-content">
                <div className="code-block"><pre id="typewriter-code"></pre></div>
              </div>
            </div>
          </div>
        </div>

        {/* Block 04 — Consensus Adjudication */}
        <div className="feature-block reverse reveal">
          <div className="feature-text">
            <span className="feature-label">CONSENSUS ADJUDICATION</span>
            <h2 className="feature-h2">Three sources.<br/><em>One truth.</em></h2>
            <p className="feature-body">AI extraction meets dual human review. Compare AI, Reviewer 1, and Reviewer 2 side-by-side. Resolve disagreements field-by-field with majority suggestions and full audit trail.</p>
            <ul className="feature-list">
              <li>AI vs R1 vs R2 field-level comparison</li>
              <li>Auto-detect agreement &amp; conflicts</li>
              <li>Majority-vote suggestions</li>
              <li>Corpus-wide agreement dashboard</li>
            </ul>
          </div>
          <div className="feature-visual">
            <div className="feature-card" style={{ borderTop: '2px solid var(--blue)' }}>
              <div className="card-tab-bar">
                <span className="card-tab-label">Consensus</span>
                <span className="card-tab-sub">Paper #07 · 6 fields</span>
              </div>
              <div className="card-content">
                <div className="consensus-demo">
                  {/* Agreement meter */}
                  <div className="consensus-meter">
                    <div className="consensus-meter-bar">
                      <div className="consensus-meter-fill" id="consensus-fill" style={{ width: '0%' }}></div>
                    </div>
                    <span className="consensus-meter-label" id="consensus-pct">0% agreed</span>
                  </div>
                  {/* Source rows */}
                  <div className="consensus-rows">
                    <div className="consensus-header-row">
                      <span className="consensus-col-field">Field</span>
                      <span className="consensus-col-src" style={{ color: 'var(--red)' }}>AI</span>
                      <span className="consensus-col-src" style={{ color: 'var(--blue)' }}>R1</span>
                      <span className="consensus-col-src" style={{ color: 'var(--zinc-700)' }}>R2</span>
                      <span className="consensus-col-status">Status</span>
                    </div>
                    <div className="consensus-row" id="cr1">
                      <span className="consensus-col-field">Sample size</span>
                      <span className="consensus-col-src">312</span>
                      <span className="consensus-col-src">312</span>
                      <span className="consensus-col-src">312</span>
                      <span className="consensus-col-status consensus-agreed">Agreed</span>
                    </div>
                    <div className="consensus-row" id="cr2">
                      <span className="consensus-col-field">Follow-up</span>
                      <span className="consensus-col-src">12 mo</span>
                      <span className="consensus-col-src">12 mo</span>
                      <span className="consensus-col-src">12 mo</span>
                      <span className="consensus-col-status consensus-agreed">Agreed</span>
                    </div>
                    <div className="consensus-row" id="cr3">
                      <span className="consensus-col-field">Intervention</span>
                      <span className="consensus-col-src">SDF tx</span>
                      <span className="consensus-col-src">SDF app</span>
                      <span className="consensus-col-src">SDF tx</span>
                      <span className="consensus-col-status consensus-conflict">2:1</span>
                    </div>
                    <div className="consensus-row" id="cr4">
                      <span className="consensus-col-field">Blinding</span>
                      <span className="consensus-col-src">Single</span>
                      <span className="consensus-col-src">Double</span>
                      <span className="consensus-col-src">Single</span>
                      <span className="consensus-col-status consensus-conflict">2:1</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* FEATURE GRID */}
      <section className="grid-section">
        <div className="grid-header reveal">
          <h2 className="grid-h2">Built for <em>researchers.</em></h2>
          <p className="grid-sub">Every tool your systematic review team needs, in one platform.</p>
        </div>
        <div className="feature-grid">
          <div className="grid-card reveal">
            <span className="card-num">01</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2" y="1" width="12" height="14" rx="1.5"/>
                <line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="8" y2="11"/>
              </svg>
            </div>
            <h3 className="card-title">Custom Forms</h3>
            <p className="card-body">Build extraction forms with any field type — numeric, text, categorical, nested subforms.</p>
            <span className="card-tag">form-builder</span>
          </div>
          <div className="grid-card reveal">
            <span className="card-num">02</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="1" y="3" width="14" height="10" rx="1.5"/>
                <polyline points="4,7 7,10 12,5"/>
              </svg>
            </div>
            <h3 className="card-title">Live Logs</h3>
            <p className="card-body">Stream real-time extraction logs directly in the browser. Full visibility into every step.</p>
            <span className="card-tag">websocket</span>
          </div>
          <div className="grid-card reveal">
            <span className="card-num">03</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 10c0 .552-.448 1-1 1H4l-3 3V3c0-.552.448-1 1-1h11c.552 0 1 .448 1 1v7z"/>
              </svg>
            </div>
            <h3 className="card-title">AI Chat <span className="beta-tag">Beta</span></h3>
            <p className="card-body">Ask questions about any paper directly. Responses grounded in extracted data.</p>
            <span className="card-tag">rag · grounded</span>
          </div>
          <div className="grid-card reveal">
            <span className="card-num">04</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 1 L8 8"/><polyline points="5,5 8,8 11,5"/>
                <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/>
              </svg>
            </div>
            <h3 className="card-title">Audit Trail</h3>
            <p className="card-body">Full provenance tracking. Every field links to its source sentence and confidence score.</p>
            <span className="card-tag">provenance</span>
          </div>
          <div className="grid-card reveal">
            <span className="card-num">05</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="5" r="3"/>
                <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6"/>
              </svg>
            </div>
            <h3 className="card-title">Consensus Review</h3>
            <p className="card-body">Compare AI, R1, and R2 side-by-side. Resolve conflicts with majority-vote suggestions.</p>
            <span className="card-tag">adjudication · consensus</span>
          </div>
          <div className="grid-card reveal">
            <span className="card-num">06</span>
            <div className="card-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="1" y="1" width="14" height="10" rx="1.5"/>
                <line x1="4" y1="14" x2="12" y2="14"/>
                <line x1="8" y1="11" x2="8" y2="14"/>
              </svg>
            </div>
            <h3 className="card-title">Structured Export</h3>
            <p className="card-body">Download as JSON or CSV. Field-level metadata and source text included in every export.</p>
            <span className="card-tag">json · csv</span>
          </div>
        </div>
      </section>

      {/* QUOTE BAND */}
      <section className="quote-band">
        <p className="quote-text">&quot;Cut extraction time by 80%.<br/>Without cutting corners.&quot;</p>
      </section>

      {/* FINAL CTA */}
      <section className="cta-section reveal">
        <h2 className="cta-heading">Try eviStreams <em>now.</em></h2>
        <a href="/register" className="btn-cta">Get started →</a>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-inner">
          <div className="footer-col footer-brand">
            <Link className="logo" href="/">
              <Logo size={22} className="text-white" />
              <span className="wordmark">eviStreams</span>
            </Link>
            <p>AI-powered systematic review extraction for medical research teams.</p>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <ul>
              <li><a href="#">How it works</a></li>
              <li><a href="#">Security</a></li>
              <li><a href="#">Changelog</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <ul>
              <li><a href="#">About</a></li>
              <li><a href="#">Penn Dental Medicine</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2026 eviStreams</p>
          <div className="footer-legal">
            <a href="#">Privacy</a> &nbsp;&middot;&nbsp; <a href="#">Terms</a> &nbsp;&middot;&nbsp; <a href="#">Security</a>
          </div>
        </div>
      </footer>
    </>
  );
}
