import { z } from 'zod';
import {
  PAYMENT_METHODS,
  type LedgerType,
  type MovementType,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '../enums';
import { clientIdSchema, moneySchema, occurredAtSchema, quantitySchema } from './common';

export const optionalNote = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null);

// ─── Quick sale: create + deliver + collect payment in one step ──────────────

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: quantitySchema,
  /** Empty cans of this product collected back at the same visit. */
  emptyCollected: quantitySchema.default(0),
  /**
   * Price per can for this sale. Defaults to the store's price. When the store has no price for
   * the product yet, this is required and becomes the store's price.
   */
  unitPrice: moneySchema({ allowZero: true }).optional(),
});

export const paymentAtSaleSchema = z.object({
  /** Amount received now. 0 = full credit. May exceed the bill to clear older dues. */
  amount: moneySchema(),
  method: z.enum(PAYMENT_METHODS).default('CASH'),
  referenceNumber: z.string().trim().max(60).optional(),
});

export const quickSaleSchema = z
  .object({
    clientId: clientIdSchema,
    storeId: z.string().min(1),
    items: z.array(saleItemSchema).min(1, 'Add at least one product').max(20),
    discount: moneySchema().default('0'),
    payment: paymentAtSaleSchema,
    notes: optionalNote,
    occurredAt: occurredAtSchema,
  })
  .refine((v) => v.items.some((i) => i.quantity > 0), {
    message: 'Enter how many cans were delivered',
    path: ['items'],
  })
  .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
    message: 'Each product can only appear once',
    path: ['items'],
  });
export type QuickSaleInput = z.input<typeof quickSaleSchema>;

// ─── Payments ────────────────────────────────────────────────────────────────

export const recordPaymentSchema = z.object({
  clientId: clientIdSchema,
  storeId: z.string().min(1),
  amount: moneySchema({ allowZero: false }),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().trim().max(60).optional(),
  notes: optionalNote,
  occurredAt: occurredAtSchema,
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

// ─── Can returns without a sale ──────────────────────────────────────────────

export const canReturnSchema = z.object({
  clientId: clientIdSchema,
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: quantitySchema }))
    .min(1)
    .max(20)
    .refine((items) => items.some((i) => i.quantity > 0), 'Enter how many cans were returned'),
  notes: optionalNote,
  occurredAt: occurredAtSchema,
});
export type CanReturnInput = z.input<typeof canReturnSchema>;

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface OrderItemDto {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  delivered: number;
  emptyCollected: number;
}

export interface OrderPaymentDto {
  id: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  reversed: boolean;
}

export interface OrderDto {
  id: string;
  orderNumber: number;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  source: OrderSource;
  orderDate: string;
  /** Requested delivery day for orders placed in advance. */
  deliveryDate: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  subtotal: string;
  discount: string;
  total: string;
  /** Paid against this order (non-reversed payments linked to it). */
  amountPaid: string;
  /** total − paid, floored at 0. */
  creditAmount: string;
  paymentStatus: PaymentStatus;
  notes: string | null;
  items: OrderItemDto[];
  payments: OrderPaymentDto[];
  stockWarning: boolean;
  /** Member of staff the owner gave this order to. */
  assignedTo: { id: string; name: string } | null;
}

export interface OrderListItem {
  id: string;
  orderNumber: number;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  source: OrderSource;
  orderDate: string;
  deliveryDate: string | null;
  total: string;
  amountPaid: string;
  paymentStatus: PaymentStatus;
  totalQuantity: number;
  /** Member of staff the owner gave this order to. */
  assignedTo: { id: string; name: string } | null;
}

export interface QuickSaleResult {
  order: OrderDto;
  /** Store balance after this sale (positive = owes). */
  storeBalance: string;
  /** True when this exact request had already been processed (safe retry). */
  replayed: boolean;
}

export interface PaymentDto {
  id: string;
  storeId: string;
  storeName: string;
  orderId: string | null;
  orderNumber: number | null;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  paymentDate: string;
  notes: string | null;
  reversed: boolean;
}

export interface LedgerEntryDto {
  id: string;
  type: LedgerType;
  amount: string;
  /** Store balance right after this entry. */
  balanceAfter: string;
  occurredAt: string;
  note: string | null;
  orderId: string | null;
  orderNumber: number | null;
  paymentMethod: PaymentMethod | null;
}

export interface CanMovementDto {
  id: string;
  type: MovementType;
  productName: string;
  /** Change in cans held by the store: +delivered, −returned. */
  change: number;
  occurredAt: string;
  orderNumber: number | null;
  reason: string | null;
}
