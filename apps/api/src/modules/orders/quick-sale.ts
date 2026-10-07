import { fromMinor, toMinor, type quickSaleSchema, type QuickSaleResult } from '@wd/shared';
import type { z } from 'zod';
import type { SupplierContext } from '../../lib/auth-context';
import type { Db, Tx } from '../../lib/db';
import { notFound, validationError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { minorToDec } from '../../lib/money';
import { resolveOccurredAt } from '../../lib/occurred-at';
import { storeBalanceMinor } from '../ledger/balance';
import { resolveLinePrices } from '../prices/prices';
import { recordDelivery, settleOrderTotals } from './delivery';
import { loadOrderDto } from './order-dto';

type QuickSale = z.output<typeof quickSaleSchema>;

/**
 * The supplier's main flow: store → quantities → empties → payment → confirm.
 * Creates the order and records its delivery in ONE transaction: all of it or none of it.
 */
export async function quickSale(db: Db, auth: SupplierContext, input: QuickSale): Promise<QuickSaleResult> {
  const { result: orderId, replayed } = await idempotent(
    async () =>
      (
        await db.order.findFirst({
          where: { supplierId: auth.supplierId, clientId: input.clientId },
          select: { id: true },
        })
      )?.id ?? null,
    () => db.$transaction((tx) => createAndDeliver(tx, auth, input), { timeout: 15000 }),
  );

  const order = await loadOrderDto(db, { supplierId: auth.supplierId }, orderId);
  const balance = await storeBalanceMinor(db, auth.supplierId, order.storeId);
  return { order, storeBalance: fromMinor(balance), replayed };
}

async function createAndDeliver(tx: Tx, auth: SupplierContext, input: QuickSale): Promise<string> {
  const { supplierId, userId } = auth;

  const store = await tx.store.findFirst({ where: { id: input.storeId, supplierId } });
  if (!store) throw notFound('Store');
  if (store.status !== 'ACTIVE') throw validationError('This store is inactive. Reactivate it to record deliveries.');

  const products = await tx.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) }, supplierId } });
  const productById = new Map(products.map((p) => [p.id, p]));
  const requested = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) throw notFound('Product');
    if (!product.active && item.quantity > 0) {
      throw validationError(`${product.name} is no longer sold. Turn it back on in Products first.`);
    }
    return { product, quantity: item.quantity, emptyCollected: item.emptyCollected, unitPrice: item.unitPrice };
  });
  // The store's own prices; a first sale of a product with no price yet sets it.
  const lines = await resolveLinePrices(tx, auth, store.id, requested, { canSetPrice: true });

  // Resolved inside the create path so a replay of an old, already-synced sale still succeeds.
  const now = resolveOccurredAt(input.occurredAt);
  // Sequential, gap-free order numbers per business. The row lock serialises concurrent sales.
  const counter = await tx.supplier.update({
    where: { id: supplierId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true },
  });

  const order = await tx.order.create({
    data: {
      supplierId,
      storeId: store.id,
      orderNumber: counter.nextOrderNumber - 1,
      status: 'DELIVERED',
      source: 'SUPPLIER',
      orderDate: now,
      deliveryDate: now,
      subtotal: '0',
      total: '0',
      notes: input.notes,
      clientId: input.clientId,
      createdById: userId,
      items: {
        create: lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            unitPrice: minorToDec(l.unitPrice),
            lineTotal: minorToDec(l.unitPrice * l.quantity),
          })),
      },
    },
  });

  const discount = toMinor(input.discount);
  await recordDelivery(tx, auth, {
    orderId: order.id,
    storeId: store.id,
    lines,
    discount,
    payment: {
      amount: toMinor(input.payment.amount),
      method: input.payment.method,
      referenceNumber: input.payment.referenceNumber ?? null,
    },
    notes: input.notes,
    clientId: null,
    at: now,
  });
  await settleOrderTotals(tx, order.id, discount, now);
  return order.id;
}
