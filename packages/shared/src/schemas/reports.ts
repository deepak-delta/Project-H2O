import { z } from 'zod';
import { daysBetween, isDateKey } from '../date';
import {
  CASHFLOW_TYPES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type CashFlowCategory,
  type CashFlowType,
  type MovementType,
  type PaymentMethod,
} from '../enums';
import { clientIdSchema, moneySchema } from './common';

export const dateKeySchema = z.string().refine(isDateKey, 'Enter a valid date');

/** Inclusive local-date range, at most a year so report queries stay bounded. */
export const dateRangeSchema = z
  .object({ from: dateKeySchema, to: dateKeySchema })
  .refine((r) => r.from <= r.to, { message: 'Start date must be before end date', path: ['to'] })
  .refine((r) => daysBetween(r.from, r.to) <= 366, { message: 'Choose a period of one year or less', path: ['to'] });
export type DateRange = z.output<typeof dateRangeSchema>;

// ─── Cash flow ───────────────────────────────────────────────────────────────

/** Income that is entered by hand. Sales and recovered credit come from payments automatically. */
export const MANUAL_INCOME_CATEGORIES = ['DEPOSIT', 'OTHER_INCOME'] as const;

export const cashEntrySchema = z
  .object({
    clientId: clientIdSchema,
    type: z.enum(CASHFLOW_TYPES),
    category: z.enum([...EXPENSE_CATEGORIES, ...MANUAL_INCOME_CATEGORIES]),
    amount: moneySchema({ allowZero: false }),
    method: z.enum(PAYMENT_METHODS).default('CASH'),
    /** Local date the money moved; defaults to today. */
    date: dateKeySchema.nullish().transform((v) => v ?? null),
    description: z.string().trim().max(200).nullish().transform((v) => v || null),
    reference: z.string().trim().max(60).nullish().transform((v) => v || null),
  })
  .refine(
    (v) =>
      v.type === 'EXPENSE'
        ? (EXPENSE_CATEGORIES as readonly string[]).includes(v.category)
        : (MANUAL_INCOME_CATEGORIES as readonly string[]).includes(v.category),
    { message: 'Choose a category that matches money in or out', path: ['category'] },
  );
export type CashEntryInput = z.input<typeof cashEntrySchema>;

export const reverseCashEntrySchema = z.object({
  reason: z.string().trim().min(3, 'Say why this entry is being reversed').max(200),
});

export interface CashEntryDto {
  id: string;
  type: CashFlowType;
  category: CashFlowCategory;
  /** Signed within its type: reversals are negative. */
  amount: string;
  date: string;
  method: PaymentMethod;
  description: string | null;
  reference: string | null;
  /** Store, when the entry came from a payment. */
  storeName: string | null;
  /** Created automatically from a payment (reverse the payment instead). */
  fromPayment: boolean;
  reversed: boolean;
  isReversal: boolean;
}

export interface CashFlowSummary {
  from: string;
  to: string;
  moneyIn: string;
  moneyOut: string;
  net: string;
  byCategory: { type: CashFlowType; category: CashFlowCategory; amount: string }[];
  /** Per payment method; the CASH row approximates cash in hand for the period. */
  byMethod: { method: PaymentMethod; moneyIn: string; moneyOut: string; net: string }[];
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface SalesReportRow {
  /** YYYY-MM-DD or YYYY-MM. */
  period: string;
  deliveries: number;
  cans: number;
  /** Net of discounts and cancelled deliveries. */
  sales: string;
  /** Net of reversed payments. */
  collected: string;
  /** Sales minus collections: how much dues grew (negative = shrank). */
  duesChange: string;
}

export interface SalesReport {
  from: string;
  to: string;
  groupBy: 'day' | 'month';
  rows: SalesReportRow[];
  totals: Omit<SalesReportRow, 'period'>;
}

export interface OutstandingRow {
  storeId: string;
  storeName: string;
  phone: string | null;
  balance: string;
  cans: number;
  lastPaymentAt: string | null;
  lastDeliveryAt: string | null;
}

export interface OutstandingReport {
  total: string;
  rows: OutstandingRow[];
}

export interface StockCounts {
  filled: number;
  empty: number;
  withCustomers: number;
  damaged: number;
}

export interface InventoryReportProduct {
  productId: string;
  productName: string;
  opening: StockCounts;
  movements: ({ type: MovementType } & StockCounts)[];
  closing: StockCounts;
}

export interface InventoryReport {
  from: string;
  to: string;
  products: InventoryReportProduct[];
}
