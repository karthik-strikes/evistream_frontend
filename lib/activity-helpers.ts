import type { Activity } from '@/types/api';

export interface ActivityDisplay {
  title: string;
  description: string;
  statusLabel: string;
  statusColor: 'green' | 'red' | 'blue' | 'amber' | 'gray';
  icon: string;
}

export function getActivityDisplay(activity: Activity): ActivityDisplay {
  const meta = activity.metadata ?? {};
  const filename = meta.filename ?? 'A file';
  const projectName = meta.project_name ?? activity.project_name ?? 'the project';
  const formName = meta.form_name ?? 'a form';

  switch (activity.action_type) {
    case 'upload':
      if (activity.action === 'Document Deleted') {
        return {
          title: 'Document removed',
          description: `${filename} was removed from the project`,
          statusLabel: 'Removed',
          statusColor: 'gray',
          icon: 'file',
        };
      }
      return {
        title: 'Document uploaded',
        description: `${filename} was added to ${projectName}`,
        statusLabel: 'Processed',
        statusColor: 'green',
        icon: 'file',
      };

    case 'extraction':
      if (activity.action === 'Extraction Cancelled') {
        return {
          title: 'Extraction stopped',
          description: 'An extraction was manually stopped',
          statusLabel: 'Stopped',
          statusColor: 'gray',
          icon: 'flask',
        };
      }
      if (activity.action === 'Extraction Deleted') {
        return {
          title: 'Extraction removed',
          description: 'An extraction was deleted',
          statusLabel: 'Removed',
          statusColor: 'gray',
          icon: 'flask',
        };
      }
      if (activity.action === 'Retry Failed Papers') {
        return {
          title: 'Extraction retried',
          description: 'Failed papers were queued for re-extraction',
          statusLabel: 'Retried',
          statusColor: 'amber',
          icon: 'flask',
        };
      }
      return {
        title: 'Extraction started',
        description: `Data extraction began using ${formName} form`,
        statusLabel: 'Running',
        statusColor: 'blue',
        icon: 'flask',
      };

    case 'form_create':
      if (activity.action === 'Form Deleted') {
        return {
          title: 'Form deleted',
          description: 'A form was removed from this project',
          statusLabel: 'Removed',
          statusColor: 'gray',
          icon: 'clipboard',
        };
      }
      return {
        title: 'Form created',
        description: `${formName} form was set up`,
        statusLabel: 'Created',
        statusColor: 'green',
        icon: 'clipboard',
      };

    case 'code_generation':
      if (activity.action === 'Form Approved') {
        return {
          title: 'Form approved',
          description: `${formName} is ready to use for extraction`,
          statusLabel: 'Ready',
          statusColor: 'green',
          icon: 'clipboard',
        };
      }
      return {
        title: 'Form code regenerated',
        description: `Extraction code was rebuilt for ${formName}`,
        statusLabel: 'Updated',
        statusColor: 'blue',
        icon: 'clipboard',
      };

    default:
      return {
        title: activity.action,
        description: 'Activity recorded',
        statusLabel: 'Done',
        statusColor: 'gray',
        icon: 'pin',
      };
  }
}

export function getRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Invalid date';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 0 || diffSec < 60) return 'just now';

  const minutes = Math.floor(diffSec / 60);
  if (diffSec < 3600) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.floor(diffSec / 3600);
  if (diffSec < 86400) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  // Yesterday check
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  // Older
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
