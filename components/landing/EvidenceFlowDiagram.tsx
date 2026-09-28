'use client';

import { useEffect, useState } from 'react';
import styles from './landing.module.css';
import { EZ } from './motion';

/*
 * Diagrams §1 — Evidence flow. One extracted value (124) travels
 * Collect → Extract → Review → Assess → Synthesize, every 2.4s. Hovering a
 * stage jumps to it and pauses; leaving the diagram resumes. Reduced motion
 * renders every stage as complete with no token.
 */

const NAVY = '#011F5B';
const INK = '#0a0a0a';
const HAIR = '#d4d4d8';
const MUTE = '#8a8a8a';
const X = 150;
const YS = [30, 90, 150, 210, 270];
const STAGES: [string, string][] = [
  ['Collect & configure', 'PDF · RIS · DOI · PubMed · CT.gov'],
  ['Extract', 'AI-assisted, linked to the source'],
  ['Review', 'R1 and R2 agree · CR records 124'],
  ['Assess', 'RoB 2 · parallel-group RCTs'],
  ['Synthesize', 'pooled, or synthesized without pooling'],
];
const TOKEN_POS: [number, number][] = [[110, 20], [111, 90], [116, 168], [128, 208], [75, 288]];

const MONO: React.CSSProperties = { fontFamily: 'var(--font-landing-mono), "JetBrains Mono", monospace', fontSize: 10.5 };
const LBL: React.CSSProperties = { fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: 14, fontWeight: 600 };

const tr = (p: string, d?: number) => `${p} .6s ${EZ}${d ? ` ${d}s` : ''}`;

