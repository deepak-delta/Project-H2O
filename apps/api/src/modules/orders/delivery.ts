import { lineTotalMinor, type Minor, type PaymentMethod } from '@wd/shared';
import type { OperatorContext } from '../../lib/auth-context';
import type { Tx } from '../../lib/db';
import { validationError } from '../../lib/errors';
import { decToMinor, minorToDec } from '../../lib/money';
import type { Product } from '../../generated/prisma/client';
import { stockByProduct, storeCanBalances } from '../inventory/stock';
import { recordPaymentInTx } from '../payments/record';

export interface DeliveryLine {
  product: Product;
  /** Full cans handed over. */
  quantity: number;
  emptyCollected: number;
  /** Broken cans the store handed back: they leave the store's count and go to Damaged. */
  damagedCollected: number;
  /** What the store pays per damaged can (0 when none came back). */
  damageChargeEach: Minor;
  unitPrice: Minor;
}

export interface RecordDeliveryArgs {
  orderId: string;
  storeId: string;
  lines: DeliveryLine[];
  discount: Minor;
  payment: { amount: Minor; method: PaymentMethod; referenceNumber: string | null };
  notes: string | null;
  clientId: string | null;
  at: Date;
}

/**
 * One visit to a store: the Delivery row, every inventory movement, the SALE (and DISCOUNT)
 * ledger entries and any payment collected. Must run inside the caller's transaction.
 *
 * Revenue is recognised here, on delivery — never when an order is merely placed.
 */
