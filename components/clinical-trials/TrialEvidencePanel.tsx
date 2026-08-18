'use client';

import { Badge } from '@/components/ui';
import { ExternalLink } from 'lucide-react';
import type { NormalizedTrial } from '@/types/api';

function statusVariant(overall: string | null): 'success' | 'info' | 'warning' | 'default' {
  if (!overall) return 'default';
  if (overall === 'COMPLETED') return 'success';
  if (overall === 'RECRUITING' || overall === 'ACTIVE_NOT_RECRUITING' || overall === 'ENROLLING_BY_INVITATION') return 'info';
  if (overall === 'TERMINATED' || overall === 'SUSPENDED' || overall === 'WITHDRAWN') return 'warning';
  return 'default';
}

interface TrialEvidencePanelProps {
  trial: NormalizedTrial;
  className?: string;
}

/**
 * Read-only display of a normalized ClinicalTrials.gov record — design,
 * sponsor, primary outcome, posted results, linked publications. Shown as
 * the right pane of LiteratureSearchDrawer (when a CT.gov result is
 * selected) before a reviewer commits to importing a trial, and reused by
 * ImportedTrialDrawer for already-imported trials. Linked publications are
 * citation text/links only — never auto-fetched as separate documents (see
 * project scope decision).
 */
export function TrialEvidencePanel({ trial, className }: TrialEvidencePanelProps) {
  const title = trial.title.brief || trial.title.official || trial.nctId;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Badge variant={statusVariant(trial.status.overall)}>{trial.status.overall || 'UNKNOWN'}</Badge>
        {trial.phase.length > 0 && <Badge variant="default">{trial.phase.join(', ')}</Badge>}
        {trial.status.hasResults && <Badge variant="info">Results posted</Badge>}
      </div>

      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug mb-3">
        {title}
      </h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
        <div>
          <div className="text-gray-400 dark:text-zinc-500">Sponsor</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">{trial.sponsor.lead || 'N/A'}</div>
        </div>
        <div>
          <div className="text-gray-400 dark:text-zinc-500">Enrollment</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">
            {trial.enrollment.count != null ? `${trial.enrollment.count} (${trial.enrollment.type || 'N/A'})` : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-gray-400 dark:text-zinc-500">Design</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">
            {[trial.design.allocation, trial.design.masking].filter(Boolean).join(', ') || 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-gray-400 dark:text-zinc-500">Completed</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">{trial.status.completionDate || 'N/A'}</div>
        </div>
      </div>

      {trial.outcomes.primary.length > 0 && (
        <div className="border-t border-gray-100 dark:border-[#1f1f1f] pt-3 mb-3">
          <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
            Primary outcome
          </div>
          <div className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed">
            {trial.outcomes.primary[0].measure}
            {trial.outcomes.primary[0].timeFrame && (
              <span className="text-gray-400 dark:text-zinc-500"> — {trial.outcomes.primary[0].timeFrame}</span>
            )}
          </div>
        </div>
      )}

      {trial.references.length > 0 && (
        <div className="border-t border-gray-100 dark:border-[#1f1f1f] pt-3 mb-3">
          <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
            Linked publications · {trial.references.length}
          </div>
          <div className="space-y-1">
            {trial.references.map((r, i) => (
              <div key={i} className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed">
                {r.citation || 'Untitled reference'}
                {r.pmid && <span className="text-gray-400 dark:text-zinc-500"> (PMID {r.pmid})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {trial.sourceUrl && (
        <a
          href={trial.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white transition-colors mt-1"
        >
          View on ClinicalTrials.gov
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
