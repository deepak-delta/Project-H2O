import { fromMinor, type DuesBreakdown } from '@wd/shared';
import type { Db } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { decToMinor, sqlSumToMinor } from '../../lib/money';
import { Prisma } from '../../generated/prisma/client';

/** More lines than any reminder shows; anything older is added to the brought-forward amount. */
const MAX_ORDERS = 200;
const MAX_CREDITS = 50;

interface OrderTotals {
  orderId: string;
  orderNumber: number;
  at: Date;
  billed: number;
  paid: number;
}

/**
 * A client's balance, order by order. Starts from the last moment their account stood at zero
 * or in advance, so settled history is left out. After that, every ledger entry lands in exactly
 * one place: an order's bill, a payment for that order, a payment not tied to an order, or
 * "brought forward" (opening balance, adjustments, the advance at the start). So the lines
 * always add up to the balance, and no order's money is used to cover another order.
 */
export async function duesBreakdown(db: Db, supplierId: string, storeId: string): Promise<DuesBreakdown> {
  const store = await db.store.findFirst({
    where: { id: storeId, supplierId },
    select: { id: true, name: true, phone: true, totals: { select: { balance: true } } },
  });
  if (!store) throw notFound('Client');
  const balance = decToMinor(store.totals?.balance ?? null);
  const base = { storeId: store.id, storeName: store.name, phone: store.phone, balance: fromMinor(balance) };
  if (balance <= 0) return { ...base, broughtForward: '0.00', orders: [], credits: [] };

  // Running balance per moment (one delivery's entries share a moment, so a sale paid in full at
  // the door never looks owed). The last moment at or below zero is where settled history ends.
  const [cut] = await db.$queryRaw<{ at: Date | null; bal: unknown }[]>`
    WITH moments AS (
      SELECT "occurredAt" AS at, SUM(amount) AS delta FROM "LedgerEntry"
      WHERE "supplierId" = ${supplierId} AND "storeId" = ${storeId}
      GROUP BY "occurredAt"
    ), running AS (SELECT at, SUM(delta) OVER (ORDER BY at) AS bal FROM moments)
    SELECT at, bal FROM running WHERE bal <= 0 ORDER BY at DESC LIMIT 1`;
  const since = cut?.at ?? null;

  const entries = await db.$queryRaw<
    { type: string; amount: unknown; at: Date; orderId: string | null; orderNumber: number | null; paymentId: string | null }[]
  >`
    SELECT l.type, l.amount, l."occurredAt" AS at, l."orderId", o."orderNumber", l."paymentId"
    FROM "LedgerEntry" l LEFT JOIN "Order" o ON o.id = l."orderId"
    WHERE l."supplierId" = ${supplierId} AND l."storeId" = ${storeId}
      ${since ? Prisma.sql`AND l."occurredAt" > ${since}` : Prisma.empty}
    ORDER BY l."occurredAt", l.id`;

  let broughtForward = sqlSumToMinor(cut?.bal ?? null);
  const orders = new Map<string, OrderTotals>();
  const loose = new Map<string, { at: Date; amount: number }>();
  const orderOf = (e: (typeof entries)[number]): OrderTotals => {
    let o = orders.get(e.orderId!);
    if (!o) orders.set(e.orderId!, (o = { orderId: e.orderId!, orderNumber: e.orderNumber!, at: e.at, billed: 0, paid: 0 }));
    return o;
  };
  for (const e of entries) {
    const amount = sqlSumToMinor(e.amount);
    if (e.paymentId) {
      // A payment, or the undoing of one: counts for its own order, or on its own line.
      if (e.orderId) orderOf(e).paid -= amount;
      else {
        const p = loose.get(e.paymentId) ?? { at: e.at, amount: 0 };
        p.amount -= amount;
        loose.set(e.paymentId, p);
      }
    } else if (e.orderId && (e.type === 'SALE' || e.type === 'DISCOUNT' || e.type === 'REVERSAL')) {
      const o = orderOf(e);
      if (e.type === 'SALE' && o.billed === 0) o.at = e.at;
      o.billed += amount;
    } else {
      broughtForward += amount;
    }
  }

  const all = [...orders.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.orderNumber - b.orderNumber);
  let unpaid = all.filter((o) => o.billed > o.paid);
  let credits = [
    ...[...loose.values()].filter((p) => p.amount !== 0).map((p) => ({ kind: 'PAYMENT' as const, at: p.at, amount: p.amount, orderNumber: null })),
    ...all.filter((o) => o.paid > o.billed).map((o) => ({ kind: 'EXTRA' as const, at: o.at, amount: o.paid - o.billed, orderNumber: o.orderNumber })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  // Very long histories: the oldest lines go into the brought-forward amount.
  if (unpaid.length > MAX_ORDERS) {
    for (const o of unpaid.slice(0, unpaid.length - MAX_ORDERS)) broughtForward += o.billed - o.paid;
    unpaid = unpaid.slice(-MAX_ORDERS);
  }
  if (credits.length > MAX_CREDITS) {
    for (const c of credits.slice(0, credits.length - MAX_CREDITS)) broughtForward -= c.amount;
    credits = credits.slice(-MAX_CREDITS);
  }

  const cans = unpaid.length
    ? await db.$queryRaw<{ orderId: string; cans: unknown }[]>`
        SELECT d."orderId", SUM(di."deliveredQty") AS cans
        FROM "Delivery" d JOIN "DeliveryItem" di ON di."deliveryId" = d.id
        WHERE d."orderId" IN (${Prisma.join(unpaid.map((o) => o.orderId))})
        GROUP BY d."orderId"`
    : [];
  const cansBy = new Map(cans.map((c) => [c.orderId, Number(c.cans)]));

  return {
    ...base,
    broughtForward: fromMinor(broughtForward),
    orders: unpaid.map((o) => ({
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      date: o.at.toISOString(),
      cans: cansBy.get(o.orderId) ?? 0,
      billed: fromMinor(o.billed),
      paid: fromMinor(o.paid),
      due: fromMinor(o.billed - o.paid),
    })),
    credits: credits.map((c) => ({ kind: c.kind, date: c.at.toISOString(), amount: fromMinor(c.amount), orderNumber: c.orderNumber })),
  };
}
