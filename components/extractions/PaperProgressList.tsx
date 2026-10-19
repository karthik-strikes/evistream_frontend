'use client';

import { CheckCircle2, XCircle, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PaperProgressState {
  done: number;
  total: number;
  papers: Map<string, 'success' | 'failed'>;
}

interface PaperProgressListProps {
  pp: PaperProgressState;
  docNamesMap: Map<string, string>;
}

export function PaperProgressList({ pp, docNamesMap }: PaperProgressListProps) {
  const pendingCount = Math.max(0, pp.total - pp.papers.size - (pp.done < pp.total ? 1 : 0));

  return (
    <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
      {Array.from(pp.papers.entries()).map(([docId, status]) => (
        <div key={docId} className="flex items-center gap-2 text-xs py-0.5">
          {status === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          )}
          <span
            className={cn(
              'truncate',
              status === 'success' ? 'text-gray-600 dark:text-zinc-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {docNamesMap.get(docId) ?? docId}
          </span>
        </div>
      ))}

      {pp.done < pp.total && (
        <div className="flex items-center gap-2 text-xs py-0.5">
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
          <span className="text-blue-600 dark:text-blue-400">Extracting...</span>
        </div>
      )}

      {Array.from({ length: pendingCount }).map((_, i) => (
        <div key={`pending-${i}`} className="flex items-center gap-2 text-xs py-0.5">
          <Circle className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-700 flex-shrink-0" />
          <span className="text-gray-300 dark:text-zinc-700">Waiting...</span>
        </div>
      ))}
    </div>
  );
}
