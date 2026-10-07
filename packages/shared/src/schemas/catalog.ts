import { z } from 'zod';
import { CLIENT_CATEGORIES, STORE_STATUSES, type ClientCategory, type StoreStatus } from '../enums';
import { moneySchema, phoneSchema, quantitySchema } from './common';

// Optional fields accept "", null or undefined and normalise to null, so a parsed value is
// itself valid input (forms can send their parsed output straight to the API).
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// ─── Products ────────────────────────────────────────────────────────────────

export const productInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(60),
  capacityLiters: z
    .string()
    .trim()
    .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Enter litres, e.g. 20')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  depositAmount: moneySchema().default('0'),
  isReturnable: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type ProductInput = z.input<typeof productInputSchema>;

export interface ProductDto {
  id: string;
  name: string;
  capacityLiters: string | null;
  depositAmount: string;
  isReturnable: boolean;
  active: boolean;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

const optionalPhone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || undefined)
  .pipe(phoneSchema.optional())
  .transform((v) => v ?? null);

/** The fields of a client. Refined below: an "Other" client needs its own label. */
export const storeFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the client name').max(80),
  category: z.enum(CLIENT_CATEGORIES).default('STORE'),
  categoryOther: optionalText(40),
  ownerName: optionalText(80),
  phone: optionalPhone,
  address: optionalText(200),
  notes: optionalText(500),
  creditLimit: moneySchema()
    .nullish()
    .or(z.literal('').transform(() => undefined))
    .transform((v) => v ?? null),
});

/** "Other" needs the owner's own word for it; any other type ignores that box. */
export function clientCategoryRule(v: { category?: ClientCategory; categoryOther?: string | null }, ctx: z.RefinementCtx): void {
  if (v.category === 'OTHER' && !v.categoryOther) {
    ctx.addIssue({ code: 'custom', message: 'Type what kind of client this is', path: ['categoryOther'] });
  }
}

export const storeInputSchema = storeFieldsSchema.superRefine(clientCategoryRule);
export type StoreInput = z.input<typeof storeInputSchema>;

// ─── Store prices ────────────────────────────────────────────────────────────

/** What one store pays for one product. Every store has its own price; there is no list price. */
export const storePriceSchema = z.object({
  productId: z.string().min(1),
  price: moneySchema({ allowZero: false }),
});
export interface StorePriceDto {
  productId: string;
  price: string;
}

const pricesSchema = z
  .array(storePriceSchema)
  .max(20)
  .refine((prices) => new Set(prices.map((p) => p.productId)).size === prices.length, 'Each product can only have one price');

/** Changing a store's prices later (only future sales are affected). */
export const storePricesSchema = z.object({ prices: pricesSchema.min(1) });
export type StorePricesInput = z.input<typeof storePricesSchema>;

/** Creating a store can also bring over balances from a paper notebook. */
export const createStoreFieldsSchema = storeFieldsSchema.extend({
  /** This store's price for each product that is on sale. */
  prices: pricesSchema,
  /** Money the store already owes (negative = advance paid). */
  openingBalance: moneySchema({ allowNegative: true })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Cans already sitting at the store. */
  openingCans: z
    .array(z.object({ productId: z.string().min(1), quantity: quantitySchema }))
    .max(20)
    .default([]),
});
export const createStoreSchema = createStoreFieldsSchema.superRefine(clientCategoryRule);
export type CreateStoreInput = z.input<typeof createStoreSchema>;

export const storeStatusSchema = z.object({ status: z.enum(STORE_STATUSES) });

export interface StoreCans {
  productId: string;
  productName: string;
  quantity: number;
}

export interface StoreListItem {
  id: string;
  name: string;
  category: ClientCategory;
  /** The owner's own label when category is OTHER. */
  categoryOther: string | null;
  ownerName: string | null;
  phone: string | null;
  status: StoreStatus;
  /** Positive = store owes the supplier. */
  balance: string;
  cansOutstanding: number;
  lastDeliveryAt: string | null;
  /** This store's price for each product; a product missing here has no price yet. */
  prices: StorePriceDto[];
}

export interface StoreDetail extends StoreListItem {
  address: string | null;
  notes: string | null;
  creditLimit: string | null;
  cans: StoreCans[];
  /** Items of the last delivery, used to prefill the next order. */
  lastOrderItems: { productId: string; quantity: number }[];
  hasLogin: boolean;
  /** Phone the store logs in with, when app access is on. */
  loginPhone: string | null;
  createdAt: string;
}
