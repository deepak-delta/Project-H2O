export type CsvCell = string | number | null | undefined;

/**
 * Text cells starting with = + - @ (or tab/CR) are run as formulas by Excel and Sheets, so
 * they are prefixed with an apostrophe. Numbers are left alone so negatives stay numeric.
 */
function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return String(cell);
  let text = cell;
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Saves a CSV file; the BOM makes Excel read ₹ and other UTF-8 text correctly. */
export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const blob = new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
