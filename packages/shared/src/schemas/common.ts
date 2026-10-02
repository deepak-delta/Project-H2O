import { z } from 'zod';
import { isMoneyString, toMinor } from '../money';
import { normalizePhone } from '../phone';

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, 'PIN must be exactly 6 digits');

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter a phone number')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
      return z.NEVER;
    }
    return normalized;
  });

/** Money as a decimal string with at most 2 places. Non-negative unless `allowNegative`. */
export function moneySchema(options: { allowNegative?: boolean; allowZero?: boolean } = {}) {
  const { allowNegative = false, allowZero = true } = options;
  // Zod runs every refinement even after one fails, so later checks must not assume the value
  // parsed — toMinor() throws on bad input, which would surface as a crash instead of a message.
  return z
    .string()
    .trim()
    .refine(isMoneyString, { message: 'Enter a valid amount (max 2 decimal places)', abort: true })
    .refine((v) => !isMoneyString(v) || allowNegative || toMinor(v) >= 0, 'Amount cannot be negative')
    .refine((v) => !isMoneyString(v) || allowZero || toMinor(v) !== 0, 'Amount must be more than zero');
}

export const quantitySchema = z
  .number()
  .int('Quantity must be a whole number')
  .min(0, 'Quantity cannot be negative')
  .max(100000, 'Quantity is too large');

/** Client-generated idempotency key for every mutation that may be retried. */
export const clientIdSchema = z.uuid();

export const idSchema = z.string().min(1).max(64);

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * When something actually happened on the phone (ISO time). Sent by entries saved offline so
 * a 9am delivery synced at 6pm still counts at 9am. Omitted = now.
 */
export const occurredAtSchema = z.iso
  .datetime({ offset: true, message: 'Invalid time' })
  .nullish()
  .transform((v) => v ?? null);
