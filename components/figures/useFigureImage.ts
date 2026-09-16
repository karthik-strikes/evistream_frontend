'use client';

/**
 * Fetch one figure image and hand back an object URL.
 *
 * A plain <img src="/api/..."> cannot work: the access token lives in memory
 * (the only cookie is a non-credential `is_logged_in` flag) and a browser image
 * request never sends an Authorization header, so the endpoint 401s and the card
 * shows a broken-image icon. So fetch the bytes through the API client and
 * render an object URL — the same approach PdfHighlightViewer takes for the PDF.
 *
 * This lives in a hook rather than inside FigureImage because the lightbox needs
 * the same bytes under its own zoom/pan markup, and duplicating the fetch would
 * also duplicate the revokeObjectURL cleanup — the part that is easy to get
 * wrong. A second fetch of the same image is cheap: the endpoint answers
 * `Cache-Control: private, max-age=31536000, immutable`.
 */

import { useEffect, useState } from 'react';

import { documentsService } from '@/services/documents.service';

export function useFigureImage(documentId: string, image: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);

    documentsService
      .downloadImageBlob(documentId, image)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, image]);

  return { url, failed };
}
