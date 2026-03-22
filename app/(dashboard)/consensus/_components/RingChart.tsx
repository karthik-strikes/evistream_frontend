'use client';

import { useState, useEffect } from 'react';

export function RingChart({
  size = 48,
  strokeWidth = 5,
  green = 0,
  amber = 0,
  total = 1,
  centerLabel,
}: {
  size?: number;
  strokeWidth?: number;
  green: number;
  amber: number;
  total: number;
  centerLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [green, amber, total]);

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  const safeTotal = Math.max(total, 1);
  const greenArc = (green / safeTotal) * circumference;
  const amberArc = (amber / safeTotal) * circumference;

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-gray-100 dark:text-[#2a2a2a]"
      />
      {green > 0 && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#22c55e"
          strokeWidth={strokeWidth}
          strokeDasharray={`${mounted ? greenArc : 0} ${circumference}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)' }}
        />
      )}
      {amber > 0 && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={strokeWidth}
          strokeDasharray={`${mounted ? amberArc : 0} ${circumference}`}
          strokeDashoffset={-greenArc}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1) 0.15s' }}
        />
      )}
      {centerLabel && (
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-700 dark:fill-zinc-300"
          fontSize={size * 0.22}
          fontWeight="700"
          style={{ transform: 'rotate(90deg)', transformOrigin: `${cx}px ${cy}px` }}
        >
          {centerLabel}
        </text>
      )}
    </svg>
  );
}
