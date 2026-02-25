'use client';

import Link from 'next/link';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface TextLinkProps extends Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'> {
  variant?: 'default' | 'muted' | 'nav';
  size?: 'sm' | 'base' | 'lg';
  className?: string;
  external?: boolean;
}

const variantStyles = {
  default: 'text-zinc-900 hover:text-zinc-600 underline-offset-2 hover:underline',
  muted: 'text-gray-500 hover:text-gray-900 no-underline',
  nav: 'text-gray-700 hover:text-gray-900 no-underline font-medium',
} as const;

const sizeStyles = {
  sm: 'text-xs',
  base: 'text-sm',
  lg: 'text-base',
} as const;

export const TextLink = forwardRef<HTMLAnchorElement, TextLinkProps>(
  ({ variant = 'default', size = 'base', className, external, ...props }, ref) => {
    const externalProps = external
      ? { target: '_blank' as const, rel: 'noopener noreferrer' }
      : {};

    return (
      <Link
        ref={ref}
        className={cn(
          'transition-colors duration-150',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...externalProps}
        {...props}
      />
    );
  }
);

TextLink.displayName = 'TextLink';
