'use client';

import type { FormCoverage } from '@/services/extractions.service';

interface ActiveStatusLineProps {
  coverageData: FormCoverage[];
}

export function ActiveStatusLine({ coverageData }: ActiveStatusLineProps) {
  // Collect all active jobs across all forms
  const runningJobs: { formName: string; papersDone: number; papersTotal: number }[] = [];
  let queuedCount = 0;

  for (const form of coverageData) {
    for (const job of form.active_jobs) {
      if (job.status === 'processing') {
        runningJobs.push({
          formName: form.form_name,
          papersDone: job.papers_done,
          papersTotal: job.papers_total,
        });
      } else if (job.status === 'pending') {
        queuedCount++;
      }
    }
  }

  if (runningJobs.length === 0 && queuedCount === 0) return null;

  // Build message parts
  const parts: string[] = [];

  if (runningJobs.length === 1) {
    const r = runningJobs[0];
    const progress = r.papersTotal > 0 ? ` ${r.papersDone}/${r.papersTotal} done` : '';
    parts.push(`Extracting papers with "${r.formName}"${progress}`);
  } else if (runningJobs.length > 1) {
    const totalDone = runningJobs.reduce((sum, r) => sum + r.papersDone, 0);
    const totalPapers = runningJobs.reduce((sum, r) => sum + r.papersTotal, 0);
    const progress = totalPapers > 0 ? ` ${totalDone}/${totalPapers} done` : '';
    parts.push(`Extracting across ${runningJobs.length} forms${progress}`);
  }

  if (queuedCount > 0) {
    parts.push(`${queuedCount} queued`);
  }

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      {parts.join(' \u00b7 ')}
    </div>
  );
}
