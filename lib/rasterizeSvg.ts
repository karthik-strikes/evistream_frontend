/**
 * Save an SVG string as a file — vector, or rasterized.
 *
 * Browser-only: it needs a canvas and an anchor click. The SVG this is handed
 * (see `synthesis/_lib/forestSvg.ts`) is fully self-contained — no external
 * images, no @font-face, no CSS from the page — which is what makes rasterizing
 * it safe: nothing can taint the canvas, so `toBlob` never throws on
 * cross-origin grounds.
 *
 * Two details that are easy to get wrong and expensive to notice later:
 *
 *  - PNG at 1:1 looks soft once opened at normal size, so the canvas is drawn at
 *    3x the SVG's own units. JPEG additionally cannot represent transparency, so
 *    a white rectangle is painted first rather than relying on whatever sits
 *    behind the image later.
 *  - Web fonts do not always cross into the `<img>` that rasterizes the SVG,
 *    because it loads in its own document context. The figure therefore names a
 *    system font stack rather than a bundled one — the raster then matches the
 *    vector instead of silently falling back to something else.
 */

const RESOLUTION_SCALE = 3;

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Slug for a filename: "Pain relief at 6 h" -> "pain-relief-at-6-h". */
export function slugify(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'figure';
}

export function downloadSvg(svg: string, filename: string): void {
  saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`);
}

export function downloadSvgAsImage(
  svg: string,
  filename: string,
  format: 'png' | 'jpg',
  size: { width: number; height: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(size.width * RESOLUTION_SCALE);
      canvas.height = Math.round(size.height * RESOLUTION_SCALE);
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error('This browser would not give us a canvas to draw on.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('The image could not be encoded.'));
            return;
          }
          saveBlob(blob, `${filename}.${format}`);
          resolve();
        },
        format === 'jpg' ? 'image/jpeg' : 'image/png',
        0.95,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The figure could not be rendered as an image.'));
    };

    img.src = url;
  });
}
