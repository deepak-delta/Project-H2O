import { formatMoney, LOW_STOCK_FILLED_CANS, toMinor, type MovementDto, type OrderDto } from '@wd/shared';
import type { Db } from '../../lib/db';
import { stockByProduct } from '../inventory/stock';
import type { Notifier } from './notifier';

/**
 * What each business event tells whom. Called only after the event has been saved, and only
 * for first-time requests (a retried, de-duplicated request does not notify twice).
 */

async function business(db: Db, supplierId: string) {
  return db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { businessName: true, currency: true, timezone: true } });
}

const cans = (n: number) => `${n} can${n === 1 ? '' : 's'}`;
const delivered = (o: OrderDto) => o.items.reduce((s, i) => s + i.delivered, 0);
const ordered = (o: OrderDto) => o.items.reduce((s, i) => s + i.quantity, 0);

function balanceText(balance: string, currency: string): string {
  const minor = toMinor(balance);
  if (minor > 0) return `You owe ${formatMoney(balance, currency)}`;
  if (minor < 0) return `Advance ${formatMoney(balance.replace('-', ''), currency)}`;
  return 'Nothing due';
}

/** Store placed an order → supplier. */
export async function orderPlaced(db: Db, n: Notifier, supplierId: string, order: OrderDto): Promise<void> {
  const { timezone } = await business(db, supplierId);
  const when = order.deliveryDate
    ? ` for ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: timezone }).format(new Date(order.deliveryDate))}`
    : '';
  await n.toSupplier(supplierId, {
    title: `New order · ${order.storeName}`,
    body: `${cans(ordered(order))}${when}${order.notes ? ` — “${order.notes}”` : ''}`,
    url: `/orders/${order.id}`,
    tag: `order-${order.id}`,
  });
}

/** Supplier accepted / sent out an order → store. */
export async function orderStatusChanged(n: Notifier, order: OrderDto): Promise<void> {
  const title = order.status === 'CONFIRMED' ? 'Order accepted' : 'Your water is on the way';
  await n.toStore(order.storeId, {
    title,
    body: `Order #${order.orderNumber} · ${cans(ordered(order))}`,
    url: `/orders/${order.id}`,
    tag: `order-${order.id}`,
  });
}

/**
 * Cans delivered (quick sale or a placed order) → store, and the owner unless they delivered it
 * themselves; plus a low-stock check for the supplier.
 */
export async function orderDelivered(
  db: Db,
  n: Notifier,
  supplierId: string,
  order: OrderDto,
  storeBalance: string,
  deliveredNow: { productId: string; quantity: number }[],
  deliveredById: string,
): Promise<void> {
  const biz = await business(db, supplierId);
  const empties = order.items.reduce((s, i) => s + i.emptyCollected, 0);
  const damaged = order.items.reduce((s, i) => s + i.damagedCollected, 0);
  await n.toStore(order.storeId, {
    title: order.status === 'PARTIALLY_DELIVERED' ? `Part of order #${order.orderNumber} delivered` : `Delivered: ${cans(delivered(order))}`,
    body: [
      `Bill ${formatMoney(order.total, biz.currency)}`,
      toMinor(order.amountPaid) > 0 ? `paid ${formatMoney(order.amountPaid, biz.currency)}` : null,
      empties ? `${empties} empties collected` : null,
      toMinor(order.damageCharge) > 0 ? `${damaged} damaged can${damaged === 1 ? '' : 's'} charged ${formatMoney(order.damageCharge, biz.currency)}` : null,
      balanceText(storeBalance, biz.currency),
    ]
      .filter(Boolean)
      .join(' · '),
    url: `/orders/${order.id}`,
    tag: `order-${order.id}`,
  });
  const deliverer = await db.user.findUnique({ where: { id: deliveredById }, select: { name: true } });
  const paid = toMinor(order.amountPaid) > 0;
  await n.toSupplier(
    supplierId,
    {
      title: `${order.status === 'PARTIALLY_DELIVERED' ? 'Part delivered' : 'Delivered'} · ${order.storeName}`,
      body: [
        `${cans(deliveredNow.reduce((s, d) => s + d.quantity, 0))}${deliverer ? ` by ${deliverer.name}` : ''}`,
        `Bill ${formatMoney(order.total, biz.currency)}`,
        paid ? `paid ${formatMoney(order.amountPaid, biz.currency)}` : 'on credit',
      ].join(' · '),
      url: `/orders/${order.id}`,
      tag: `order-${order.id}`,
    },
    deliveredById,
  );
  await lowStockCheck(db, n, supplierId, deliveredNow);
}

