import { fromMinor, type DuesBreakdown } from '@wd/shared';
import type { Db } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { decToMinor, sqlSumToMinor } from '../../lib/money';
import { Prisma } from '../../generated/prisma/client';

/** Enough bills to cover any realistic balance; anything older is shown as brought forward. */
const MAX_BILLS = 200;

/**
 * A client's balance split into the bills still unpaid. Payments are counted against the oldest
 * bills first (like a notebook), so walking back from the newest bill until the balance is
 * covered gives exactly what is still owed; the oldest bill reached may be partly paid.
 */
export async function duesBreakdown(db: Db, supplierId: string, storeId: string): Promise<DuesBreakdown> {
  const store = await db.store.findFirst({
    where: { id: storeId, supplierId },
    select: { id: true, name: true, phone: true, totals: { select: { balance: true } } },
  });
  if (!store) throw notFound('Client');
  const balance = decToMinor(store.totals?.balance ?? null);
  const base = { storeId: store.id, storeName: store.name, phone: store.phone, balance: fromMinor(balance) };
  if (balance <= 0) return { ...base, broughtForward: '0.00', items: [] };

  // Each order's bill: sales and discounts, less sales undone by a cancellation.
  const bills = await db.$queryRaw<{ orderId: string; orderNumber: number; at: Date; billed: unknown }[]>`
    SELECT o.id AS "orderId", o."orderNumber", MAX(l."occurredAt") AS at, SUM(l.amount) AS billed
    FROM "LedgerEntry" l JOIN "Order" o ON o.id = l."orderId"
    WHERE l."supplierId" = ${supplierId} AND l."storeId" = ${storeId}
      AND (l.type IN ('SALE', 'DISCOUNT') OR (l.type = 'REVERSAL' AND l."paymentId" IS NULL))
    GROUP BY o.id, o."orderNumber"
    HAVING SUM(l.amount) > 0
    ORDER BY at DESC, o."orderNumber" DESC
    LIMIT ${MAX_BILLS}`;

  let remaining = balance;
  const unpaid: { orderId: string; orderNumber: number; at: Date; billed: number; due: number }[] = [];
  for (const b of bills) {
    if (remaining <= 0) break;
    const billed = sqlSumToMinor(b.billed);
    const due = Math.min(billed, remaining);
    unpaid.push({ orderId: b.orderId, orderNumber: b.orderNumber, at: b.at, billed, due });
    remaining -= due;
  }

  const cans = unpaid.length
    ? await db.$queryRaw<{ orderId: string; cans: unknown }[]>`
        SELECT d."orderId", SUM(di."deliveredQty") AS cans
        FROM "Delivery" d JOIN "DeliveryItem" di ON di."deliveryId" = d.id
        WHERE d."orderId" IN (${Prisma.join(unpaid.map((u) => u.orderId))})
        GROUP BY d."orderId"`
    : [];
  const cansBy = new Map(cans.map((c) => [c.orderId, Number(c.cans)]));

  return {
    ...base,
    broughtForward: fromMinor(Math.max(0, remaining)),
    items: unpaid.reverse().map((u) => ({
      orderId: u.orderId,
      orderNumber: u.orderNumber,
      date: u.at.toISOString(),
      cans: cansBy.get(u.orderId) ?? 0,
      billed: fromMinor(u.billed),
      due: fromMinor(u.due),
    })),
  };
}
