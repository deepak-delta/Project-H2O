import { fromMinor, type OrderDto, type OrderListItem, type PaymentStatus } from '@wd/shared';
import type { Db } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { decToMinor, decToString } from '../../lib/money';
import type { Prisma } from '../../generated/prisma/client';

export const orderDetailInclude = {
  store: { select: { name: true } },
  assignedTo: { select: { id: true, name: true } },
  items: { include: { product: { select: { name: true } } } },
  deliveries: { include: { items: true }, orderBy: { deliveredAt: 'asc' } },
  payments: { orderBy: { paymentDate: 'asc' } },
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export function paymentStatusFor(totalMinor: number, paidMinor: number): PaymentStatus {
  if (paidMinor >= totalMinor) return 'PAID';
  return paidMinor > 0 ? 'PARTIAL' : 'UNPAID';
}

/** Money paid against an order, capped at its total (extra went to older dues). */
export function paidTowardsOrder(
  totalMinor: number,
  payments: { amount: Prisma.Decimal; reversedAt: Date | null }[],
): number {
  const paid = payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + decToMinor(p.amount), 0);
  return Math.min(paid, totalMinor);
}

export function toOrderDto(o: OrderRow): OrderDto {
  const totalMinor = decToMinor(o.total);
  const paidMinor = paidTowardsOrder(totalMinor, o.payments);

  const delivered = new Map<string, { delivered: number; empty: number }>();
  for (const d of o.deliveries) {
    for (const i of d.items) {
      const acc = delivered.get(i.productId) ?? { delivered: 0, empty: 0 };
      acc.delivered += i.deliveredQty;
      acc.empty += i.emptyCollected;
      delivered.set(i.productId, acc);
    }
  }

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    storeId: o.storeId,
    storeName: o.store.name,
    status: o.status,
    source: o.source,
    orderDate: o.orderDate.toISOString(),
    deliveryDate: o.deliveryDate?.toISOString() ?? null,
    deliveredAt: o.deliveries.at(-1)?.deliveredAt.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelReason: o.cancelReason,
    subtotal: decToString(o.subtotal),
    discount: decToString(o.discount),
    total: decToString(o.total),
    amountPaid: fromMinor(paidMinor),
    creditAmount: fromMinor(totalMinor - paidMinor),
    paymentStatus: paymentStatusFor(totalMinor, paidMinor),
    notes: o.notes,
    items: o.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      quantity: i.quantity,
      unitPrice: decToString(i.unitPrice),
      lineTotal: decToString(i.lineTotal),
      delivered: delivered.get(i.productId)?.delivered ?? 0,
      emptyCollected: delivered.get(i.productId)?.empty ?? 0,
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      amount: decToString(p.amount),
      method: p.method,
      paymentDate: p.paymentDate.toISOString(),
      reversed: p.reversedAt !== null,
    })),
    stockWarning: o.deliveries.some((d) => d.stockWarning),
    assignedTo: o.assignedTo,
  };
}

export async function loadOrderDto(
  db: Db,
  scope: { supplierId: string; storeId?: string },
  orderId: string,
): Promise<OrderDto> {
  const order = await db.order.findFirst({ where: { id: orderId, ...scope }, include: orderDetailInclude });
  if (!order) throw notFound('Order');
  return toOrderDto(order);
}

export const orderListInclude = {
  store: { select: { name: true } },
  assignedTo: { select: { id: true, name: true } },
  items: { select: { quantity: true } },
  payments: { select: { amount: true, reversedAt: true } },
} as const satisfies Prisma.OrderInclude;

type OrderListRow = Prisma.OrderGetPayload<{ include: typeof orderListInclude }>;

export function toOrderListItem(o: OrderListRow): OrderListItem {
  const totalMinor = decToMinor(o.total);
  const paidMinor = paidTowardsOrder(totalMinor, o.payments);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    storeId: o.storeId,
    storeName: o.store.name,
    status: o.status,
    source: o.source,
    orderDate: o.orderDate.toISOString(),
    deliveryDate: o.deliveryDate?.toISOString() ?? null,
    total: decToString(o.total),
    amountPaid: fromMinor(paidMinor),
    paymentStatus: paymentStatusFor(totalMinor, paidMinor),
    totalQuantity: o.items.reduce((sum, i) => sum + i.quantity, 0),
    assignedTo: o.assignedTo,
  };
}
