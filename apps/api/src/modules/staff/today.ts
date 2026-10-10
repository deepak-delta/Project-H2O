import { fromMinor, PAYMENT_METHODS, zonedDateKey, zonedDayRange, type PaymentMethod, type StaffActivity, type StaffTodayDto } from '@wd/shared';
import { getBusinessSettings } from '../../lib/business';
import type { Db } from '../../lib/db';
import { decToMinor, sqlSumToMinor } from '../../lib/money';
import { orderListInclude, toOrderListItem } from '../orders/order-dto';

const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED'] as const;

type DayRange = { start: Date; end: Date };
type StaffTotals = Pick<StaffTodayDto, 'deliveries' | 'cansDelivered' | 'emptiesCollected' | 'sales' | 'collected' | 'expenses' | 'cashInHand'>;

/**
 * One member of staff's totals for a day, as SQL sums over the rows they recorded themselves.
 * The owner's staff list needs only these, so it skips the activity lists.
 */
export async function staffDayTotals(db: Db, supplierId: string, staffId: string, day: DayRange): Promise<StaffTotals> {
  const inDay = { gte: day.start, lt: day.end };
  const mine = { supplierId, createdById: staffId };
  const [totals, byMethodRows, standaloneEmpties, spent] = await Promise.all([
    db.$queryRaw<{ deliveries: bigint; cans: bigint | null; empties: bigint | null; sales: unknown }[]>`
      SELECT COUNT(DISTINCT d.id) AS deliveries,
             SUM(di."deliveredQty") AS cans,
             SUM(di."emptyCollected") AS empties,
             COALESCE(SUM(di."deliveredQty" * oi."unitPrice"), 0) + COALESCE(SUM(di."damageCharge"), 0) AS sales
      FROM "Delivery" d
      JOIN "DeliveryItem" di ON di."deliveryId" = d.id
      LEFT JOIN "OrderItem" oi ON oi."orderId" = d."orderId" AND oi."productId" = di."productId"
      WHERE d."supplierId" = ${supplierId} AND d."deliveredById" = ${staffId}
        AND d."deliveredAt" >= ${day.start} AND d."deliveredAt" < ${day.end}`,
    db.payment.groupBy({ by: ['method'], where: { ...mine, paymentDate: inDay, reversedAt: null }, _sum: { amount: true } }),
    db.inventoryMovement.aggregate({ where: { ...mine, type: 'RETURN', deliveryId: null, occurredAt: inDay }, _sum: { emptyDelta: true } }),
    db.cashFlowEntry.groupBy({
      by: ['method'],
      where: { ...mine, type: 'EXPENSE', date: inDay, reversesId: null, reversedBy: { is: null } },
      _sum: { amount: true },
    }),
  ]);

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
  for (const r of byMethodRows) byMethod[r.method] = decToMinor(r._sum.amount);
  const collected = Object.values(byMethod).reduce((s, v) => s + v, 0);
  const spentTotal = spent.reduce((s, r) => s + decToMinor(r._sum.amount), 0);
  const cashSpent = decToMinor(spent.find((r) => r.method === 'CASH')?._sum.amount ?? null);
  const t = totals[0];

  return {
    deliveries: Number(t?.deliveries ?? 0),
    cansDelivered: Number(t?.cans ?? 0),
    emptiesCollected: Number(t?.empties ?? 0) + (standaloneEmpties._sum.emptyDelta ?? 0),
    sales: fromMinor(sqlSumToMinor(t?.sales)),
    collected: {
      total: fromMinor(collected),
      byMethod: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, fromMinor(byMethod[m])])) as Record<PaymentMethod, string>,
    },
    expenses: fromMinor(spentTotal),
    cashInHand: fromMinor(byMethod.CASH - cashSpent),
  };
}

/**
 * One member of staff's work for today (business timezone): deliveries, money taken, expenses,
 * and the cash they should be holding. Everything is filtered to rows they recorded themselves.
 */
