import { useQuery } from '@tanstack/react-query';
import { documentsService } from '@/services/documents.service';
import type { DocumentFigure, DocumentFiguresResponse } from '@/types/api';

/**
 * The digitized record for one figure of one document.
 *
 * The query key is `['document-figures', documentId]` verbatim — identical to
 * the one the document detail page uses (app/(dashboard)/documents/[id]/page.tsx).
 * That is deliberate on both counts: a reviewer who already opened that page
 * pays nothing here, and confirming a figure there invalidates this too, so a
 * source chip stops saying "unchecked" the moment someone checks it. `select`
 * narrows to one figure without forking the cache entry.
 *
 * Gated on `image` because there is nothing to look up until we know which
 * figure the quote came from — a text-sourced value never fires a request.
 */
export function useDocumentFigure(
  documentId: string | null,
  image: string | null,
): DocumentFigure | null {
  const { data } = useQuery({
    queryKey: ['document-figures', documentId],
    queryFn: () => documentsService.getFigures(documentId!),
    enabled: !!documentId && !!image,
    staleTime: 5 * 60_000,
    select: (d: DocumentFiguresResponse) =>
      d.figures?.find((f) => f.image === image) ?? null,
  });
  return data ?? null;
}
