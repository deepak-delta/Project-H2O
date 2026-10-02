import {
  fromMinor,
  toMinor,
  zonedDayRangeForKey,
  type cancelOrderSchema,
  type deliverOrderSchema,
  type OrderDto,
  type placeOrderSchema,
  type QuickSaleResult,
} from '@wd/shared';
import type { z } from 'zod';
import type { AuthContext, SupplierContext } from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import { getBusinessSettings } from '../../lib/business';
import type { Db } from '../../lib/db';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { decToMinor, decToString, minorToDec } from '../../lib/money';
import { resolveOccurredAt } from '../../lib/occurred-at';
import { storeBalanceMinor } from '../ledger/balance';
import { reversePaymentInTx } from '../payments/reverse';
import { lockOrder, recordDelivery, settleOrderTotals } from './delivery';
import { loadOrderDto } from './order-dto';

const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const;
const isOpen = (status: string) => (OPEN as readonly string[]).includes(status);

/** A store asks for water (or the supplier notes a phone order). No money or stock moves yet. */
export async function placeOrder(db: Db, auth: AuthContext, input: z.output<typeof placeOrderSchema>): Promise<{ order: OrderDto; replayed: boolean }> {
  const storeId = auth.role === 'STORE' ? auth.storeId : input.storeId;
  if (!storeId) throw validationError('Choose a store.', { storeId: 'Choose a store' });

  const { result: orderId, replayed } = await idempotent(
    async () => (await db.order.findFirst({ where: { supplierId: auth.supplierId, clientId: input.clientId }, select: { id: true } }))?.id ?? null,
    () =>
      db.$transaction(async (tx) => {
        const store = await tx.store.findFirst({ where: { id: storeId, supplierId: auth.supplierId } });
        if (!store) throw notFound('Store');
        if (store.status !== 'ACTIVE') throw validationError('This store is inactive.');

        const items = input.items.filter((i) => i.quantity > 0);
        const products = await tx.product.findMany({
          where: { id: { in: items.map((i) => i.productId) }, supplierId: auth.supplierId, active: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        const lines = items.map((i) => {
          const product = byId.get(i.productId);
          if (!product) throw validationError('One of the products is no longer available. Please refresh.');
          const unitPrice = decToMinor(product.sellingPrice);
          return { productId: product.id, quantity: i.quantity, unitPrice, lineTotal: unitPrice * i.quantity };
        });
        const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

        let deliveryDate: Date | null = null;
        if (input.deliveryDate) {
          const { timezone } = await getBusinessSettings(tx, auth.supplierId);
          deliveryDate = zonedDayRangeForKey(input.deliveryDate, timezone).start;
        }

        const counter = await tx.supplier.update({
          where: { id: auth.supplierId },
          data: { nextOrderNumber: { increment: 1 } },
          select: { nextOrderNumber: true },
        });
        const order = await tx.order.create({
          data: {
            supplierId: auth.supplierId,
            storeId,
            orderNumber: counter.nextOrderNumber - 1,
            status: 'PENDING',
            source: auth.role === 'STORE' ? 'STORE' : 'SUPPLIER',
            orderDate: resolveOccurredAt(input.occurredAt),
            deliveryDate,
            // Estimated from today's prices; the bill is fixed only when cans are delivered.
            subtotal: minorToDec(subtotal),
            total: minorToDec(subtotal),
            notes: input.notes,
            clientId: input.clientId,
            createdById: auth.userId,
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                unitPrice: minorToDec(l.unitPrice),
                lineTotal: minorToDec(l.lineTotal),
              })),
            },
          },
        });
        return order.id;
      }),
  );
  return { order: await loadOrderDto(db, { supplierId: auth.supplierId }, orderId), replayed };
}

/** Delivers an open (or partly delivered) order: full or partial, with empties and payment. */
export async function deliverOrder(
  db: Db,
  auth: SupplierContext,
  orderId: string,
  input: z.output<typeof deliverOrderSchema>,
): Promise<QuickSaleResult> {
  const { result, replayed } = await idempotent(
    async () => (await db.delivery.findFirst({ where: { supplierId: auth.supplierId, clientId: input.clientId }, select: { orderId: true } }))?.orderId ?? null,
    () =>
      db.$transaction(
        async (tx) => {
          await lockOrder(tx, orderId);
          const order = await tx.order.findFirst({
            where: { id: orderId, supplierId: auth.supplierId },
            include: { items: { include: { product: true } }, store: true },
          });
          if (!order) throw notFound('Order');
          if (!isOpen(order.status) && order.status !== 'PARTIALLY_DELIVERED') {
            throw conflict(order.status === 'CANCELLED' ? 'This order was cancelled.' : 'This order is already delivered.');
          }
          if (order.store.status !== 'ACTIVE') throw validationError('This store is inactive. Reactivate it to record deliveries.');

          const itemByProduct = new Map(order.items.map((i) => [i.productId, i]));
          const lines = input.items.map((i) => {
            const item = itemByProduct.get(i.productId);
            if (!item) throw validationError('Only products in this order can be delivered. Use a new order for extra products.');
            // The price agreed when the order was placed.
            return { product: item.product, quantity: i.quantity, emptyCollected: i.emptyCollected, unitPrice: decToMinor(item.unitPrice) };
          });

          const now = resolveOccurredAt(input.occurredAt);
          const discount = toMinor(input.discount);
          await recordDelivery(tx, auth, {
            orderId: order.id,
            storeId: order.storeId,
            lines,
            discount,
            payment: { amount: toMinor(input.payment.amount), method: input.payment.method, referenceNumber: input.payment.referenceNumber ?? null },
            notes: input.notes,
            clientId: input.clientId,
            at: now,
          });
          await settleOrderTotals(tx, order.id, discount, now);
          return order.id;
        },
        { timeout: 15000 },
      ),
  );

  const order = await loadOrderDto(db, { supplierId: auth.supplierId }, result);
  const balance = await storeBalanceMinor(db, auth.supplierId, order.storeId);
  return { order, storeBalance: fromMinor(balance), replayed };
}

