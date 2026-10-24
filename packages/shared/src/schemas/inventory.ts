import { z } from 'zod';
import type { MovementType } from '../enums';
import { clientIdSchema, quantitySchema } from './common';

const reason = z.string().trim().max(200).optional().transform((v) => v || null);

/**
 * Manual stock changes. Deliveries and returns are recorded automatically by sales, so these
 * cover everything that happens in the warehouse.
 */
export const stockMovementSchema = z.discriminatedUnion('kind', [
  /** First stock count when the business starts using the app. */
  z.object({
    kind: z.literal('OPENING'),
    clientId: clientIdSchema,
    productId: z.string().min(1),
    filled: quantitySchema,
    empty: quantitySchema,
    reason,
  }),
  /** New containers bought or received (filled or empty). */
  z.object({
    kind: z.literal('PURCHASE'),
    clientId: clientIdSchema,
    productId: z.string().min(1),
    filled: quantitySchema,
    empty: quantitySchema,
    reason,
  }),
  /** Empty cans refilled at the plant: empty → filled. */
  z.object({
    kind: z.literal('REFILL'),
    clientId: clientIdSchema,
    productId: z.string().min(1),
    quantity: quantitySchema.min(1, 'Enter how many cans were refilled'),
    reason,
  }),
  /** Cans found damaged (kept aside) or lost (gone), from the warehouse. */
  z.object({
    kind: z.enum(['DAMAGE', 'LOSS']),
    clientId: clientIdSchema,
    productId: z.string().min(1),
    from: z.enum(['FILLED', 'EMPTY']),
    quantity: quantitySchema.min(1, 'Enter how many cans'),
    reason,
  }),
  /** Physical count correction: the server records the difference as an adjustment. */
  z.object({
    kind: z.literal('ADJUSTMENT'),
    clientId: clientIdSchema,
    productId: z.string().min(1),
    countedFilled: quantitySchema,
    countedEmpty: quantitySchema,
    /** Damaged cans counted (returnable products). Left out: the damaged count stays as it is. */
    countedDamaged: quantitySchema.optional(),
    reason: z.string().trim().min(3, 'Say why the count changed').max(200),
  }),
]);
export type StockMovementInput = z.input<typeof stockMovementSchema>;

export interface StockSummary {
  productId: string;
  productName: string;
  isReturnable: boolean;
  filled: number;
  empty: number;
  withCustomers: number;
  damaged: number;
}

export interface MovementDto {
  id: string;
  type: MovementType;
  productName: string;
  filledDelta: number;
  emptyDelta: number;
  withCustomersDelta: number;
  damagedDelta: number;
  storeName: string | null;
  orderNumber: number | null;
  reason: string | null;
  occurredAt: string;
}

export interface CanHolder {
  storeId: string;
  storeName: string;
  phone: string | null;
  quantity: number;
  lastDeliveryAt: string | null;
}

export interface DashboardSummary {
  date: string;
  today: {
    orders: number;
    delivered: number;
    pending: number;
    sales: string;
    cashCollected: string;
    creditGiven: string;
    cansDelivered: number;
    emptiesCollected: number;
    expenses: string;
    /** All money in minus all money out today, every payment method. */
    netCash: string;
  };
  money: {
    /** Sum of what stores owe (stores with a positive balance only). */
    outstanding: string;
    storesOwing: number;
  };
  inventory: {
    filled: number;
    empty: number;
    withCustomers: number;
    damaged: number;
    lowStock: boolean;
  };
  stockWarnings: number;
}
