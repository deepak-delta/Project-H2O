import type { BusinessSummary } from '@wd/shared';
import { A4, jpegPagesToPdf, type PdfPage } from '../../utils/pdf';
import { CATEGORY_LABEL, METHOD_LABEL } from '../cashflow/labels';
import { formatPeriod } from './ReportBits';

/**
 * The business summary as an A4 PDF document. Pages are drawn on a canvas with the browser's own
 * fonts (₹ and Malayalam/Hindi/Tamil names render properly), then packed into a PDF.
 */

interface Column {
  label: string;
  /** Share of the content width. */
  width: number;
  align: 'left' | 'right';
}
interface Table {
  title: string;
  columns: Column[];
  /** Two-column label/value lists don't need a header row. */
  header: boolean;
  rows: string[][];
}

const SCALE = 2; // canvas pixels per PDF point: sharp on screen and in print
const MARGIN = 40;
const CONTENT = A4.width - MARGIN * 2;
const TOP = MARGIN;
const BOTTOM = A4.height - MARGIN - 18; // leaves room for the footer
const ROW = 19;
const HEAD = 17;
const TITLE = 30;
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const ACCENT = '#0f5c6b';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Malayalam", "Noto Sans Devanagari", sans-serif';

const pair = (title: string, rows: [string, string][]): Table => ({
  title,
  header: false,
  columns: [
    { label: '', width: 0.65, align: 'left' },
    { label: '', width: 0.35, align: 'right' },
  ],
  rows,
});

function tables(d: BusinessSummary, format: (amount: string) => string): Table[] {
  const income = d.cashFlow.byCategory.filter((c) => c.type === 'INCOME');
  const expenses = d.cashFlow.byCategory.filter((c) => c.type === 'EXPENSE');
  const list: Table[] = [
    pair('This period', [
      ['Sales', format(d.sales.sales)],
      ['Collected', format(d.sales.collected)],
      ['Change in dues (sales not yet paid)', format(d.sales.duesChange)],
      ['Deliveries', String(d.sales.deliveries)],
      ['Cans delivered', String(d.sales.cans)],
      ['New clients', String(d.newClients)],
    ]),
  ];
  if (d.collectedByMethod.length) list.push(pair('Money received', d.collectedByMethod.map((m) => [METHOD_LABEL[m.method], format(m.amount)])));
  list.push(
    pair('Cash flow', [
      ['Money in', format(d.cashFlow.moneyIn)],
      ['Money out', format(d.cashFlow.moneyOut)],
      ['Net', format(d.cashFlow.net)],
    ]),
  );
  if (income.length) list.push(pair('Income', income.map((c) => [CATEGORY_LABEL[c.category], format(c.amount)])));
  if (expenses.length) list.push(pair('Expenses', expenses.map((c) => [CATEGORY_LABEL[c.category], format(c.amount)])));
  list.push(
    pair('Cans', [
      ['Full cans delivered', String(d.cans.delivered)],
      ['Empties collected', String(d.cans.emptiesBack)],
      ['Damaged cans taken back', String(d.cans.damagedFromClients)],
      ['Damaged or lost in stock', String(d.cans.damagedOrLostInStock)],
      ['Refilled', String(d.cans.refilled)],
    ]),
    pair('Right now (today)', [
      [`Owed to you · ${d.now.clientsOwing} ${d.now.clientsOwing === 1 ? 'client' : 'clients'}`, format(d.now.outstanding)],
      ['Cans with clients', String(d.now.cansWithClients)],
    ]),
  );
  if (d.now.stock.length) {
    list.push({
      title: 'Stock now',
      header: true,
      columns: [
        { label: 'Product', width: 0.36, align: 'left' },
        { label: 'Full', width: 0.16, align: 'right' },
        { label: 'Empty', width: 0.16, align: 'right' },
        { label: 'With clients', width: 0.16, align: 'right' },
        { label: 'Damaged', width: 0.16, align: 'right' },
      ],
      rows: d.now.stock.map((p) => [p.productName, String(p.filled), String(p.empty), String(p.withCustomers), String(p.damaged)]),
    });
  }
  if (d.people.length) {
    list.push({
      title: 'Owner and staff',
      header: true,
      columns: [
        { label: 'Name', width: 0.46, align: 'left' },
        { label: 'Deliveries', width: 0.18, align: 'right' },
        { label: 'Cans', width: 0.14, align: 'right' },
        { label: 'Collected', width: 0.22, align: 'right' },
      ],
      rows: d.people.map((p) => [p.role === 'SUPPLIER' ? `${p.name} (owner)` : p.name, String(p.deliveries), String(p.cans), format(p.collected)]),
    });
  }
  if (d.topClients.length) {
    list.push({
      title: 'Top clients',
      header: true,
      columns: [
        { label: 'Client', width: 0.56, align: 'left' },
        { label: 'Sales', width: 0.22, align: 'right' },
        { label: 'Paid', width: 0.22, align: 'right' },
      ],
      rows: d.topClients.map((c) => [c.storeName, format(c.sales), format(c.collected)]),
    });
  }
  if (d.topOwing.length) {
    list.push({
      title: 'Owe you the most',
      header: true,
      columns: [
        { label: 'Client', width: 0.7, align: 'left' },
        { label: 'Balance', width: 0.3, align: 'right' },
      ],
      rows: d.topOwing.map((c) => [c.storeName, format(c.balance)]),
    });
  }
  return list;
}