/** Warn once, when filled stock crosses below the threshold (not on every later delivery). */
async function lowStockCheck(db: Db, n: Notifier, supplierId: string, deliveredNow: { productId: string; quantity: number }[]) {
  const returnable = await db.product.findMany({ where: { supplierId, isReturnable: true }, select: { id: true } });
  if (returnable.length === 0) return;
  const ids = new Set(returnable.map((p) => p.id));
  const stock = await stockByProduct(db, supplierId, [...ids]);
  const after = [...stock.values()].reduce((s, l) => s + l.filled, 0);
  const before = after + deliveredNow.filter((d) => ids.has(d.productId)).reduce((s, d) => s + d.quantity, 0);
  if (after < LOW_STOCK_FILLED_CANS && before >= LOW_STOCK_FILLED_CANS) {
    await n.toSupplier(supplierId, {
      title: 'Running low on filled cans',
      body: `Only ${Math.max(after, 0)} filled cans left. Refill or add stock.`,
      url: '/inventory',
      tag: 'low-stock',
    });
  }
}

/** Payment recorded against the store's balance → store. */
export async function paymentRecorded(db: Db, n: Notifier, supplierId: string, storeId: string, amount: string, storeBalance: string) {
  const biz = await business(db, supplierId);
  await n.toStore(storeId, {
    title: `Payment received: ${formatMoney(amount, biz.currency)}`,
    body: `${balanceText(storeBalance, biz.currency)} · ${biz.businessName}`,
    url: '/statement',
  });
}

/** A payment was undone → store (their balance went up). */
export async function paymentReversed(db: Db, n: Notifier, supplierId: string, storeId: string, amount: string, storeBalance: string) {
  const biz = await business(db, supplierId);
  await n.toStore(storeId, {
    title: `Payment of ${formatMoney(amount, biz.currency)} was reversed`,
    body: `${balanceText(storeBalance, biz.currency)} · Contact ${biz.businessName} if this is wrong.`,
    url: '/statement',
  });
}

/** Cancellation → whoever didn't cancel it. */
export async function orderCancelled(n: Notifier, supplierId: string, order: OrderDto, byStore: boolean): Promise<void> {
  if (byStore) {
    await n.toSupplier(supplierId, {
      title: `Order #${order.orderNumber} cancelled by ${order.storeName}`,
      body: cans(ordered(order)),
      url: `/orders/${order.id}`,
      tag: `order-${order.id}`,
    });
  } else {
    await n.toStore(order.storeId, {
      title: `Order #${order.orderNumber} was cancelled`,
      body: order.cancelReason ?? 'Contact your supplier for details.',
      url: `/orders/${order.id}`,
      tag: `order-${order.id}`,
    });
  }
}

/** Supplier taps "Send reminder" → store. Returns how many devices were reached. */
export async function paymentReminder(db: Db, n: Notifier, supplierId: string, storeId: string, balance: string): Promise<number> {
  const biz = await business(db, supplierId);
  return n.toStore(storeId, {
    title: `Payment reminder from ${biz.businessName}`,
    body: `Your balance is ${formatMoney(balance, biz.currency)}. Please pay when convenient. Thank you!`,
    url: '/statement',
    tag: 'payment-reminder',
  });
}

/** A member of staff corrected stock or marked cans damaged/lost → the owner. */
export async function stockChangedByStaff(n: Notifier, supplierId: string, m: MovementDto): Promise<void> {
  const parts = [
    m.filledDelta ? `filled ${m.filledDelta > 0 ? '+' : ''}${m.filledDelta}` : null,
    m.emptyDelta ? `empty ${m.emptyDelta > 0 ? '+' : ''}${m.emptyDelta}` : null,
    m.damagedDelta ? `damaged ${m.damagedDelta > 0 ? '+' : ''}${m.damagedDelta}` : null,
  ].filter(Boolean);
  const what = m.type === 'ADJUSTMENT' ? 'corrected the stock count' : m.type === 'DAMAGE' ? 'marked cans damaged' : 'marked cans lost';
  await n.toSupplier(supplierId, {
    title: `${m.createdByName} ${what}`,
    body: [`${m.productName}: ${parts.join(', ') || 'no change'}`, m.reason].filter(Boolean).join(' · '),
    url: '/inventory',
    tag: `stock-${m.id}`,
  });
}

/** Owner gave several orders to a member of staff at once → one summary for them. */
export async function ordersAssigned(n: Notifier, staffId: string, orders: { storeName: string; totalQuantity: number }[]): Promise<void> {
  const names = [...new Set(orders.map((o) => o.storeName))];
  await n.toUser(staffId, {
    title: `New deliveries: ${orders.length} orders`,
    body: `${cans(orders.reduce((s, o) => s + o.totalQuantity, 0))} · ${names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`}`,
    url: '/',
    tag: 'orders-assigned',
  });
}

/** Owner gave an order to a member of staff → that staff member. */
export async function orderAssigned(n: Notifier, staffId: string, order: OrderDto): Promise<void> {
  await n.toUser(staffId, {
    title: `New delivery · ${order.storeName}`,
    body: `Order #${order.orderNumber} · ${cans(ordered(order))}${order.notes ? ` — “${order.notes}”` : ''}`,
    url: `/orders/${order.id}`,
    tag: `order-${order.id}`,
  });
}
