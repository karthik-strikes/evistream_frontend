import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 text-gray-700 dark:bg-[#1a1a1a] dark:text-[#e0e0e0]',
        secondary: 'bg-gray-100 text-gray-600 dark:bg-[#1a1a1a] dark:text-[#e0e0e0]',
        success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200',
        warning: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200',
        error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
        info: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        pending: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400',
        processing: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200',
        failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
        active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200',
        draft: 'bg-gray-100 text-gray-600 dark:bg-[#1a1a1a] dark:text-[#e0e0e0]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