/** Shortens text with "…" to fit a width. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

interface Doc {
  business: string;
  periodLabel: string;
  generatedAt: string;
}

/**
 * Lays the report out page by page. With `ctx` null it only counts pages (so footers can say
 * "Page 1 of 3"); row heights are fixed, so both passes break pages in the same places.
 */
function layout(data: Table[], doc: Doc, d: BusinessSummary, page: (index: number) => CanvasRenderingContext2D | null): number {
  let index = 0;
  let ctx = page(index);
  let y = TOP;

  const text = (s: string, x: number, at: number, opts: { size: number; weight?: number; color?: string; align?: 'left' | 'right'; width?: number }) => {
    if (!ctx) return;
    ctx.font = `${opts.weight ?? 400} ${opts.size}px ${FONT}`;
    ctx.fillStyle = opts.color ?? INK;
    ctx.textAlign = opts.align ?? 'left';
    ctx.fillText(opts.width ? fit(ctx, s, opts.width) : s, x, at);
  };
  const rule = (at: number, color = RULE, width = 0.75) => {
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(MARGIN, at);
    ctx.lineTo(A4.width - MARGIN, at);
    ctx.stroke();
  };
  const newPage = () => {
    index += 1;
    ctx = page(index);
    y = TOP;
  };

  // Title block, first page only.
  text(doc.business, MARGIN, y + 16, { size: 18, weight: 700, width: CONTENT });
  text('Business summary', MARGIN, y + 36, { size: 12.5, weight: 600, color: ACCENT });
  text(`${formatPeriod(d.from)} – ${formatPeriod(d.to)} · ${doc.periodLabel}`, MARGIN, y + 54, { size: 9.5, color: MUTED, width: CONTENT });
  text(`Made ${doc.generatedAt}`, MARGIN, y + 68, { size: 9.5, color: MUTED, width: CONTENT });
  y += 80;
  rule(y, ACCENT, 1.25);
  y += 14;

  const columnX = (cols: Column[]) => {
    let x = MARGIN;
    return cols.map((c) => {
      const left = x;
      x += c.width * CONTENT;
      return { left, right: x, inner: c.width * CONTENT - 8 };
    });
  };
  const headerRow = (t: Table) => {
    if (!t.header) return;
    columnX(t.columns).forEach((pos, i) => {
      const c = t.columns[i]!;
      text(c.label, c.align === 'right' ? pos.right : pos.left, y + 11, { size: 8.5, weight: 600, color: MUTED, align: c.align, width: pos.inner });
    });
    y += HEAD;
    rule(y);
  };
  const sectionTitle = (t: Table, continued: boolean) => {
    text(`${t.title}${continued ? ' (continued)' : ''}`.toUpperCase(), MARGIN, y + 16, { size: 9, weight: 700, color: ACCENT });
    y += TITLE - 8;
    rule(y, '#cbd5e1', 1);
  };

  for (const t of data) {
    // Keep a section's title with at least its first rows.
    const need = TITLE + (t.header ? HEAD : 0) + Math.min(2, t.rows.length) * ROW;
    if (y + need > BOTTOM) newPage();
    sectionTitle(t, false);
    headerRow(t);
    for (const row of t.rows) {
      if (y + ROW > BOTTOM) {
        newPage();
        sectionTitle(t, true);
        headerRow(t);
      }
      columnX(t.columns).forEach((pos, i) => {
        const c = t.columns[i]!;
        text(row[i] ?? '', c.align === 'right' ? pos.right : pos.left, y + 13, {
          size: 10,
          weight: c.align === 'right' ? 600 : 400,
          align: c.align,
          width: pos.inner,
        });
      });
      y += ROW;
      rule(y);
    }
    y += 12;
  }
  return index + 1;
}

function footer(ctx: CanvasRenderingContext2D, doc: Doc, n: number, total: number) {
  ctx.font = `400 8px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(fit(ctx, `${doc.business} · Business summary`, CONTENT * 0.7), MARGIN, A4.height - MARGIN + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`Page ${n} of ${total}`, A4.width - MARGIN, A4.height - MARGIN + 6);
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not draw the PDF page');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function summaryPdf(d: BusinessSummary, options: Doc & { format: (amount: string) => string }): Promise<Blob> {
  const data = tables(d, options.format);
  await document.fonts.ready;
  const total = layout(data, options, d, () => null);

  const canvases: HTMLCanvasElement[] = [];
  layout(data, options, d, (index) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(A4.width * SCALE);
    canvas.height = Math.round(A4.height * SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency; paper is white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'alphabetic';
    footer(ctx, options, index + 1, total);
    canvases[index] = canvas;
    return ctx;
  });

  const pages: PdfPage[] = [];
  for (const canvas of canvases) {
    pages.push({ jpeg: await toJpeg(canvas), widthPx: canvas.width, heightPx: canvas.height });
    canvas.width = 0; // free the pixels early on low-memory phones
  }
  return new Blob([jpegPagesToPdf(pages) as BlobPart], { type: 'application/pdf' });
}
