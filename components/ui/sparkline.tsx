'use client';

import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  className?: string;
  color?: 'blue' | 'green' | 'red' | 'purple';
  showTrend?: boolean;
}

export function Sparkline({ data, className, color = 'blue', showTrend = true }: SparklineProps) {
  if (!data || data.length === 0) return null;
  if (data.length === 1) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <svg width={60} height={20} className="overflow-visible" preserveAspectRatio="none">
          <circle cx={30} cy={10} r={2} className={`fill-${color}-500`} />
        </svg>
      </div>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  // Calculate points for the line
  const width = 60;
  const height = 20;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  // Determine trend
  const firstValue = data[0];
  const lastValue = data[data.length - 1];
  const isUp = lastValue > firstValue;
  const isFlat = lastValue === firstValue;

  const colorClasses = {
    blue: 'stroke-blue-500',
    green: 'stroke-green-500',
    red: 'stroke-red-500',
    purple: 'stroke-purple-500',
  };

  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    flat: 'text-gray-400',
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          className={cn(colorClasses[color], 'stroke-2')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showTrend && (
        <span className={cn(
          'text-xs font-medium',
          isFlat ? trendColors.flat : isUp ? trendColors.up : trendColors.down
        )}>
          {isFlat ? '→' : isUp ? '↗' : '↘'}
        </span>
      )}
    </div>
  );
}

// Generate mock trend data for demo
export function generateTrendData(current: number, days: number = 7): number[] {
  const data: number[] = [];
  let value = Math.max(0, current - Math.floor(Math.random() * 5));

  for (let i = 0; i < days; i++) {
    data.push(value);
    // Random walk
    const change = Math.random() > 0.5 ? 1 : -1;
    value = Math.max(0, value + change);
  }

  // Ensure last value is close to current
  data[days - 1] = current;

  return data;
}
