'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const HIW_STYLES = `
:root {
  --zinc-50: #fafafa; --zinc-100: #f4f4f5; --zinc-200: #e4e4e7;
  --zinc-300: #d4d4d8; --zinc-400: #a1a1aa; --zinc-500: #71717a;
  --zinc-700: #3f3f46; --zinc-900: #18181b; --black: #0a0a0a;
  --blue: #011F5B; --red: #990000;
  --blue-mid: #1e3a8a; --blue-tint: #e8edf5; --red-tint: #f5e8e8;
  --green: #16a34a; --green-tint: #f0fdf4;
  --amber: #d97706; --amber-tint: #fffbeb;
  --font-sans: 'Inter', sans-serif;
  --font-serif: 'Crimson Pro', Georgia, serif;
}

html, body { background: white !important; color: #0a0a0a !important; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; line-height: 1.6; }
a { text-decoration: none; color: inherit; }

/* ─── LAYOUT ─────────────────────────────── */
.hiw-section    { max-width: 1100px; margin: 0 auto; padding: 80px 24px; }
.hiw-section-sm { max-width: 680px;  margin: 0 auto; padding: 72px 24px; }
.hiw-divider    { border: none; border-top: 1px solid var(--zinc-100); margin: 0; }

/* ─── HERO ───────────────────────────────── */
.hiw-hero { text-align: center; padding: 80px 24px 64px; max-width: 760px; margin: 0 auto; }
.hiw-hero-label { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--red); display: block; margin-bottom: 16px; }
.hiw-hero-title { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; margin-bottom: 20px; color: var(--black); }
.hiw-hero-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.hiw-hero-sub { font-size: 17px; color: var(--zinc-500); line-height: 1.75; max-width: 560px; margin: 0 auto 32px; }
.hiw-hero-steps { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.hiw-hero-step-pill { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--zinc-500); padding: 6px 14px; border: 1px solid var(--zinc-200); border-radius: 999px; }
.hiw-hero-step-pill span { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: var(--blue); color: white; font-size: 10px; font-weight: 700; align-items: center; justify-content: center; }
.hiw-hero-sep { color: var(--zinc-300); font-size: 18px; }

/* ─── PROBLEM BAND (dark) ─────────────────── */
.hiw-problem {
  background: var(--black); padding: 80px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.hiw-problem-inner { max-width: 900px; margin: 0 auto; text-align: center; }
.hiw-problem-label { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--red); display: block; margin-bottom: 16px; opacity: 0.8; }
.hiw-problem-title { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; color: white; margin-bottom: 24px; }
.hiw-problem-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; color: rgba(255,255,255,0.7); }
.hiw-problem-sub { font-size: 15px; color: rgba(255,255,255,0.45); line-height: 1.8; max-width: 600px; margin: 0 auto 48px; }
.hiw-counter-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.hiw-counter-num { font-size: clamp(4rem, 10vw, 7rem); font-weight: 900; letter-spacing: -0.06em; line-height: 1; color: white; font-variant-numeric: tabular-nums; }
.hiw-counter-label { font-size: 13px; color: rgba(255,255,255,0.3); letter-spacing: 0.06em; text-transform: uppercase; }
.hiw-counter-sub { font-size: 12px; color: rgba(255,255,255,0.2); margin-top: 4px; }

/* ─── STEP SECTIONS ──────────────────────── */
.hiw-step-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.hiw-step-grid.reverse { direction: rtl; }
.hiw-step-grid.reverse > * { direction: ltr; }
.hiw-step-num { font-size: clamp(5rem, 12vw, 8rem); font-weight: 900; letter-spacing: -0.06em; line-height: 1; color: var(--zinc-100); margin-bottom: -16px; display: block; }
.hiw-step-title { font-size: clamp(1.5rem, 2.8vw, 2rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1.2; color: var(--black); margin-bottom: 14px; }
.hiw-step-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.hiw-step-body { font-size: 15px; color: var(--zinc-500); line-height: 1.8; margin-bottom: 16px; }
.hiw-step-note { font-size: 13px; color: var(--zinc-400); line-height: 1.7; padding: 12px 16px; background: var(--zinc-50); border-left: 2px solid var(--zinc-200); border-radius: 0 6px 6px 0; }
.hiw-step-stat { display: inline-flex; gap: 6px; align-items: baseline; margin-top: 20px; padding: 12px 18px; background: var(--blue-tint); border-radius: 8px; }
.hiw-step-stat-num { font-size: 20px; font-weight: 900; letter-spacing: -0.04em; color: var(--blue); }
.hiw-step-stat-label { font-size: 12px; color: var(--blue-mid); font-weight: 500; }

/* ─── MOCK CARDS ─────────────────────────── */
.hiw-mock { background: white; border: 1px solid var(--zinc-200); border-radius: 12px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.06); }
.hiw-mock-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--zinc-50); border-bottom: 1px solid var(--zinc-100); }
.hiw-mock-bar-title { font-size: 11px; font-weight: 700; color: var(--zinc-700); display: flex; align-items: center; gap: 6px; }
.hiw-mock-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); }
.hiw-mock-badge { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: var(--blue-tint); color: var(--blue); }
.hiw-mock-body { padding: 16px; }