export async function staffToday(db: Db, supplierId: string, staff: { id: string; name: string }): Promise<StaffTodayDto> {
  const { timezone } = await getBusinessSettings(db, supplierId);
  const today = zonedDayRange(timezone);
  const inToday = { gte: today.start, lt: today.end };
  const mine = { supplierId, createdById: staff.id };
  /** Totals come from SQL sums; only the latest entries are loaded for the activity list. */
  const RECENT = 100;

  const [totals, deliveries, payments, returns, expenses, assigned] = await Promise.all([
    staffDayTotals(db, supplierId, staff.id, today),
    db.delivery.findMany({
      where: { supplierId, deliveredById: staff.id, deliveredAt: inToday },
      include: {
        items: { select: { productId: true, deliveredQty: true, emptyCollected: true, damageCharge: true } },
        order: { select: { id: true, orderNumber: true, items: { select: { productId: true, unitPrice: true } } } },
        store: { select: { name: true } },
      },
      orderBy: { deliveredAt: 'desc' },
      take: RECENT,
    }),
    db.payment.findMany({
      where: { ...mine, paymentDate: inToday, reversedAt: null, orderId: null },
      include: { store: { select: { name: true } } },
      orderBy: { paymentDate: 'desc' },
      take: RECENT,
    }),
    db.inventoryMovement.findMany({
      where: { ...mine, type: 'RETURN', deliveryId: null, occurredAt: inToday },
      include: { store: { select: { name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: RECENT,
    }),
    db.cashFlowEntry.findMany({
      where: { ...mine, type: 'EXPENSE', date: inToday, reversesId: null, reversedBy: { is: null } },
      orderBy: { date: 'desc' },
      take: RECENT,
    }),
    db.order.findMany({
      where: { supplierId, assignedToId: staff.id, status: { in: [...OPEN] }, OR: [{ deliveryDate: null }, { deliveryDate: { lt: today.end } }] },
      include: orderListInclude,
      orderBy: [{ deliveryDate: 'asc' }, { orderDate: 'asc' }],
      take: RECENT,
    }),
  ]);

  const activity: StaffActivity[] = [];
  for (const d of deliveries) {
    const price = new Map(d.order.items.map((i) => [i.productId, decToMinor(i.unitPrice)]));
    activity.push({
      kind: 'DELIVERY',
      id: d.id,
      at: d.deliveredAt.toISOString(),
      orderId: d.order.id,
      orderNumber: d.order.orderNumber,
      storeName: d.store.name,
      cans: d.items.reduce((s, i) => s + i.deliveredQty, 0),
      empties: d.items.reduce((s, i) => s + i.emptyCollected, 0),
      amount: fromMinor(d.items.reduce((s, i) => s + i.deliveredQty * (price.get(i.productId) ?? 0) + decToMinor(i.damageCharge), 0)),
    });
  }
  // A return of several products is saved as one movement per product: show it as one entry.
  const returnGroups = new Map<string, { id: string; at: Date; storeName: string; cans: number }>();
  for (const r of returns) {
    const key = r.clientId ?? r.id;
    const group = returnGroups.get(key) ?? { id: r.id, at: r.occurredAt, storeName: r.store?.name ?? '', cans: 0 };
    group.cans += r.emptyDelta;
    returnGroups.set(key, group);
  }
  for (const g of returnGroups.values()) activity.push({ kind: 'EMPTIES', id: g.id, at: g.at.toISOString(), storeName: g.storeName, cans: g.cans });
  for (const p of payments) {
    activity.push({ kind: 'PAYMENT', id: p.id, at: p.paymentDate.toISOString(), storeName: p.store.name, amount: fromMinor(decToMinor(p.amount)), method: p.method });
  }
  for (const e of expenses) {
    activity.push({
      kind: 'EXPENSE',
      id: e.id,
      at: e.date.toISOString(),
      category: e.category,
      description: e.description,
      amount: fromMinor(decToMinor(e.amount)),
      method: e.method,
    });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  return {
    staff,
    date: zonedDateKey(new Date(), timezone),
    ...totals,
    assignedOrders: assigned.map(toOrderListItem),
    activity: activity.slice(0, RECENT),
  };
}
