/**
 * A minimal PDF writer: one JPEG image per page, nothing else. Pages are drawn on a canvas by the
 * caller (so the browser's own text engine renders ₹ and every Indian script correctly, which
 * PDF libraries can't shape), then packed here into a standard PDF 1.4 file.
 */

export interface PdfPage {
  /** Baseline JPEG bytes, e.g. from canvas.toBlob(…, 'image/jpeg'). */
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/** A4 portrait in PDF points (1/72 inch). */
export const A4 = { width: 595.28, height: 841.89 } as const;

export function jpegPagesToPdf(pages: PdfPage[], size: { width: number; height: number } = A4): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Starts object `id`, recording where it begins for the cross-reference table. */
  const object = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body.forEach(push);
    push('\nendobj\n');
  };

  // The binary comment line tells tools the file contains binary data.
  push('%PDF-1.4\n%âãÏÓ\n');

  // Objects: 1 catalog, 2 page tree, then three per page (page, its drawing, its image).
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  const w = size.width.toFixed(2);
  const h = size.height.toFixed(2);
  pages.forEach((page, i) => {
    const pageId = pageIds[i]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    // Scale the image to fill the page.
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(contentId, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(imageId, [
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
      page.jpeg,
      encoder.encode('\nendstream'),
    ]);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  // Each cross-reference entry is exactly 20 bytes: 10-digit offset, generation, flag, EOL.
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
