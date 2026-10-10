import { describe, expect, it } from 'vitest';
import { jpegPagesToPdf } from './pdf';

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('jpegPagesToPdf', () => {
  // The writer never decodes the JPEG, so stand-in bytes (including a stray "endobj") are enough.
  const fakeJpeg = (n: number) => new TextEncoder().encode(`\xff\xd8 image ${n} endobj \xff\xd9`);
  const pdf = jpegPagesToPdf([
    { jpeg: fakeJpeg(1), widthPx: 1240, heightPx: 1754 },
    { jpeg: fakeJpeg(2), widthPx: 1240, heightPx: 1754 },
  ]);
  const text = latin1(pdf);

  it('is a PDF with one page per image', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/Width 1240 /Height 1754');
  });

  it('points every cross-reference entry at the start of its object', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').slice(3, 3 + 8);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
    });
  });

  it('declares stream lengths that match the bytes', () => {
    for (const m of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const start = m.index + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });
});
