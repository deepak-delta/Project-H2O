import { z } from 'zod';
import type { PaymentMethod } from '../enums';
import { phoneSchema, pinSchema } from './common';
import type { OrderListItem } from './sales';

// ─── Delivery staff (managed by the owner) ───────────────────────────────────

export const createStaffSchema = z.object({
  name: z.string().trim().min(1, 'Enter their name').max(80),
  phone: phoneSchema,
  pin: pinSchema,
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  name: z.string().trim().min(1, 'Enter their name').max(80).optional(),
  active: z.boolean().optional(),
});
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;

export const staffPinSchema = z.object({ pin: pinSchema });
export type StaffPinInput = z.input<typeof staffPinSchema>;

/** Owner gives an open order to a member of staff; null takes it back. */
export const assignOrderSchema = z.object({ staffId: z.string().min(1).nullable() });
export type AssignOrderInput = z.input<typeof assignOrderSchema>;

/** Give several orders to one member of staff (or back to the owner: null) in one go. */
export const bulkAssignSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, 'Choose at least one order').max(200),
  staffId: z.string().min(1).nullable(),
});
export type BulkAssignInput = z.input<typeof bulkAssignSchema>;
export interface BulkAssignResult {
  /** Orders now with that person. */
  assigned: number;
  /** Already delivered or cancelled, so left as they were. */
  skipped: number;
}

export interface StaffDto {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  createdAt: string;
  /** Today's totals for the owner's list. */
  today: Pick<StaffTodayDto, 'deliveries' | 'cansDelivered' | 'collected' | 'expenses' | 'cashInHand'>;
}

export type StaffActivity =
  | { kind: 'DELIVERY'; id: string; at: string; orderId: string; orderNumber: number; storeName: string; cans: number; empties: number; amount: string }
  | { kind: 'PAYMENT'; id: string; at: string; storeName: string; amount: string; method: PaymentMethod }
  | { kind: 'EMPTIES'; id: string; at: string; storeName: string; cans: number }
  | { kind: 'EXPENSE'; id: string; at: string; category: string; description: string | null; amount: string; method: PaymentMethod };

/**
 * One member of staff's work for one business day. Staff see only today's; it starts empty
 * again the next day. The owner can look at anyone's.
 */
export interface StaffTodayDto {
  staff: { id: string; name: string };
  /** YYYY-MM-DD in the business timezone. */
  date: string;
  deliveries: number;
  cansDelivered: number;
  emptiesCollected: number;
  /** Value of what they delivered (bills), before payments. */
  sales: string;
  /** Money they took, by method (payments at deliveries and against balances). */
  collected: { total: string; byMethod: Record<PaymentMethod, string> };
  expenses: string;
  /** Cash taken minus cash spent: what they should hand over. */
  cashInHand: string;
  /** Orders the owner gave them that are still to be delivered. */
  assignedOrders: OrderListItem[];
  activity: StaffActivity[];
}
