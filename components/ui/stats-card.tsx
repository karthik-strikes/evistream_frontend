import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  sparklineData?: number[];
  className?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  sparklineData,
  className,
}: StatsCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        {Icon && (
          <Icon className="h-4 w-4 text-gray-500" />
        )}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {value}
        </div>
        {sparklineData && sparklineData.length > 0 && (
          <div className="mt-3">
            <Sparkline data={sparklineData} color="blue" />
          </div>
        )}
        {(description || trend) && (
          <div className="flex items-center gap-2 mt-1">
            {trend && (
              <div
                className={cn(
                  'inline-flex items-center text-xs font-medium',
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {trend.isPositive ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {Math.abs(trend.value)}%
              </div>
            )}
            {description && (
              <p className="text-xs text-gray-600">
                {description}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Compact stats card variant
export function StatsCardCompact({
  label,
  value,
  icon: Icon,
  color = 'gray',
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  className?: string;
}) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-zinc-100 text-zinc-700',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-white p-4',
        className
      )}
    >
      {Icon && (
        <div className={cn('rounded-full p-2', colorClasses[color])}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1">
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

// Grid of stats cards
export function StatsGrid({
  stats,
  columns = 4,
  className,
}: {
  stats: StatsCardProps[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const gridCols = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={cn('grid gap-4', gridCols[columns], className)}>
      {stats.map((stat, index) => (
        <StatsCard key={index} {...stat} />
      ))}
    </div>
  );
}
