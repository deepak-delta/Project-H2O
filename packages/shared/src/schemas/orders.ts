import { z } from 'zod';
import type { OrderListItem, PaymentDto } from './sales';
import { optionalNote, paymentAtSaleSchema } from './sales';
import type { StoreCans, StorePriceDto } from './catalog';
import { clientIdSchema, moneySchema, occurredAtSchema, phoneSchema, pinSchema, quantitySchema } from './common';

// ─── Placing an order (store app, or supplier taking a phone order) ──────────

export const placeOrderSchema = z
  .object({
    clientId: clientIdSchema,
    /** Required for suppliers; ignored for store users (always their own store). */
    storeId: z.string().min(1).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: quantitySchema,
          /** Owner only: price for a product this client has no price for yet (saved for them). */
          unitPrice: moneySchema({ allowZero: false }).optional(),
        }),
      )
      .min(1, 'Add at least one product')
      .max(20),
    /** Owner only: the member of staff who will deliver it. */
    assignedToId: z.string().min(1).nullish(),
    /** Requested delivery day, YYYY-MM-DD in the business timezone. */
    deliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .transform((v) => v ?? null),
    notes: optionalNote,
    occurredAt: occurredAtSchema,
  })
  .refine((v) => v.items.some((i) => i.quantity > 0), { message: 'Choose how many cans you need', path: ['items'] })
  .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
    message: 'Each product can only appear once',
    path: ['items'],
  });
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

// ─── Delivering an existing order (fully or partly) ──────────────────────────

export const deliverOrderSchema = z.object({
  clientId: clientIdSchema,
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: quantitySchema,
        emptyCollected: quantitySchema.default(0),
      }),
    )
    .min(1)
    .max(20)
    .refine((items) => items.some((i) => i.quantity > 0), 'Enter how many cans were delivered')
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'Each product can only appear once'),
  discount: moneySchema().default('0'),
  payment: paymentAtSaleSchema,
  notes: optionalNote,
  occurredAt: occurredAtSchema,
});
export type DeliverOrderInput = z.input<typeof deliverOrderSchema>;

export const orderStatusChangeSchema = z.object({
  status: z.enum(['CONFIRMED', 'OUT_FOR_DELIVERY']),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(200).nullish().transform((v) => v || null),
  /** For delivered orders: also give back money received for this order. */
  refundPayments: z.boolean().default(false),
});
export type CancelOrderInput = z.input<typeof cancelOrderSchema>;

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Say why this payment is being reversed').max(200),
});
export type ReversePaymentInput = z.input<typeof reversePaymentSchema>;

// ─── Store app access ────────────────────────────────────────────────────────

export const storeLoginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
});
export type StoreLoginInput = z.input<typeof storeLoginSchema>;

/** Everything the store's home screen needs, in one request. */
export interface StoreHomeDto {
  store: { id: string; name: string };
  supplier: { businessName: string; phone: string };
  balance: string;
  cans: StoreCans[];
  cansOutstanding: number;
  lastDelivery: { orderId: string; orderNumber: number; deliveredAt: string; quantity: number } | null;
  openOrders: OrderListItem[];
  recentOrders: OrderListItem[];
  recentPayments: PaymentDto[];
  /** Quantities of the last delivery, to prefill "Order water". */
  lastOrderItems: { productId: string; quantity: number }[];
  /** What this store pays per product. A product missing here can't be ordered yet. */
  prices: StorePriceDto[];
}