export function EvidenceFlowDiagram({ rm }: { rm: boolean }) {
  const [flowStep, setFlowStep] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (rm || paused) return;
    const t = setInterval(() => setFlowStep((s) => (s + 1) % 5), 2400);
    return () => clearInterval(t);
  }, [rm, paused]);

  const step = rm ? 4 : flowStep;
  const done = (i: number) => rm || i < step;
  const cur = (i: number) => i === step;
  const on = (i: number) => rm || i <= step;
  const tokenPos = TOKEN_POS[step];
  const tokenGone = step === 4;

  return (
    <svg
      viewBox="0 0 460 300"
      width="100%"
      role="img"
      aria-label="One extracted value moves through collect, extract, review, assess and synthesize"
      style={{ display: 'block', maxWidth: 460, overflow: 'visible' }}
      onMouseLeave={() => setPaused(false)}
    >
      <g className={styles.rise}>
        <line x1={X} y1={14} x2={X} y2={286} stroke={HAIR} strokeWidth={1} />
        <line
          x1={X}
          y1={14}
          x2={X}
          y2={286}
          stroke={NAVY}
          strokeWidth={1.5}
          style={{
            transform: `scaleY(${rm ? 1 : (YS[step] - 14) / 272})`,
            transformOrigin: `${X}px 14px`,
            transition: `transform .8s ${EZ}`,
          }}
        />
      </g>

      {YS.map((y, i) => (
        <g key={`row${i}`} className={styles.rise} style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
          <line x1={X - 8} y1={y} x2={X - 30} y2={y} stroke={on(i) ? NAVY : HAIR} strokeWidth={1} style={{ transition: tr('stroke') }} />
          <circle
            cx={X}
            cy={y}
            r={cur(i) ? 12 : 4}
            fill="rgba(1,31,91,0.08)"
            stroke="none"
            style={{ opacity: cur(i) && !rm ? 1 : 0, transition: `r .6s ${EZ}, opacity .6s` }}
          />
          <circle
            cx={X}
            cy={y}
            r={4.5}
            fill={done(i) ? NAVY : '#fff'}
            stroke={on(i) ? NAVY : HAIR}
            strokeWidth={1.5}
            style={{ transition: `${tr('fill')}, ${tr('stroke')}` }}
          />
          <text x={176} y={y - 2} style={{ ...LBL, fill: on(i) ? INK : MUTE, transition: tr('fill') }}>
            {STAGES[i][0]}
          </text>
          <text
            x={176}
            y={y + 14}
            style={{
              ...MONO,
              fill: '#52525b',
              opacity: cur(i) || rm ? 1 : 0,
              transform: cur(i) || rm ? 'translateX(0)' : 'translateX(-6px)',
              transition: `${tr('opacity')}, ${tr('transform')}`,
            }}
          >
            {STAGES[i][1]}
          </text>
        </g>
      ))}

      {/* travelling value token */}
      {!rm && (
        <g
          style={{
            transform: `translate(${tokenPos[0]}px, ${tokenPos[1]}px) scale(${tokenGone ? 0.4 : 1})`,
            opacity: tokenGone ? 0 : 1,
            transition: `transform .85s ${EZ}, opacity .5s ${EZ}${tokenGone ? ' .45s' : ''}`,
          }}
        >
          <g className={styles.fadeinLate}>
            <rect x={-13} y={-8} width={26} height={16} rx={8} fill={NAVY} style={{ filter: 'drop-shadow(0 2px 6px rgba(1,31,91,0.35))' }} />
            <text x={0} y={3.5} textAnchor="middle" style={{ ...MONO, fontSize: 8.5, fontWeight: 500, fill: '#fff' }}>
              124
            </text>
          </g>
        </g>
      )}

      {/* 0 · paper with highlight */}
      <g style={{ transform: cur(0) ? 'translateY(-2px)' : 'none', transition: tr('transform') }}>
        <rect x={54} y={8} width={30} height={40} rx={2} fill="#fff" stroke={on(0) ? INK : HAIR} strokeWidth={1.25} style={{ transition: tr('stroke') }} />
        <rect x={62} y={2} width={30} height={40} rx={2} fill="#fff" stroke={on(0) ? INK : HAIR} strokeWidth={1.25} style={{ transition: tr('stroke') }} />
        <rect
          x={66}
          y={17}
          width={22}
          height={6}
          rx={1}
          fill="rgba(1,31,91,0.16)"
          style={{
            opacity: on(0) ? 1 : 0,
            transform: on(0) ? 'scaleX(1)' : 'scaleX(0)',
            transformOrigin: '66px 20px',
            transition: `${tr('opacity')}, ${tr('transform')}`,
          }}
        />
        {[0, 1, 2, 3].map((k) => (
          <line
            key={k}
            x1={68}
            y1={12 + k * 7}
            x2={68 + [18, 20, 14, 19][k]}
            y2={12 + k * 7}
            stroke={k === 1 && on(0) ? NAVY : HAIR}
            strokeWidth={1.5}
            style={{ transition: tr('stroke') }}
          />
        ))}
      </g>

      {/* 1 · field row */}
      <g>
        <rect x={20} y={76} width={110} height={28} rx={4} fill={on(1) ? '#e8edf5' : '#fff'} stroke={on(1) ? INK : HAIR} strokeWidth={1.25} style={{ transition: `${tr('fill')}, ${tr('stroke')}` }} />
        <rect x={20} y={76} width={3} height={28} fill={NAVY} style={{ opacity: on(1) ? 1 : 0, transition: tr('opacity') }} />
        <text x={29} y={94} style={{ ...MONO, fontSize: 9.5, fill: on(1) ? INK : MUTE, transition: tr('fill') }}>
          sample_size
        </text>
        <rect x={98} y={82} width={26} height={16} rx={3} fill={on(1) ? NAVY : '#fff'} stroke={on(1) ? NAVY : HAIR} strokeWidth={1} style={{ transition: `${tr('fill')}, ${tr('stroke')}` }} />
        <text x={111} y={94} textAnchor="middle" style={{ ...MONO, fontSize: 8.5, fontWeight: 500, fill: on(1) ? '#fff' : HAIR, transition: tr('fill') }}>
          124
        </text>
      </g>

      {/* 2 · R1 R2 → CR */}
      <g>
        <path d="M58 149 Q58 168 75 168 M92 149 Q92 168 75 168" fill="none" stroke={on(2) ? NAVY : HAIR} strokeWidth={1} style={{ transition: tr('stroke', 0.3) }} />
        <circle cx={58} cy={144} r={11} fill={on(2) ? INK : '#fff'} stroke={on(2) ? INK : HAIR} strokeWidth={1.25} style={{ transition: `${tr('fill')}, ${tr('stroke')}` }} />
        <text x={58} y={147.5} textAnchor="middle" style={{ ...LBL, fontSize: 9, fill: on(2) ? '#fff' : MUTE, transition: tr('fill') }}>
          {on(2) ? '124' : 'R1'}
        </text>
        <circle cx={92} cy={144} r={11} fill="#fff" stroke={on(2) ? INK : HAIR} strokeWidth={1.25} style={{ transition: tr('stroke', 0.15) }} />
        <text x={92} y={147.5} textAnchor="middle" style={{ ...LBL, fontSize: 9, fill: on(2) ? INK : MUTE, transition: tr('fill', 0.15) }}>
          {on(2) ? '124' : 'R2'}
        </text>
        <circle cx={75} cy={168} r={8} fill={on(2) ? NAVY : '#fff'} stroke={on(2) ? NAVY : HAIR} strokeWidth={1.25} style={{ transition: `${tr('fill', 0.45)}, ${tr('stroke', 0.45)}` }} />
        <text x={75} y={171} textAnchor="middle" style={{ ...LBL, fontSize: 7.5, fill: on(2) ? '#fff' : MUTE, transition: tr('fill', 0.45) }}>
          CR
        </text>
      </g>

      {/* 3 · RoB pill */}
      <g>
        <rect x={36} y={197} width={78} height={22} rx={11} fill="#fff" stroke={on(3) ? INK : HAIR} strokeWidth={1.25} style={{ transition: tr('stroke') }} />
        {[52, 75, 98].map((cx, k) => (
          <circle
            key={k}
            cx={cx}
            cy={208}
            r={5.5}
            fill={on(3) && k < 2 ? NAVY : '#fff'}
            stroke={on(3) ? (k < 2 ? NAVY : INK) : HAIR}
            strokeWidth={1.25}
            style={{ transition: `${tr('fill', k * 0.18)}, ${tr('stroke', k * 0.18)}` }}
          />
        ))}
        {['D1', 'D2', 'D3'].map((t, k) => (
          <text key={t} x={52 + k * 23} y={230} textAnchor="middle" style={{ ...MONO, fontSize: 8, fill: on(3) ? MUTE : HAIR, transition: tr('fill') }}>
            {t}
          </text>
        ))}
      </g>

      {/* 4 · forest */}
      <g>
        <line x1={75} y1={246} x2={75} y2={296} stroke={HAIR} strokeWidth={1} strokeDasharray="2 3" />
        {([[52, 86, 254], [60, 96, 264], [64, 88, 274]] as const).map(([a, b, y], k) => (
          <g
            key={k}
            style={{
              transform: on(4) ? 'scaleX(1)' : 'scaleX(0)',
              transformOrigin: `${(a + b) / 2}px ${y}px`,
              transition: tr('transform', k * 0.15),
            }}
          >
            <line x1={a} y1={y} x2={b} y2={y} stroke={INK} strokeWidth={1.25} />
            <rect x={(a + b) / 2 - 2.5} y={y - 2.5} width={5} height={5} fill={INK} />
          </g>
        ))}
        <path
          d="M61 288 L75 282 L89 288 L75 294 Z"
          fill={NAVY}
          style={{
            transform: on(4) ? 'scale(1)' : 'scale(0)',
            transformOrigin: '75px 288px',
            transition: tr('transform', 0.5),
            filter: 'drop-shadow(0 0 6px rgba(1,31,91,0.45))',
          }}
        />
      </g>

      {/* hover hit areas — last so they sit on top */}
      {YS.map((y, i) => (
        <rect
          key={`hit${i}`}
          x={0}
          y={y - 30}
          width={460}
          height={60}
          fill="transparent"
          onMouseEnter={() => {
            setFlowStep(i);
            setPaused(true);
          }}
        />
      ))}
    </svg>
  );
}
