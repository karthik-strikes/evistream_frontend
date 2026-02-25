import { LucideIcon } from 'lucide-react';
import { Button } from './button';
import { Card } from './card';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={`p-12 text-center dark:bg-[#111111]/50 ${className || ''}`}>
      <div className="flex flex-col items-center max-w-md mx-auto">
        <div className="rounded-full bg-gray-100 p-4 mb-4 dark:bg-[#1a1a1a]">
          <Icon className="h-12 w-12 text-gray-400 dark:text-[#c0c0c0]" />
        </div>

        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">
          {title}
        </h3>

        <p className="text-sm text-gray-600 mb-6 dark:text-[#c0c0c0]">
          {description}
        </p>

        {action && (
          <Button onClick={action.onClick}>
            {action.icon && <action.icon className="h-4 w-4 mr-2" />}
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}

// Variant with illustration
export function EmptyStateIllustration({
  title,
  description,
  action,
  className,
}: Omit<EmptyStateProps, 'icon'>) {
  return (
    <Card className={`p-12 text-center dark:bg-[#111111]/50 ${className || ''}`}>
      <div className="flex flex-col items-center max-w-md mx-auto">
        {/* Simple SVG illustration */}
        <svg
          className="h-32 w-32 mb-6 text-gray-300 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>

        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">
          {title}
        </h3>

        <p className="text-sm text-gray-600 mb-6 dark:text-[#c0c0c0]">
          {description}
        </p>

        {action && (
          <Button onClick={action.onClick}>
            {action.icon && <action.icon className="h-4 w-4 mr-2" />}
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}

// Empty state with search
export function EmptyStateSearch({
  searchTerm,
  onClear,
}: {
  searchTerm: string;
  onClear: () => void;
}) {
  return (
    <Card className="p-12 text-center dark:bg-[#111111]/50">
      <div className="flex flex-col items-center max-w-md mx-auto">
        <div className="rounded-full bg-gray-100 p-4 mb-4 dark:bg-[#1a1a1a]">
          <svg
            className="h-12 w-12 text-gray-400 dark:text-[#c0c0c0]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">
          No results found
        </h3>

        <p className="text-sm text-gray-600 mb-4 dark:text-[#c0c0c0]">
          No items match your search for{' '}
          <span className="font-semibold">&ldquo;{searchTerm}&rdquo;</span>
        </p>

        <Button variant="secondary" onClick={onClear}>
          Clear Search
        </Button>
      </div>
    </Card>
  );
}

// Empty state with error
export function EmptyStateError({
  title = 'Something went wrong',
  description = 'We encountered an error. Please try again.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-12 text-center bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800">
      <div className="flex flex-col items-center max-w-md mx-auto">
        <div className="rounded-full bg-red-100 p-4 mb-4 dark:bg-red-900/30">
          <svg
            className="h-12 w-12 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-red-900 mb-2 dark:text-red-200">
          {title}
        </h3>

        <p className="text-sm text-red-700 mb-6 dark:text-red-300">
          {description}
        </p>

        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try Again
          </Button>
        )}
      </div>
    </Card>
  );
}
