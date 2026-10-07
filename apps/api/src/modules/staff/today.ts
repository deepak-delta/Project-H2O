import { fromMinor, PAYMENT_METHODS, zonedDateKey, zonedDayRange, type PaymentMethod, type StaffActivity, type StaffTodayDto } from '@wd/shared';
import { getBusinessSettings } from '../../lib/business';
import type { Db } from '../../lib/db';
import { decToMinor } from '../../lib/money';
import { orderListInclude, toOrderListItem } from '../orders/order-dto';

const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED'] as const;

/**
 * One member of staff's work for today (business timezone): deliveries, money taken, expenses,
 * and the cash they should be holding. Everything is filtered to rows they recorded themselves.
 */
export async function staffToday(db: Db, supplierId: string, staff: { id: string; name: string }): Promise<StaffTodayDto> {
  const { timezone } = await getBusinessSettings(db, supplierId);
  const today = zonedDayRange(timezone);
  const inToday = { gte: today.start, lt: today.end };
  const mine = { supplierId, createdById: staff.id };

  const [deliveries, payments, returns, expenses, assigned] = await Promise.all([
    db.delivery.findMany({
      where: { supplierId, deliveredById: staff.id, deliveredAt: inToday },
      include: {
        items: { select: { productId: true, deliveredQty: true, emptyCollected: true } },
        order: { select: { id: true, orderNumber: true, items: { select: { productId: true, unitPrice: true } } } },
        store: { select: { name: true } },
      },
      orderBy: { deliveredAt: 'desc' },
    }),
    db.payment.findMany({
      where: { ...mine, paymentDate: inToday, reversedAt: null },
      include: { store: { select: { name: true } } },
      orderBy: { paymentDate: 'desc' },
    }),
    // Empties collected on their own (not as part of a delivery).
    db.inventoryMovement.findMany({
      where: { ...mine, type: 'RETURN', deliveryId: null, occurredAt: inToday },
      include: { store: { select: { name: true } } },
      orderBy: { occurredAt: 'desc' },
    }),
    db.cashFlowEntry.findMany({
      where: { ...mine, type: 'EXPENSE', date: inToday, reversesId: null, reversedBy: { is: null } },
      orderBy: { date: 'desc' },
    }),
    db.order.findMany({
      where: { supplierId, assignedToId: staff.id, status: { in: [...OPEN] }, OR: [{ deliveryDate: null }, { deliveryDate: { lt: today.end } }] },
      include: orderListInclude,
      orderBy: [{ deliveryDate: 'asc' }, { orderDate: 'asc' }],
    }),
  ]);

  const activity: StaffActivity[] = [];
  let sales = 0;
  let cansDelivered = 0;
  let emptiesCollected = 0;

  for (const d of deliveries) {
    const price = new Map(d.order.items.map((i) => [i.productId, decToMinor(i.unitPrice)]));
    const amount = d.items.reduce((s, i) => s + i.deliveredQty * (price.get(i.productId) ?? 0), 0);
    const cans = d.items.reduce((s, i) => s + i.deliveredQty, 0);
    const empties = d.items.reduce((s, i) => s + i.emptyCollected, 0);
    sales += amount;
    cansDelivered += cans;
    emptiesCollected += empties;
    activity.push({
      kind: 'DELIVERY',
      id: d.id,
      at: d.deliveredAt.toISOString(),
      orderId: d.order.id,
      orderNumber: d.order.orderNumber,
      storeName: d.store.name,
      cans,
      empties,
      amount: fromMinor(amount),
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
  for (const g of returnGroups.values()) {
    emptiesCollected += g.cans;
    activity.push({ kind: 'EMPTIES', id: g.id, at: g.at.toISOString(), storeName: g.storeName, cans: g.cans });
  }

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
  for (const p of payments) {
    byMethod[p.method] += decToMinor(p.amount);
    // Money taken at a delivery is part of that delivery's entry.
    if (!p.orderId) {
      activity.push({ kind: 'PAYMENT', id: p.id, at: p.paymentDate.toISOString(), storeName: p.store.name, amount: fromMinor(decToMinor(p.amount)), method: p.method });
    }
  }

  let spent = 0;
  let cashSpent = 0;
  for (const e of expenses) {
    const amount = decToMinor(e.amount);
    spent += amount;
    if (e.method === 'CASH') cashSpent += amount;
    activity.push({
      kind: 'EXPENSE',
      id: e.id,
      at: e.date.toISOString(),
      category: e.category,
      description: e.description,
      amount: fromMinor(amount),
      method: e.method,
    });
  }

  activity.sort((a, b) => b.at.localeCompare(a.at));
  const collected = Object.values(byMethod).reduce((s, v) => s + v, 0);

  return {
    staff,
    date: zonedDateKey(new Date(), timezone),
    deliveries: deliveries.length,
    cansDelivered,
    emptiesCollected,
    sales: fromMinor(sales),
    collected: {
      total: fromMinor(collected),
      byMethod: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, fromMinor(byMethod[m])])) as Record<PaymentMethod, string>,
    },
    expenses: fromMinor(spent),
    cashInHand: fromMinor(byMethod.CASH - cashSpent),
    assignedOrders: assigned.map(toOrderListItem),
    activity,
  };
}

