import { zonedDayRange } from '@wd/shared';
import type { StaffContext } from '../../lib/auth-context';
import { getBusinessSettings } from '../../lib/business';
import type { Db, Tx } from '../../lib/db';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Delivery staff see only their own work for the current business day. At midnight (business
 * timezone) the window moves on and yesterday's work drops out of everything they can see; the
 * owner still sees it all.
 */

const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED'] as const;

export async function businessToday(db: Db | Tx, supplierId: string): Promise<{ start: Date; end: Date }> {
  const { timezone } = await getBusinessSettings(db, supplierId);
  return zonedDayRange(timezone);
}

/**
 * Orders a member of staff may see: open orders the owner gave them (due today or earlier, or
 * with no date), and orders they created or delivered today.
 */
export function staffOrderWhere(auth: StaffContext, today: { start: Date; end: Date }): Prisma.OrderWhereInput {
  const inToday = { gte: today.start, lt: today.end };
  return {
    supplierId: auth.supplierId,
    OR: [
      {
        assignedToId: auth.userId,
        status: { in: [...OPEN] },
        OR: [{ deliveryDate: null }, { deliveryDate: { lt: today.end } }],
      },
      { createdById: auth.userId, orderDate: inToday },
      { deliveries: { some: { deliveredById: auth.userId, deliveredAt: inToday } } },
    ],
  };
}

/** Payments a member of staff may see: the ones they took today. */
export function staffPaymentWhere(auth: StaffContext, today: { start: Date; end: Date }): Prisma.PaymentWhereInput {
  return { supplierId: auth.supplierId, createdById: auth.userId, paymentDate: { gte: today.start, lt: today.end } };
}
