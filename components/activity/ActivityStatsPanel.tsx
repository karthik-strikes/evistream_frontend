'use client';

import { FileText, FlaskConical, ClipboardList } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import type { Activity } from '@/types/api';

interface ActivityStatsPanelProps {
  activities: Activity[];
}

export function ActivityStatsPanel({ activities }: ActivityStatsPanelProps) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const uploads = activities.filter(a => a.action_type === 'upload');
  const uploadsThisWeek = uploads.filter(a => new Date(a.created_at) >= weekAgo).length;

  const extractions = activities.filter(a => a.action_type === 'extraction');
  const extractionsThisWeek = extractions.filter(a => new Date(a.created_at) >= weekAgo).length;

  const forms = activities.filter(a => a.action_type === 'form_create' || a.action_type === 'code_generation');

  const cards = [
    {
      label: 'Documents',
      count: uploadsThisWeek,
      subtext: 'uploaded this week',
      icon: FileText,
      iconColor: 'text-blue-600 dark:text-blue-400',
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    },
    {
      label: 'Extractions',
      count: extractionsThisWeek,
      subtext: `${extractionsThisWeek === 1 ? 'run' : 'runs'} this week`,
      icon: FlaskConical,
      iconColor: 'text-green-600 dark:text-green-400',
      iconBg: 'bg-green-100 dark:bg-green-900/30',
    },
    {
      label: 'Forms',
      count: forms.length,
      subtext: 'created or updated',
      icon: ClipboardList,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className={cn('rounded-full p-3', card.iconBg)}>
                <Icon className={cn('h-5 w-5', card.iconColor)} />
              </div>
              <div>
                <p className={cn(typography.stat.default, 'text-gray-900 dark:text-white')}>{card.count}</p>
                <p className="text-sm text-gray-500 dark:text-zinc-400">{card.subtext}</p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