export async function changeOrderStatus(
  db: Db,
  auth: SupplierContext,
  orderId: string,
  status: 'CONFIRMED' | 'OUT_FOR_DELIVERY',
): Promise<OrderDto> {
  await db.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({ where: { id: orderId, supplierId: auth.supplierId } });
    if (!order) throw notFound('Order');
    const allowed = status === 'CONFIRMED' ? ['PENDING'] : ['PENDING', 'CONFIRMED'];
    if (order.status === status) return;
    if (!allowed.includes(order.status)) throw conflict('This order can no longer change to that status.');
    await tx.order.update({ where: { id: orderId }, data: { status } });
  });
  return loadOrderDto(db, { supplierId: auth.supplierId }, orderId);
}

/**
 * Cancels an order.
 *  - Not yet delivered: simply marked cancelled (stores may cancel their own pending orders).
 *  - Delivered (fully or partly): supplier only. Every stock movement and every sale/discount
 *    ledger entry gets an equal and opposite REVERSAL row; history is never deleted. Payments
 *    stay as credit for the store unless `refundPayments` is set, which reverses them too.
 */
export async function cancelOrder(
  db: Db,
  auth: AuthContext,
  orderId: string,
  input: z.output<typeof cancelOrderSchema>,
): Promise<OrderDto> {
  await db.$transaction(
    async (tx) => {
      await lockOrder(tx, orderId);
      const scope = auth.role === 'STORE' ? { supplierId: auth.supplierId, storeId: auth.storeId } : { supplierId: auth.supplierId };
      const order = await tx.order.findFirst({ where: { id: orderId, ...scope }, include: { deliveries: { select: { id: true } } } });
      if (!order) throw notFound('Order');
      if (order.status === 'CANCELLED') throw conflict('This order is already cancelled.');

      const delivered = order.deliveries.length > 0;
      if (auth.role === 'STORE' && (delivered || order.status !== 'PENDING')) {
        throw forbidden('Your supplier has already accepted this order. Please call them to change it.');
      }
      const now = new Date();

      if (delivered && auth.role === 'SUPPLIER') {
        const movements = await tx.inventoryMovement.findMany({
          where: { supplierId: auth.supplierId, orderId, type: { not: 'REVERSAL' }, reversedBy: null },
        });
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            supplierId: m.supplierId,
            productId: m.productId,
            storeId: m.storeId,
            orderId,
            deliveryId: m.deliveryId,
            type: 'REVERSAL' as const,
            filledDelta: -m.filledDelta,
            emptyDelta: -m.emptyDelta,
            withCustomersDelta: -m.withCustomersDelta,
            damagedDelta: -m.damagedDelta,
            reversesId: m.id,
            reason: `Order #${order.orderNumber} cancelled`,
            occurredAt: now,
            createdById: auth.userId,
          })),
        });

        const sales = await tx.ledgerEntry.findMany({
          where: { supplierId: auth.supplierId, orderId, type: { in: ['SALE', 'DISCOUNT'] }, reversedBy: null },
        });
        await tx.ledgerEntry.createMany({
          data: sales.map((e) => ({
            supplierId: e.supplierId,
            storeId: e.storeId,
            type: 'REVERSAL' as const,
            amount: minorToDec(-decToMinor(e.amount)),
            orderId,
            reversesId: e.id,
            note: input.reason ?? `Order #${order.orderNumber} cancelled`,
            occurredAt: now,
            createdById: auth.userId,
          })),
        });

        if (input.refundPayments) {
          const payments = await tx.payment.findMany({ where: { supplierId: auth.supplierId, orderId, reversedAt: null } });
          for (const p of payments) {
            await reversePaymentInTx(tx, auth, p.id, input.reason ?? `Refund for cancelled order #${order.orderNumber}`);
          }
        }
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: input.reason },
      });
      await audit(tx, {
        supplierId: auth.supplierId,
        actorId: auth.userId,
        action: delivered ? 'DELIVERED_ORDER_CANCELLED' : 'ORDER_CANCELLED',
        entity: 'Order',
        entityId: orderId,
        before: { status: order.status, total: decToString(order.total) },
        after: { status: 'CANCELLED', reason: input.reason, refundPayments: input.refundPayments },
      });
    },
    { timeout: 15000 },
  );
  return loadOrderDto(db, { supplierId: auth.supplierId }, orderId);
}
