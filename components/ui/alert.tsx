import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  description?: string;
  children?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const variantStyles = {
  info: {
    container: 'bg-zinc-50 border-zinc-200 text-zinc-900 dark:bg-zinc-900/50 dark:border-zinc-800 dark:text-zinc-100',
    icon: 'text-zinc-600 dark:text-zinc-400',
    IconComponent: Info,
  },
  success: {
    container: 'bg-green-50 border-green-200 text-green-900 dark:bg-green-900/20 dark:border-green-800 dark:text-green-100',
    icon: 'text-green-600 dark:text-green-400',
    IconComponent: CheckCircle2,
  },
  warning: {
    container: 'bg-yellow-50 border-yellow-200 text-yellow-900 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-100',
    icon: 'text-yellow-600 dark:text-yellow-400',
    IconComponent: AlertCircle,
  },
  error: {
    container: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-900/20 dark:border-red-800 dark:text-red-100',
    icon: 'text-red-600 dark:text-red-400',
    IconComponent: XCircle,
  },
};

export function Alert({
  variant = 'info',
  title,
  description,
  children,
  onClose,
  className,
}: AlertProps) {
  const styles = variantStyles[variant];
  const Icon = styles.IconComponent;

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 rounded-lg border p-4',
        styles.container,
        className
      )}
      role="alert"
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', styles.icon)} />

      <div className="flex-1 space-y-1">
        {title && (
          <h5 className="font-medium leading-none tracking-tight">
            {title}
          </h5>
        )}
        {description && (
          <p className="text-sm opacity-90">
            {description}
          </p>
        )}
        {children && (
          <div className="text-sm">
            {children}
          </div>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 rounded p-1 hover:bg-black/5 transition-colors"
          aria-label="Close alert"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Banner variant (full width, typically at top of page)
export function AlertBanner({
  variant = 'info',
  message,
  action,
  onClose,
  className,
}: {
  variant?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  onClose?: () => void;
  className?: string;
}) {
  const styles = variantStyles[variant];
  const Icon = styles.IconComponent;

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3 border-b',
        styles.container,
        className
      )}
      role="alert"
    >
      <div className="flex items-center gap-3">
        <Icon className={cn('h-5 w-5', styles.icon)} />
        <span className="text-sm font-medium">{message}</span>
      </div>

      <div className="flex items-center gap-2">
        {action && (
          <button
            onClick={action.onClick}
            className="text-sm font-medium underline hover:no-underline"
          >
            {action.label}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-black/5 transition-colors"
            aria-label="Close banner"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Inline alert (compact, minimal)
export function AlertInline({
  variant = 'info',
  message,
  className,
}: {
  variant?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  className?: string;
}) {
  const styles = variantStyles[variant];
  const Icon = styles.IconComponent;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-sm',
        styles.icon,
        className
      )}
      role="alert"
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