export async function recordDelivery(tx: Tx, auth: OperatorContext, a: RecordDeliveryArgs) {
  const { supplierId, userId } = auth;

  for (const l of a.lines) {
    if (!l.product.isReturnable && (l.emptyCollected > 0 || l.damagedCollected > 0)) {
      throw validationError(`${l.product.name} is not a returnable can.`);
    }
  }

  const value = a.lines.reduce((sum, l) => sum + lineTotalMinor(l.unitPrice, l.quantity), 0);
  if (a.discount > value) throw validationError('Discount cannot be more than the amount delivered.');
  const damageOf = (l: DeliveryLine) => (l.damagedCollected > 0 ? lineTotalMinor(l.damageChargeEach, l.damagedCollected) : 0);
  if (a.lines.some((l) => l.damagedCollected > 0 && l.damageChargeEach <= 0)) {
    throw validationError('Enter what the client pays for each damaged can.');
  }
  const billed = value - a.discount + a.lines.reduce((sum, l) => sum + damageOf(l), 0);

  const delivery = await tx.delivery.create({
    data: {
      supplierId,
      orderId: a.orderId,
      storeId: a.storeId,
      deliveredById: userId,
      deliveredAt: a.at,
      notes: a.notes,
      clientId: a.clientId,
      items: {
        create: a.lines.map((l) => ({
          productId: l.product.id,
          deliveredQty: l.quantity,
          emptyCollected: l.emptyCollected,
          damagedQty: l.damagedCollected,
          damageCharge: minorToDec(damageOf(l)),
        })),
      },
    },
  });

  const base = { supplierId, storeId: a.storeId, orderId: a.orderId, deliveryId: delivery.id, createdById: userId, occurredAt: a.at };
  await tx.inventoryMovement.createMany({
    data: [
      // Full cans leave the warehouse; returnable ones are now held by the store.
      ...a.lines
        .filter((l) => l.quantity > 0)
        .map((l) => ({
          ...base,
          productId: l.product.id,
          type: 'DELIVERY' as const,
          filledDelta: -l.quantity,
          withCustomersDelta: l.product.isReturnable ? l.quantity : 0,
        })),
      // Empties come back from the store into the warehouse.
      ...a.lines
        .filter((l) => l.emptyCollected > 0)
        .map((l) => ({
          ...base,
          productId: l.product.id,
          type: 'RETURN' as const,
          emptyDelta: l.emptyCollected,
          withCustomersDelta: -l.emptyCollected,
        })),
      // Broken cans come back too, but into Damaged, not into usable empties. No charge.
      ...a.lines
        .filter((l) => l.damagedCollected > 0)
        .map((l) => ({
          ...base,
          productId: l.product.id,
          type: 'DAMAGE' as const,
          damagedDelta: l.damagedCollected,
          withCustomersDelta: -l.damagedCollected,
        })),
    ],
  });

  if (value > 0) {
    await tx.ledgerEntry.create({
      data: { supplierId, storeId: a.storeId, type: 'SALE', amount: minorToDec(value), orderId: a.orderId, occurredAt: a.at, createdById: userId },
    });
  }
  if (a.discount > 0) {
    await tx.ledgerEntry.create({
      data: { supplierId, storeId: a.storeId, type: 'DISCOUNT', amount: minorToDec(-a.discount), orderId: a.orderId, occurredAt: a.at, createdById: userId },
    });
  }
  // Damaged cans are paid for: billed on this order as its own sale line, so the store's
  // ledger shows it separately and cancelling the order reverses it with everything else.
  for (const l of a.lines) {
    const charge = damageOf(l);
    if (charge === 0) continue;
    await tx.ledgerEntry.create({
      data: {
        supplierId,
        storeId: a.storeId,
        type: 'SALE',
        amount: minorToDec(charge),
        orderId: a.orderId,
        note: `${l.damagedCollected} damaged ${l.product.name}`,
        occurredAt: a.at,
        createdById: userId,
      },
    });
  }

  if (a.payment.amount > 0) {
    await recordPaymentInTx(tx, auth, {
      storeId: a.storeId,
      orderId: a.orderId,
      amountMinor: a.payment.amount,
      method: a.payment.method,
      referenceNumber: a.payment.referenceNumber,
      notes: null,
      clientId: null,
      at: a.at,
      // The part covering this bill is a sale; anything extra clears older dues.
      saleAmountMinor: Math.min(a.payment.amount, billed),
    });
  }

  // Accept physical reality, but flag anything that doesn't add up for the supplier to review.
  const productIds = a.lines.map((l) => l.product.id);
  const stock = await stockByProduct(tx, supplierId, productIds);
  const cans = await storeCanBalances(tx, supplierId, a.storeId);
  const warning =
    a.lines.some((l) => l.quantity > 0 && (stock.get(l.product.id)?.filled ?? 0) < 0) ||
    a.lines.some((l) => (cans.get(l.product.id) ?? 0) < 0);
  if (warning) await tx.delivery.update({ where: { id: delivery.id }, data: { stockWarning: true } });

  return delivery;
}

/**
 * Re-derives an order's billed amount and status from everything delivered so far, so that
 * order.total always equals the net of its SALE/DISCOUNT ledger entries.
 */
export async function settleOrderTotals(tx: Tx, orderId: string, extraDiscount: Minor, at: Date): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, deliveries: { include: { items: true } } },
  });
  const delivered = new Map<string, number>();
  let damageCharge = 0;
  for (const d of order.deliveries) {
    for (const i of d.items) {
      delivered.set(i.productId, (delivered.get(i.productId) ?? 0) + i.deliveredQty);
      damageCharge += decToMinor(i.damageCharge);
    }
  }
  const subtotal = order.items.reduce(
    (sum, i) => sum + lineTotalMinor(decToMinor(i.unitPrice), delivered.get(i.productId) ?? 0),
    0,
  );
  const discount = decToMinor(order.discount) + extraDiscount;
  const complete = order.items.every((i) => (delivered.get(i.productId) ?? 0) >= i.quantity);

  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: minorToDec(subtotal),
      discount: minorToDec(discount),
      // Cans delivered, less discount, plus anything charged for damaged cans.
      total: minorToDec(subtotal - discount + damageCharge),
      status: complete ? 'DELIVERED' : 'PARTIALLY_DELIVERED',
      deliveryDate: at,
    },
  });
}

/** Row lock so a delivery, a cancellation and a status change can't interleave on one order. */
export async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
}
