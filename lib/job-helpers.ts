import type { Job } from '@/types/api';

export function getJobTitle(job: Job, formIdMap?: Map<string, string>): string {
  const input = job.input_data as Record<string, any> | null;

  switch (job.job_type) {
    case 'pdf_processing': {
      const filename = input?.filename || input?.original_filename;
      return filename ? `Processing ${filename}` : 'Processing document';
    }
    case 'form_generation': {
      const formId = input?.form_id;
      const formName = formId && formIdMap?.get(formId);
      return formName ? `Setting up ${formName}` : 'Setting up form';
    }
    case 'extraction': {
      const docIds = input?.document_ids as string[] | undefined;
      const count = docIds?.length || input?.max_documents;
      if (count) return `Extracting data from ${count} paper${count === 1 ? '' : 's'}`;
      return 'Extraction';
    }
    default:
      return 'Processing task';
  }
}

export function getJobSubtitle(job: Job, formIdMap?: Map<string, string>): string {
  const input = job.input_data as Record<string, any> | null;

  switch (job.job_type) {
    case 'pdf_processing':
      return 'Converting PDF to text for extraction';
    case 'form_generation':
      return 'Building extraction code';
    case 'extraction': {
      const formId = input?.form_id;
      const formName = formId && formIdMap?.get(formId);
      return formName ? `Using ${formName} form` : 'Running extraction';
    }
    default:
      return 'Processing';
  }
}

export function getJobStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Queued';
    case 'processing': return 'Running';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Stopped';
    default: return status;
  }
}

export function getProgressMessage(job: Job): string {
  if (job.status === 'completed') return 'Finished successfully';
  if (job.status === 'failed') return 'Stopped with an error';
  if (job.status === 'cancelled') return 'Cancelled';

  if (job.status === 'processing' || job.status === 'pending') {
    switch (job.job_type) {
      case 'pdf_processing':
        return 'Converting document to text...';
      case 'form_generation':
        return 'Analyzing form fields...';
      case 'extraction': {
        const progress = job.progress;
        if (progress && progress > 0) return `${progress}% complete`;
        return 'Processing...';
      }
      default:
        return 'Processing...';
    }
  }

  return '';
}

export function getHumanError(errorMessage: string | null, jobType: string): { explanation: string; guidance: string } {
  if (!errorMessage) {
    return {
      explanation: 'Something went wrong during processing.',
      guidance: 'If this keeps happening, contact support.',
    };
  }

  const lower = errorMessage.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return {
      explanation: 'This took longer than expected due to high demand.',
      guidance: 'Try again in a few minutes.',
    };
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) {
    return {
      explanation: 'The task took too long to complete.',
      guidance: jobType === 'extraction' ? 'Try with fewer documents.' : 'Try again shortly.',
    };
  }

  if (lower.includes('not found') || lower.includes('404')) {
    return {
      explanation: 'A required resource could not be found.',
      guidance: 'Make sure your documents and forms are still available, then try again.',
    };
  }

  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('403')) {
    return {
      explanation: 'You may not have permission to perform this action.',
      guidance: 'Check your project permissions or contact the project owner.',
    };
  }

  return {
    explanation: 'Something went wrong during processing.',
    guidance: 'If this keeps happening, contact support.',
  };
}

export function getRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  // Check if yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function getDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return '';

  const start = new Date(startedAt);
  const end = new Date(completedAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

  const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (diffSec < 0) return '';

  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function getJobActionButton(job: Job): { label: string; href: string } | null {
  if (job.status === 'completed') {
    const input = job.input_data as Record<string, any> | null;
    if (job.job_type === 'extraction') {
      const extractionId = input?.extraction_id || '';
      return { label: 'View Results', href: `/results?extraction_id=${extractionId}` };
    }
    // No action needed for pdf_processing or form_generation completions
    return null;
  }

  if (job.status === 'failed') {
    if (job.job_type === 'extraction') {
      return { label: 'Try Again', href: '/extractions' };
    }
    return null;
  }

  return null;
}