/* ─── FORM BUILDER MOCK ──────────────────── */
.hf-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border: 1px solid var(--zinc-200); border-radius: 8px;
  margin-bottom: 8px; background: white;
  opacity: 0; transform: translateY(8px);
}
.hf-row:last-of-type { margin-bottom: 0; }
.hf-row-label { font-size: 12px; font-weight: 600; color: var(--zinc-700); }
.hf-row-type { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: var(--zinc-100); color: var(--zinc-500); text-transform: uppercase; letter-spacing: 0.06em; }
.hf-btn {
  margin-top: 14px; width: 100%; padding: 10px; border-radius: 8px;
  background: var(--blue); color: white; font-size: 12px; font-weight: 700;
  text-align: center; opacity: 0;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.hf-btn-arrow { display: inline-block; }

/* Form animation — 10s total loop */
@keyframes hfRow1 {
  0%, 8%   { opacity: 0; transform: translateY(8px); }
  14%, 68% { opacity: 1; transform: none; }
  74%, 100%{ opacity: 0; transform: translateY(-4px); }
}
@keyframes hfRow2 {
  0%, 18%  { opacity: 0; transform: translateY(8px); }
  24%, 68% { opacity: 1; transform: none; }
  74%, 100%{ opacity: 0; transform: translateY(-4px); }
}
@keyframes hfRow3 {
  0%, 28%  { opacity: 0; transform: translateY(8px); }
  34%, 68% { opacity: 1; transform: none; }
  74%, 100%{ opacity: 0; transform: translateY(-4px); }
}
@keyframes hfBtn {
  0%, 38%  { opacity: 0; }
  44%, 68% { opacity: 1; }
  74%, 100%{ opacity: 0; }
}
@keyframes hfArrow {
  0%, 44%  { transform: translateX(0); }
  52%      { transform: translateX(4px); }
  60%, 100%{ transform: translateX(0); }
}
.hf-row.r1 { animation: hfRow1 10s infinite ease; }
.hf-row.r2 { animation: hfRow2 10s infinite ease; }
.hf-row.r3 { animation: hfRow3 10s infinite ease; }
.hf-btn    { animation: hfBtn  10s infinite ease; }
.hf-btn-arrow { animation: hfArrow 10s infinite ease; }

/* ─── UNDER-THE-HOOD BAND ─────────────────── */
.hiw-hood {
  background: var(--zinc-50); padding: 72px 24px;
  border-top: 1px solid var(--zinc-100);
  border-bottom: 1px solid var(--zinc-100);
}
.hiw-hood-inner { max-width: 900px; margin: 0 auto; }
.hiw-hood-label { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--zinc-400); display: block; text-align: center; margin-bottom: 10px; }
.hiw-hood-title { font-size: clamp(1.1rem, 2vw, 1.4rem); font-weight: 700; letter-spacing: -0.03em; color: var(--zinc-700); text-align: center; margin-bottom: 40px; }
.hiw-hood-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.hiw-hood-card { background: white; border: 1px solid var(--zinc-200); border-radius: 12px; padding: 28px; }
.hiw-hood-card-tag { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; margin-bottom: 14px; }
.hiw-hood-card-tag.decomp { background: var(--blue-tint); color: var(--blue); }
.hiw-hood-card-tag.codegen { background: var(--green-tint); color: var(--green); }
.hiw-hood-card-heading { font-size: 15px; font-weight: 800; color: var(--black); margin-bottom: 10px; letter-spacing: -0.02em; }
.hiw-hood-card-body { font-size: 13px; color: var(--zinc-500); line-height: 1.8; }
.hiw-hood-card-example { margin-top: 14px; padding: 10px 14px; background: var(--zinc-50); border: 1px solid var(--zinc-200); border-radius: 8px; font-size: 12px; color: var(--zinc-600); line-height: 1.7; }
.hiw-hood-card-example strong { color: var(--zinc-700); font-weight: 700; }
.hiw-hood-flow { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
.hiw-hood-flow-pill { font-size: 12px; font-weight: 600; padding: 6px 16px; border-radius: 999px; background: white; border: 1px solid var(--zinc-200); color: var(--zinc-600); }
.hiw-hood-flow-arrow { color: var(--zinc-300); font-size: 16px; }
.hiw-hood-note { text-align: center; margin-top: 24px; font-size: 13px; color: var(--zinc-400); }

/* ─── DECOMPOSITION ANIMATION (hd) — 13s loop ── */
/* Shows the real pipeline plan building: stages → tasks with parallel/sequential badges */
.hd-mock { margin-top: 14px; background: white; border: 1px solid var(--zinc-200); border-radius: 10px; overflow: hidden; }
.hd-analyzing {
  padding: 10px 12px; border-bottom: 1px solid var(--zinc-100);
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--zinc-400); opacity: 0;
}
.hd-pipeline { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
/* Stage block */
.hd-stage { opacity: 0; transform: translateY(6px); }
.hd-stage-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.hd-stage-num { font-size: 9px; font-weight: 700; color: var(--zinc-400); letter-spacing: 0.06em; text-transform: uppercase; }
.hd-stage-badge {
  font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.hd-stage-badge.parallel   { background: rgba(139,92,246,0.1); color: #8b5cf6; border: 1px solid rgba(139,92,246,0.2); }
.hd-stage-badge.sequential { background: rgba(245,158,11,0.1);  color: #d97706; border: 1px solid rgba(245,158,11,0.2); }
/* Task rows */
.hd-task {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; border-radius: 6px; background: var(--zinc-50);
  border: 1px solid var(--zinc-100); margin-bottom: 4px;
  opacity: 0; transform: translateY(4px);
}
.hd-task:last-child { margin-bottom: 0; }
.hd-task-name { font-size: 11px; font-weight: 600; color: var(--zinc-700); font-family: 'Fira Code','Consolas',monospace; }
.hd-task-fields { font-size: 10px; color: var(--zinc-400); }
.hd-task-dep { font-size: 9px; color: var(--amber); font-weight: 600; background: rgba(245,158,11,0.08); padding: 1px 6px; border-radius: 4px; }
/* Connector between stages */
.hd-connector { display: flex; justify-content: center; padding: 2px 0; opacity: 0; }
.hd-connector-line { width: 1px; height: 12px; background: var(--zinc-200); }
/* Bottom stat */
.hd-stat {
  padding: 8px 12px; border-top: 1px solid var(--zinc-100);
  font-size: 10px; font-weight: 700; color: var(--green); letter-spacing: 0.06em;
  text-transform: uppercase; opacity: 0;
}

/* 13s loop timing:
   0-8%   = analyzing label
   8-30%  = Stage 1 + tasks appear
   30-42% = connector + Stage 2 + task appear
   42-68% = stat appears, hold
   68-80% = fade out
   80-100% = dark gap before reset */
@keyframes hdAnalyzing { 0%,3%  { opacity:0 } 7%,72% { opacity:1 } 78%,100% { opacity:0 } }
@keyframes hdStage1    { 0%,6%  { opacity:0; transform:translateY(6px) } 12%,72% { opacity:1; transform:none } 78%,100% { opacity:0 } }
@keyframes hdTask1     { 0%,12% { opacity:0; transform:translateY(4px) } 18%,72% { opacity:1; transform:none } 78%,100% { opacity:0 } }
@keyframes hdTask2     { 0%,18% { opacity:0; transform:translateY(4px) } 24%,72% { opacity:1; transform:none } 78%,100% { opacity:0 } }
@keyframes hdConn      { 0%,24% { opacity:0 } 30%,72% { opacity:1 } 78%,100% { opacity:0 } }
@keyframes hdStage2    { 0%,28% { opacity:0; transform:translateY(6px) } 34%,72% { opacity:1; transform:none } 78%,100% { opacity:0 } }
@keyframes hdTask3     { 0%,34% { opacity:0; transform:translateY(4px) } 40%,72% { opacity:1; transform:none } 78%,100% { opacity:0 } }
@keyframes hdStat      { 0%,40% { opacity:0 } 46%,68% { opacity:1 } 74%,100% { opacity:0 } }

.hd-analyzing             { animation: hdAnalyzing 13s infinite ease; }
.hd-stage.s1              { animation: hdStage1    13s infinite ease; }
.hd-stage.s1 .hd-task.t1 { animation: hdTask1     13s infinite ease; }
.hd-stage.s1 .hd-task.t2 { animation: hdTask2     13s infinite ease; }
.hd-connector             { animation: hdConn      13s infinite ease; }
.hd-stage.s2              { animation: hdStage2    13s infinite ease; }
.hd-stage.s2 .hd-task.t1 { animation: hdTask3     13s infinite ease; }
.hd-stat                  { animation: hdStat      13s infinite ease; }

/* ─── CODE GENERATION ANIMATION (hg) — 13s loop ── */
/* Shows real dspy.Signature class lines being written — what actually gets generated */
.hg-mock {
  margin-top: 14px; background: #0d1117; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px; overflow: hidden;
}
.hg-mock-bar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.07);
}
.hg-mock-bar-dot   { width: 6px; height: 6px; border-radius: 50%; background: #10b981; animation: pulseDot 2s ease-in-out infinite; }
.hg-mock-bar-label { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; letter-spacing: 0.06em; opacity: 0; }
.hg-body { padding: 10px 14px 6px; display: flex; flex-direction: column; gap: 1px; }
.hg-line {
  font-family: 'Fira Code','Consolas',monospace; font-size: 11px; line-height: 1.6;
  opacity: 0; transform: translateX(-8px); white-space: nowrap;
}
.hg-spacer { height: 6px; opacity: 0; }
.hg-cls    { color: #ff7b72; }       /* class keyword — red */
.hg-cname  { color: #d2a8ff; }       /* class name — purple */
.hg-paren  { color: rgba(255,255,255,0.5); }
.hg-field  { color: rgba(255,255,255,0.45); padding-left: 14px; }
.hg-fname  { color: #79c0ff; }       /* field name — blue */
.hg-ftype  { color: #a5d6ff; }       /* InputField/OutputField */
.hg-comment-line { color: rgba(255,255,255,0.2); font-size: 10px; padding-left: 14px; }
.hg-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 6px 0; opacity: 0; }
.hg-success {
  margin: 8px 14px 12px; padding: 8px 12px; border-radius: 6px;
  background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);
  font-size: 11px; font-weight: 700; color: #10b981;
  display: flex; align-items: center; gap: 8px;
  opacity: 0; transform: translateY(4px);
}
.hg-success-time { margin-left: auto; font-size: 10px; opacity: 0.6; font-weight: 400; }

/* 13s loop — staggered opacity+translateX per line */
@keyframes hgBarLbl  { 0%,3%  { opacity:0 } 8%,78%  { opacity:1 } 84%,100% { opacity:0 } }
@keyframes hgSep     { 0%,54% { opacity:0 } 58%,78% { opacity:1 } 84%,100% { opacity:0 } }
@keyframes hgOk      { 0%,62% { opacity:0; transform:translateY(4px) } 68%,76% { opacity:1; transform:none } 82%,100% { opacity:0; transform:translateY(4px) } }

/* Line timings (13s loop, appear in sequence) */
@keyframes hgLine1  { 0%,6%  { opacity:0;transform:translateX(-8px) } 11%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine2  { 0%,13% { opacity:0;transform:translateX(-8px) } 18%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine3  { 0%,20% { opacity:0;transform:translateX(-8px) } 25%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine4  { 0%,27% { opacity:0;transform:translateX(-8px) } 32%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine5  { 0%,34% { opacity:0;transform:translateX(-8px) } 39%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine6  { 0%,41% { opacity:0;transform:translateX(-8px) } 46%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }
@keyframes hgLine7  { 0%,48% { opacity:0;transform:translateX(-8px) } 53%,78% { opacity:1;transform:none } 84%,100% { opacity:0 } }

.hg-mock-bar-label    { animation: hgBarLbl 13s infinite ease; }
.hg-line.gl1          { animation: hgLine1  13s infinite ease; }
.hg-line.gl2          { animation: hgLine2  13s infinite ease; }
.hg-line.gl3          { animation: hgLine3  13s infinite ease; }
.hg-line.gl4          { animation: hgLine4  13s infinite ease; }
.hg-line.gl5          { animation: hgLine5  13s infinite ease; }
.hg-line.gl6          { animation: hgLine6  13s infinite ease; }
.hg-line.gl7          { animation: hgLine7  13s infinite ease; }
.hg-sep               { animation: hgSep    13s infinite ease; }
.hg-success           { animation: hgOk     13s infinite ease; }

/* ─── PIPELINE LOG MOCK ──────────────────── */
.hl-mock { background: #08090f; border-color: rgba(255,255,255,0.1); }
.hl-mock .hiw-mock-bar { background: rgba(255,255,255,0.04); border-bottom-color: rgba(255,255,255,0.07); }
.hl-mock .hiw-mock-bar-title { color: rgba(255,255,255,0.7); }
.hl-mock .hiw-mock-dot { background: #10b981; animation: pulseDot 2s ease-in-out infinite; }
@keyframes pulseDot {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
  50%      { box-shadow: 0 0 0 5px rgba(16,185,129,0); }
}
.hl-progress-wrap { padding: 0 16px; margin-bottom: 14px; }
.hl-progress-label { font-size: 10px; color: rgba(255,255,255,0.3); margin-bottom: 6px; font-variant-numeric: tabular-nums; }
.hl-bar-track { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
.hl-bar-fill  { height: 100%; background: var(--blue); border-radius: 2px; width: 0; }
.hl-logs { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 6px; }
.hl-line {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; font-family: 'Fira Code', 'Consolas', monospace;
  padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.03);
  opacity: 0; transform: translateY(6px);
}
.hl-line-name { color: rgba(255,255,255,0.6); }
.hl-line-status-ok  { color: #10b981; font-weight: 700; font-size: 10px; }
.hl-line-status-run { color: #f59e0b; font-weight: 700; font-size: 10px; }
.hl-line-time { color: rgba(255,255,255,0.25); font-size: 10px; }
.hl-success {
  margin: 0 16px 16px; padding: 10px 14px; border-radius: 8px;
  background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.25);
  font-size: 12px; font-weight: 700; color: #10b981; text-align: center;
  opacity: 0; transform: translateY(-8px);
}

/* Pipeline animation — 12s total loop */
@keyframes hlBar    { 0%,4% { width:0 } 46%,64% { width:100% } 70%,100% { width:0 } }
@keyframes hlLine1  { 0%, 8%  { opacity:0; transform:translateY(6px); } 14%,62% { opacity:1; transform:none; } 68%,100%{ opacity:0; } }
@keyframes hlLine2  { 0%,18%  { opacity:0; transform:translateY(6px); } 24%,62% { opacity:1; transform:none; } 68%,100%{ opacity:0; } }
@keyframes hlLine3  { 0%,28%  { opacity:0; transform:translateY(6px); } 34%,62% { opacity:1; transform:none; } 68%,100%{ opacity:0; } }
@keyframes hlLine4  { 0%,38%  { opacity:0; transform:translateY(6px); } 44%,62% { opacity:1; transform:none; } 68%,100%{ opacity:0; } }
@keyframes hlRunPulse { 0%,44%,62%,100% { opacity:1; } 53% { opacity:0.3; } }
@keyframes hlSuccess  { 0%,62% { opacity:0; transform:translateY(-8px); } 68%,85% { opacity:1; transform:none; } 92%,100%{ opacity:0; } }
.hl-bar-fill { animation: hlBar     12s infinite linear; }
.hl-line.l1  { animation: hlLine1   12s infinite ease; }
.hl-line.l2  { animation: hlLine2   12s infinite ease; }
.hl-line.l3  { animation: hlLine3   12s infinite ease; }
.hl-line.l4  { animation: hlLine4   12s infinite ease; }
.hl-line.l4 .hl-line-status-run { animation: hlRunPulse 12s infinite ease; }
.hl-success  { animation: hlSuccess 12s infinite ease; }

/* ─── RESULTS TABLE BAND ─────────────────── */
.hiw-results {
  background: white; padding: 80px 24px;
  border-top: 1px solid var(--zinc-100);
  border-bottom: 1px solid var(--zinc-100);
}
.hiw-results-inner { max-width: 1000px; margin: 0 auto; }
.hiw-results-label { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--green); display: block; margin-bottom: 10px; }
.hiw-results-title { font-size: clamp(1.5rem, 3vw, 2.2rem); font-weight: 800; letter-spacing: -0.04em; color: var(--black); margin-bottom: 10px; }
.hiw-results-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.hiw-results-sub { font-size: 15px; color: var(--zinc-500); line-height: 1.75; max-width: 600px; margin-bottom: 40px; }
.hiw-results-table-wrap { overflow: hidden; border: 1px solid var(--zinc-200); border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.04); }
.hiw-results-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.hiw-results-table thead th {
  background: var(--zinc-50); padding: 10px 14px; text-align: left;
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--zinc-400); border-bottom: 1px solid var(--zinc-200);
}
.hiw-results-table thead th:first-child { color: var(--zinc-500); }
.hiw-results-table tbody tr {
  border-bottom: 1px solid var(--zinc-100);
  opacity: 0; transform: translateY(6px);
}
.hiw-results-table tbody tr:last-child { border-bottom: none; }
.hiw-results-table tbody td { padding: 11px 14px; vertical-align: top; }
.hiw-results-table .rt-paper { font-size: 12px; font-weight: 600; color: var(--zinc-700); }
.hiw-results-table .rt-paper span { display: block; font-size: 10px; font-weight: 400; color: var(--zinc-400); margin-top: 1px; }
.hiw-results-table .rt-val { color: var(--zinc-600); }
.hiw-results-table .rt-badge {
  display: inline-flex; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
}
.hiw-results-table .rt-badge.ok { background: var(--green-tint); color: var(--green); }
.hiw-results-table .rt-badge.warn { background: var(--amber-tint); color: var(--amber); }

/* Table row animations — 9s loop */
@keyframes rtRow1 { 0%,6%  { opacity:0; transform:translateY(6px); } 13%,78% { opacity:1; transform:none; } 85%,100% { opacity:0; } }
@keyframes rtRow2 { 0%,18% { opacity:0; transform:translateY(6px); } 25%,78% { opacity:1; transform:none; } 85%,100% { opacity:0; } }
@keyframes rtRow3 { 0%,30% { opacity:0; transform:translateY(6px); } 37%,78% { opacity:1; transform:none; } 85%,100% { opacity:0; } }
@keyframes rtRow4 { 0%,42% { opacity:0; transform:translateY(6px); } 49%,78% { opacity:1; transform:none; } 85%,100% { opacity:0; } }
.hiw-results-table tbody tr.rr1 { animation: rtRow1 9s infinite ease; }
.hiw-results-table tbody tr.rr2 { animation: rtRow2 9s infinite ease; }
.hiw-results-table tbody tr.rr3 { animation: rtRow3 9s infinite ease; }
.hiw-results-table tbody tr.rr4 { animation: rtRow4 9s infinite ease; }

.hiw-results-callout {
  margin-top: 24px; padding: 16px 20px; background: var(--blue-tint);
  border: 1px solid rgba(1,31,91,0.12); border-radius: 10px;
  font-size: 14px; color: var(--blue-mid); line-height: 1.7;
}
.hiw-results-callout strong { font-weight: 700; color: var(--blue); }

/* ─── CONSENSUS MOCK ─────────────────────── */
.hc-row { padding: 12px 0; border-bottom: 1px solid var(--zinc-100); }
.hc-row:last-of-type { border-bottom: none; }
.hc-row-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.hc-field-name { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--zinc-400); }
.hc-badge { font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 999px; opacity: 0; }
.hc-badge.agreed   { background: var(--green-tint); color: var(--green); }
.hc-badge.conflict { background: var(--amber-tint); color: var(--amber); }
.hc-value { font-size: 12px; color: var(--zinc-700); opacity: 0; }
.hc-conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; opacity: 0; }
.hc-conflict-cell { padding: 6px 8px; border-radius: 6px; font-size: 11px; }
.hc-conflict-cell.ai       { background: var(--zinc-50);    border: 1px solid var(--zinc-200); }
.hc-conflict-cell.reviewer { background: var(--amber-tint); border: 1px solid rgba(217,119,6,0.2); }
.hc-conflict-cell-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--zinc-400); margin-bottom: 2px; }
.hc-conflict-cell-val { font-size: 12px; color: var(--zinc-700); font-weight: 600; }
.hc-resolve-btn {
  margin-top: 8px; padding: 5px 12px; font-size: 11px; font-weight: 700;
  background: white; color: var(--blue); border: 1px solid var(--zinc-200);
  border-radius: 6px; display: inline-block; opacity: 0;
}
.hc-resolved-val { font-size: 12px; color: var(--zinc-700); font-weight: 600; opacity: 0; }
.hc-export-btn {
  margin-top: 14px; width: 100%; padding: 10px; border-radius: 8px;
  background: var(--blue); color: white; font-size: 12px; font-weight: 700;
  text-align: center; opacity: 0; transform: translateY(4px);
}

/* Consensus animation — 14s total loop */
@keyframes hcBadge1       { 0%,6%  { opacity:0; } 12%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcVal1         { 0%,6%  { opacity:0; } 12%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcBadge2       { 0%,14% { opacity:0; } 20%,46% { opacity:1; } 50%,100% { opacity:0; } }
@keyframes hcConflictGrid { 0%,14% { opacity:0; } 20%,38% { opacity:1; } 44%,100% { opacity:0; } }
@keyframes hcResolveBtn   { 0%,20% { opacity:0; } 26%,38% { opacity:1; } 44%,100% { opacity:0; } }
@keyframes hcBadge2Res    { 0%,44% { opacity:0; } 50%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcResolvedVal  { 0%,44% { opacity:0; } 50%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcBadge3       { 0%,22% { opacity:0; } 28%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcVal3         { 0%,22% { opacity:0; } 28%,75% { opacity:1; } 81%,100% { opacity:0; } }
@keyframes hcExport       { 0%,56% { opacity:0; transform:translateY(4px); } 62%,75% { opacity:1; transform:none; } 81%,100% { opacity:0; transform:translateY(4px); } }

.hc-row.r1 .hc-badge.agreed   { animation: hcBadge1       14s infinite ease; }
.hc-row.r1 .hc-value           { animation: hcVal1         14s infinite ease; }
.hc-row.r2 .hc-badge.conflict  { animation: hcBadge2       14s infinite ease; }
.hc-row.r2 .hc-conflict-grid   { animation: hcConflictGrid 14s infinite ease; }
.hc-row.r2 .hc-resolve-btn     { animation: hcResolveBtn   14s infinite ease; }
.hc-row.r2 .hc-badge.agreed    { animation: hcBadge2Res    14s infinite ease; }
.hc-row.r2 .hc-resolved-val    { animation: hcResolvedVal  14s infinite ease; }
.hc-row.r3 .hc-badge.agreed    { animation: hcBadge3       14s infinite ease; }
.hc-row.r3 .hc-value            { animation: hcVal3         14s infinite ease; }
.hc-export-btn                  { animation: hcExport       14s infinite ease; }

/* ─── COMPARISON BAND (dark) ─────────────── */
.hiw-compare {
  background: var(--black); padding: 80px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.hiw-compare-inner { max-width: 900px; margin: 0 auto; }
.hiw-compare-label { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--zinc-500); display: block; text-align: center; margin-bottom: 40px; }
.hiw-compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.hiw-compare-col { padding: 28px; border-radius: 12px; }
.hiw-compare-col.before { background: rgba(153,0,0,0.08); border: 1px solid rgba(153,0,0,0.2); }
.hiw-compare-col.after  { background: rgba(1,31,91,0.12);  border: 1px solid rgba(1,31,91,0.25); }
.hiw-compare-col-title { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 18px; }
.hiw-compare-col.before .hiw-compare-col-title { color: rgba(153,0,0,0.7); }
.hiw-compare-col.after  .hiw-compare-col-title { color: rgba(30,58,138,0.9); }
.hiw-compare-item { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; font-size: 14px; line-height: 1.6; }
.hiw-compare-item:last-child { margin-bottom: 0; }
.hiw-compare-mark { font-size: 11px; font-weight: 700; flex-shrink: 0; width: 16px; }
.hiw-compare-col.before .hiw-compare-mark { color: rgba(153,0,0,0.6); }
.hiw-compare-col.after  .hiw-compare-mark { color: rgba(1,31,91,0.8); }
.hiw-compare-col.before .hiw-compare-item-text { color: rgba(255,255,255,0.45); }
.hiw-compare-col.after  .hiw-compare-item-text { color: rgba(255,255,255,0.75); }

/* ─── FAQ ────────────────────────────────── */
.hiw-faq-title { font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.04em; color: var(--black); margin-bottom: 8px; }
.hiw-faq-sub   { font-size: 14px; color: var(--zinc-500); margin-bottom: 36px; }
.hiw-faq-item  { border-bottom: 1px solid var(--zinc-100); }
.hiw-faq-q {
  width: 100%; text-align: left; background: none; border: none; cursor: pointer;
  padding: 18px 0; display: flex; justify-content: space-between; align-items: center;
  font-size: 15px; font-weight: 600; color: var(--black); line-height: 1.5;
  gap: 16px; font-family: var(--font-sans);
}
.hiw-faq-q:hover { color: var(--blue); }
.hiw-faq-icon { font-size: 18px; color: var(--zinc-400); flex-shrink: 0; transition: transform 0.25s ease, color 0.25s ease; line-height: 1; display: block; }
.hiw-faq-icon.open { transform: rotate(45deg); color: var(--blue); }
.hiw-faq-a-wrap {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.35s ease;
}
.hiw-faq-a-wrap.open { max-height: 300px; }
.hiw-faq-a { font-size: 14px; color: var(--zinc-500); line-height: 1.8; padding-bottom: 18px; max-width: 600px; }
.hiw-faq-a a { color: var(--blue); border-bottom: 1px solid rgba(1,31,91,0.2); }
.hiw-faq-a a:hover { border-color: var(--blue); }

/* ─── CTA ────────────────────────────────── */
.hiw-cta { text-align: center; padding: 80px 24px 96px; border-top: 1px solid var(--zinc-100); }
.hiw-cta-title { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; letter-spacing: -0.04em; color: var(--black); margin-bottom: 14px; }
.hiw-cta-title em { font-family: var(--font-serif); font-style: italic; font-weight: 400; }
.hiw-cta-sub { font-size: 15px; color: var(--zinc-500); margin-bottom: 28px; }
.hiw-cta-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--blue); color: white; font-size: 15px; font-weight: 700; padding: 13px 28px; border-radius: 999px; transition: opacity 0.2s; }
.hiw-cta-btn:hover { opacity: 0.85; }
.hiw-cta-note { font-size: 12px; color: var(--zinc-400); margin-top: 16px; }

/* ─── RESPONSIVE ─────────────────────────── */
@media (max-width: 860px) {
  .hiw-step-grid   { grid-template-columns: 1fr; gap: 36px; }
  .hiw-step-grid.reverse { direction: ltr; }
  .hiw-compare-grid { grid-template-columns: 1fr; }
  .hiw-hero-steps   { flex-direction: column; gap: 4px; }
  .hiw-hero-sep     { display: none; }
  .hiw-hood-grid    { grid-template-columns: 1fr; }
}
`;

const FAQ_ITEMS = [
  {
    q: "I'm not a tech person. Can I really use this?",
    a: "Yes — if you can write an email and upload a file, you can use eviStreams. There is no coding involved, no technical setup, and nothing to install. Everything happens in your web browser.",
  },
  {
    q: "What if the computer finds the wrong answer?",
    a: "You review every answer before anything is saved. eviStreams shows you what it found, and you decide whether it's right. Think of the AI as a very fast first reader — you make the final call on every field.",
  },
  {
    q: "What kinds of research papers does it work with?",
    a: "Any PDF research paper. Medical studies, clinical trials, dental and oral health research, systematic reviews, public health studies — if it's a PDF, eviStreams can read it.",
  },
  {
    q: "How many papers can I process at once?",
    a: "As many as you need. eviStreams processes papers in parallel, so 10 papers takes roughly the same time as 200.",
  },
  {
    q: "Is my research data safe and private?",
    a: <><a href="/security">See our Security page</a> for full details. In short: your papers and data are stored securely and are never shared. Projects are isolated — no one outside your team can see your work.</>,
  },
  {
    q: "Do I need to install any software?",
    a: "No. eviStreams runs entirely in your web browser. Open the page, log in, and start working — nothing to download or install.",
  },
];

export default function HowItWorksPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [counter, setCounter] = useState(0);
  const counterRef = useRef<HTMLDivElement>(null);
  const counterStarted = useRef(false);

  useEffect(() => {
    const el = counterRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !counterStarted.current) {
          counterStarted.current = true;
          const target = 1600;
          const duration = 2200;
          const step = 16;
          const increment = Math.ceil(target / (duration / step));
          let current = 0;
          const iv = setInterval(() => {
            current = Math.min(current + increment, target);
            setCounter(current);
            if (current >= target) clearInterval(iv);
          }, step);
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HIW_STYLES }} />

      {/* ── HERO ── */}
      <div className="hiw-hero">
        <span className="hiw-hero-label">How it works</span>
        <h1 className="hiw-hero-title">
          Explained in<br /><em>plain English.</em>
        </h1>
        <p className="hiw-hero-sub">
          You upload research papers. You tell it what to look for.
          It reads every paper and gives you a clean spreadsheet. Here&rsquo;s exactly how.
        </p>
        <div className="hiw-hero-steps">
          <div className="hiw-hero-step-pill"><span>1</span> Build your form</div>
          <span className="hiw-hero-sep">→</span>
          <div className="hiw-hero-step-pill"><span>2</span> AI reads every paper</div>
          <span className="hiw-hero-sep">→</span>
          <div className="hiw-hero-step-pill"><span>3</span> Review and export</div>
        </div>
      </div>

      {/* ── THE PROBLEM ── */}
      <div className="hiw-problem">
        <div className="hiw-problem-inner">
          <span className="hiw-problem-label">The problem</span>
          <h2 className="hiw-problem-title">
            200 papers. 8 questions each.<br />
            <em>1,600 cells to fill by hand.</em>
          </h2>
          <p className="hiw-problem-sub">
            Most research teams do this manually — reading each paper, highlighting the relevant section,
            then copying the answer into a spreadsheet. One at a time. It takes weeks.
            It is exhausting. And it is full of small mistakes that compound into big ones.
          </p>
          <div ref={counterRef} className="hiw-counter-wrap">
            <div className="hiw-counter-num">{counter.toLocaleString()}</div>
            <div className="hiw-counter-label">data points entered by hand</div>
            <div className="hiw-counter-sub">in a typical 200-paper systematic review</div>
          </div>
        </div>
      </div>

      <hr className="hiw-divider" />

      {/* ── STEP 1 ── */}
      <div className="hiw-section">
        <div className="hiw-step-grid">
          <div>
            <span className="hiw-step-num">1</span>
            <h2 className="hiw-step-title">
              Tell it what questions<br />to <em>answer</em> from each paper
            </h2>
            <p className="hiw-step-body">
              Think of it like building a checklist. What do you need to know from every
              research paper? The age range of patients? What treatment was tested? Whether
              it worked? You just type your questions in — one by one. No coding.
              No technical knowledge required.
            </p>
            <p className="hiw-step-note">
              You can add as many questions as you need, in any structure, and change them at any time.
            </p>
          </div>
          <div className="hiw-mock">
            <div className="hiw-mock-bar">
              <div className="hiw-mock-bar-title">
                <span className="hiw-mock-dot" />
                Extraction Form
              </div>
              <span className="hiw-mock-badge">3 fields</span>
            </div>
            <div className="hiw-mock-body">
              <div className="hf-row r1">
                <span className="hf-row-label">Patient age group</span>
                <span className="hf-row-type">text</span>
              </div>
              <div className="hf-row r2">
                <span className="hf-row-label">Treatment received</span>
                <span className="hf-row-type">list</span>
              </div>
              <div className="hf-row r3">
                <span className="hf-row-label">Success rate</span>
                <span className="hf-row-type">number</span>
              </div>
              <div className="hf-btn">
                Generate AI Pipeline
                <span className="hf-btn-arrow">→</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── UNDER THE HOOD ── */}
      <div className="hiw-hood">
        <div className="hiw-hood-inner">
          <span className="hiw-hood-label">What happens in the background</span>
          <p className="hiw-hood-title">
            When you click &ldquo;Generate AI Pipeline,&rdquo; two things happen automatically
          </p>
          <div className="hiw-hood-grid">
            <div className="hiw-hood-card">
              <span className="hiw-hood-card-tag decomp">Step A &mdash; Decomposition</span>
              <div className="hiw-hood-card-heading">It organizes your questions into a work plan</div>
              <p className="hiw-hood-card-body">
                Your questions aren&rsquo;t all equal — some are independent, some need earlier
                answers first. The AI groups related questions into extraction tasks, then arranges
                them into stages. Independent tasks run in parallel (at the same time). Dependent
                tasks run sequentially (in order). The result is an optimized pipeline plan.
              </p>
              <div className="hd-mock">
                <div className="hd-analyzing">Analyzing your form&hellip;</div>
                <div className="hd-pipeline">
                  {/* Stage 1 */}
                  <div className="hd-stage s1">
                    <div className="hd-stage-header">
                      <span className="hd-stage-num">Stage 1</span>
                      <span className="hd-stage-badge parallel">Parallel</span>
                    </div>
                    <div className="hd-task t1">
                      <span className="hd-task-name">IdentifyStudyMetadata</span>
                      <span className="hd-task-fields">2 fields</span>
                    </div>
                    <div className="hd-task t2">
                      <span className="hd-task-name">ExtractInterventions</span>
                      <span className="hd-task-fields">2 fields</span>
                    </div>
                  </div>
                  {/* Connector */}
                  <div className="hd-connector"><div className="hd-connector-line" /></div>
                  {/* Stage 2 */}
                  <div className="hd-stage s2">
                    <div className="hd-stage-header">
                      <span className="hd-stage-num">Stage 2</span>
                      <span className="hd-stage-badge sequential">Sequential</span>
                    </div>
                    <div className="hd-task t1">
                      <span className="hd-task-name">ExtractOutcomes</span>
                      <span className="hd-task-dep">depends on Stage 1</span>
                    </div>
                  </div>
                </div>
                <div className="hd-stat">3 tasks &middot; 2 stages &middot; ready to generate code</div>
              </div>
            </div>
            <div className="hiw-hood-card">
              <span className="hiw-hood-card-tag codegen">Step B &mdash; Code Generation</span>
              <div className="hiw-hood-card-heading">It writes real code for every extraction task</div>
              <p className="hiw-hood-card-body">
                From the pipeline plan, eviStreams generates actual Python code — one specialist
                class per extraction task. Each class knows exactly what fields to find and how.
                When you upload a paper, these classes execute in stage order and merge their
                results. You never write a line of code.
              </p>
              <div className="hg-mock">
                <div className="hg-mock-bar">
                  <span className="hg-mock-bar-dot" />
                  <span className="hg-mock-bar-label">Generating code&hellip;</span>
                </div>
                <div className="hg-body">
                  {/* Class 1 — IdentifyStudyMetadata */}
                  <div className="hg-line gl1">
                    <span className="hg-cls">class </span>
                    <span className="hg-cname">IdentifyStudyMetadata</span>
                    <span className="hg-paren">(dspy.Signature):</span>
                  </div>
                  <div className="hg-line gl2">
                    <span className="hg-field"><span className="hg-fname">markdown_content</span> <span className="hg-ftype">= dspy.InputField()</span></span>
                  </div>
                  <div className="hg-line gl3">
                    <span className="hg-field"><span className="hg-fname">first_author</span>      <span className="hg-ftype">= dspy.OutputField()</span></span>
                  </div>
                  <div className="hg-line gl4">
                    <span className="hg-field"><span className="hg-fname">population_code</span>   <span className="hg-ftype">= dspy.OutputField()</span></span>
                  </div>
                  <div className="hg-sep" />
                  {/* Class 2 — ExtractOutcomes */}
                  <div className="hg-line gl5">
                    <span className="hg-cls">class </span>
                    <span className="hg-cname">ExtractOutcomes</span>
                    <span className="hg-paren">(dspy.Signature):</span>
                  </div>
                  <div className="hg-line gl6">
                    <span className="hg-field"><span className="hg-fname">success_rate</span>      <span className="hg-ftype">= dspy.OutputField()</span></span>
                  </div>
                  <div className="hg-line gl7">
                    <span className="hg-comment-line">&#47;&#47; depends on Stage 1 results</span>
                  </div>
                </div>
                <div className="hg-success">
                  &#10003; 3 classes generated &middot; code ready
                  <span className="hg-success-time">2.4s</span>
                </div>
              </div>
            </div>
          </div>
          <div className="hiw-hood-flow">
            <span className="hiw-hood-flow-pill">Your questions</span>
            <span className="hiw-hood-flow-arrow">→</span>
            <span className="hiw-hood-flow-pill">Decomposition</span>
            <span className="hiw-hood-flow-arrow">→</span>
            <span className="hiw-hood-flow-pill">Code Generation</span>
            <span className="hiw-hood-flow-arrow">→</span>
            <span className="hiw-hood-flow-pill">Custom pipeline ready</span>
          </div>
          <p className="hiw-hood-note">This all takes a few seconds. Then you upload your papers and it runs.</p>
        </div>
      </div>

      <hr className="hiw-divider" />

      {/* ── STEP 2 ── */}
      <div className="hiw-section">
        <div className="hiw-step-grid reverse">
          <div>
            <span className="hiw-step-num">2</span>
            <h2 className="hiw-step-title">
              Upload your papers.<br /><em>All of them.</em>
            </h2>
            <p className="hiw-step-body">
              Drag and drop your PDFs — ten papers or five hundred, it makes no difference.
              The custom pipeline eviStreams built for your questions now runs on every single
              paper automatically. You do not read a single word.
            </p>
            <div className="hiw-step-stat">
              <span className="hiw-step-stat-num">&lt; 1s</span>
              <span className="hiw-step-stat-label">per paper on average &mdash; versus 20 minutes by hand</span>
            </div>
          </div>
          <div className="hiw-mock hl-mock">
            <div className="hiw-mock-bar">
              <div className="hiw-mock-bar-title">
                <span className="hiw-mock-dot" />
                Pipeline running
              </div>
            </div>
            <div className="hiw-mock-body" style={{ paddingBottom: 0 }}>
              <div className="hl-progress-wrap">
                <div className="hl-progress-label" style={{ color: 'rgba(255,255,255,0.3)' }}>Processing papers&hellip;</div>
                <div className="hl-bar-track">
                  <div className="hl-bar-fill" />
                </div>
              </div>
              <div className="hl-logs">
                <div className="hl-line l1">
                  <span className="hl-line-name">paper_001.pdf</span>
                  <span className="hl-line-status-ok">complete</span>
                  <span className="hl-line-time">0.7s</span>
                </div>
                <div className="hl-line l2">
                  <span className="hl-line-name">paper_002.pdf</span>
                  <span className="hl-line-status-ok">complete</span>
                  <span className="hl-line-time">0.9s</span>
                </div>
                <div className="hl-line l3">
                  <span className="hl-line-name">paper_003.pdf</span>
                  <span className="hl-line-status-ok">complete</span>
                  <span className="hl-line-time">0.6s</span>
                </div>
                <div className="hl-line l4">
                  <span className="hl-line-name">paper_004.pdf</span>
                  <span className="hl-line-status-run">running&hellip;</span>
                  <span className="hl-line-time">&mdash;</span>
                </div>
              </div>
            </div>
            <div className="hl-success">All 127 papers complete</div>
          </div>
        </div>
      </div>

      {/* ── RESULTS TABLE (what was extracted) ── */}
      <div className="hiw-results">
        <div className="hiw-results-inner">
          <span className="hiw-results-label">What you get back</span>
          <h2 className="hiw-results-title">
            Here&rsquo;s what the computer <em>found</em>
          </h2>
          <p className="hiw-results-sub">
            Once the pipeline finishes, eviStreams shows you a table of everything it extracted —
            one row per paper, one column per question. Every cell has a value pulled directly from
            the source text. This is your raw data, ready to check.
          </p>
          <div className="hiw-results-table-wrap">
            <table className="hiw-results-table">
              <thead>
                <tr>
                  <th>Paper</th>
                  <th>Patient age group</th>
                  <th>Treatment received</th>
                  <th>Success rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="rr1">
                  <td><div className="rt-paper">Smith et al. 2021<span>J. Oral Implantology</span></div></td>
                  <td><span className="rt-val">Adults 45&ndash;65</span></td>
                  <td><span className="rt-val">Dental implant surgery</span></td>
                  <td><span className="rt-val">87%</span></td>
                  <td><span className="rt-badge ok">Extracted</span></td>
                </tr>
                <tr className="rr2">
                  <td><div className="rt-paper">Chen &amp; Liu 2020<span>Clin. Oral Res.</span></div></td>
                  <td><span className="rt-val">Seniors 60+</span></td>
                  <td><span className="rt-val">Antibiotic therapy</span></td>
                  <td><span className="rt-val">72%</span></td>
                  <td><span className="rt-badge ok">Extracted</span></td>
                </tr>
                <tr className="rr3">
                  <td><div className="rt-paper">Kumar et al. 2022<span>Int. J. Oral Sci.</span></div></td>
                  <td><span className="rt-val">Adults 30&ndash;50</span></td>
                  <td><span className="rt-val">Bone graft + implant</span></td>
                  <td><span className="rt-val">91%</span></td>
                  <td><span className="rt-badge ok">Extracted</span></td>
                </tr>
                <tr className="rr4">
                  <td><div className="rt-paper">Patel &amp; Wong 2019<span>Periodontology</span></div></td>
                  <td><span className="rt-val">Mixed 25&ndash;70</span></td>
                  <td><span className="rt-val">Medication only</span></td>
                  <td><span className="rt-val">Not reported</span></td>
                  <td><span className="rt-badge warn">Review needed</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="hiw-results-callout">
            <strong>Every cell is linked back to its source.</strong> Click any value and eviStreams
            shows you the exact sentence in the original paper it came from — so you can always
            verify the answer before you accept it.
          </div>
        </div>
      </div>

      <hr className="hiw-divider" />

      {/* ── STEP 3 ── */}
      <div className="hiw-section">
        <div className="hiw-step-grid">
          <div>
            <span className="hiw-step-num">3</span>
            <h2 className="hiw-step-title">
              Review what it found.<br /><em>Fix anything. Download.</em>
            </h2>
            <p className="hiw-step-body">
              You and your team go through each answer. Most will be exactly right.
              Some you&rsquo;ll want to adjust. When two reviewers disagree on an answer,
              eviStreams flags the conflict so you can resolve it together — then you
              download everything as a spreadsheet, ready for Excel or any research tool.
            </p>
            <p className="hiw-step-note">
              Nothing is saved until you approve it. You are always in control of the final data.
            </p>
          </div>
          <div className="hiw-mock">
            <div className="hiw-mock-bar">
              <div className="hiw-mock-bar-title">
                <span className="hiw-mock-dot" />
                Review Results
              </div>
              <span className="hiw-mock-badge">3 fields</span>
            </div>
            <div className="hiw-mock-body">
              <div className="hc-row r1">
                <div className="hc-row-header">
                  <span className="hc-field-name">Patient age group</span>
                  <span className="hc-badge agreed">Agreed</span>
                </div>
                <div className="hc-value">Adults 45&ndash;65, dental implant patients</div>
              </div>
              <div className="hc-row r2">
                <div className="hc-row-header">
                  <span className="hc-field-name">Treatment received</span>
                  <span className="hc-badge conflict">Conflict</span>
                  <span className="hc-badge agreed">Agreed</span>
                </div>
                <div className="hc-conflict-grid">
                  <div className="hc-conflict-cell ai">
                    <div className="hc-conflict-cell-label">AI found</div>
                    <div className="hc-conflict-cell-val">Surgery</div>
                  </div>
                  <div className="hc-conflict-cell reviewer">
                    <div className="hc-conflict-cell-label">Reviewer</div>
                    <div className="hc-conflict-cell-val">Medication</div>
                  </div>
                </div>
                <div className="hc-resolve-btn">Resolve &rarr;</div>
                <div className="hc-resolved-val">Surgery</div>
              </div>
              <div className="hc-row r3">
                <div className="hc-row-header">
                  <span className="hc-field-name">Success rate</span>
                  <span className="hc-badge agreed">Agreed</span>
                </div>
                <div className="hc-value">87% implant survival at 12 months</div>
              </div>
              <div className="hc-export-btn">Export as CSV &darr;</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── COMPARISON BAND ── */}
      <div className="hiw-compare">
        <div className="hiw-compare-inner">
          <span className="hiw-compare-label">The difference</span>
          <div className="hiw-compare-grid">
            <div className="hiw-compare-col before">
              <div className="hiw-compare-col-title">Before eviStreams</div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&times;</span>
                <span className="hiw-compare-item-text">20 minutes per paper, reading and copying by hand</span>
              </div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&times;</span>
                <span className="hiw-compare-item-text">Copy-paste errors that quietly corrupt your dataset</span>
              </div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&times;</span>
                <span className="hiw-compare-item-text">One researcher can process roughly 3 papers a day</span>
              </div>
            </div>
            <div className="hiw-compare-col after">
              <div className="hiw-compare-col-title">With eviStreams</div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&#10003;</span>
                <span className="hiw-compare-item-text">Under one second per paper, processed automatically</span>
              </div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&#10003;</span>
                <span className="hiw-compare-item-text">You review every answer before it touches your dataset</span>
              </div>
              <div className="hiw-compare-item">
                <span className="hiw-compare-mark">&#10003;</span>
                <span className="hiw-compare-item-text">Hundreds of papers processed while you sleep</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FAQ ── */}
      <div className="hiw-section-sm">
        <h2 className="hiw-faq-title">Still have questions?</h2>
        <p className="hiw-faq-sub">Plain answers to the things people ask most.</p>
        {FAQ_ITEMS.map((item, i) => (
          <div key={i} className="hiw-faq-item">
            <button
              className="hiw-faq-q"
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            >
              {item.q}
              <span className={`hiw-faq-icon${openFaq === i ? ' open' : ''}`}>+</span>
            </button>
            <div className={`hiw-faq-a-wrap${openFaq === i ? ' open' : ''}`}>
              <div className="hiw-faq-a">{item.a}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <div className="hiw-cta">
        <h2 className="hiw-cta-title">Ready to <em>try it?</em></h2>
        <p className="hiw-cta-sub">Takes about 5 minutes to get started.</p>
        <Link href="/register" className="hiw-cta-btn">
          Create a free account &rarr;
        </Link>
        <p className="hiw-cta-note">
          Used by researchers at Penn Dental Medicine, University of Pennsylvania.
        </p>
      </div>
    </>
  );
}
