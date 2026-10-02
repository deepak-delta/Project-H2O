import type { SupplierContext } from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import type { Tx } from '../../lib/db';
import { conflict, notFound } from '../../lib/errors';
import { decToMinor, decToString, minorToDec } from '../../lib/money';

/**
 * Reverses a payment without deleting anything: the payment is marked reversed, and equal and
 * opposite ledger and cash-flow rows are added. The store's balance goes back up by the amount.
 */
export async function reversePaymentInTx(tx: Tx, auth: SupplierContext, paymentId: string, reason: string): Promise<void> {
  const { supplierId, userId } = auth;
  // Lock the payment so two reversals can't both pass the "not yet reversed" check.
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} AND "supplierId" = ${supplierId} FOR UPDATE`;
  const payment = await tx.payment.findFirst({ where: { id: paymentId, supplierId } });
  if (!payment) throw notFound('Payment');
  if (payment.reversedAt) throw conflict('This payment was already reversed.');

  const now = new Date();
  const ledger = await tx.ledgerEntry.findFirst({ where: { supplierId, paymentId, type: 'PAYMENT' } });
  if (ledger) {
    await tx.ledgerEntry.create({
      data: {
        supplierId,
        storeId: payment.storeId,
        type: 'REVERSAL',
        amount: minorToDec(-decToMinor(ledger.amount)),
        orderId: payment.orderId,
        paymentId: payment.id,
        reversesId: ledger.id,
        note: reason,
        occurredAt: now,
        createdById: userId,
      },
    });
  }

  const flows = await tx.cashFlowEntry.findMany({ where: { supplierId, paymentId, reversesId: null } });
  for (const f of flows) {
    await tx.cashFlowEntry.create({
      data: {
        supplierId,
        type: f.type,
        category: f.category,
        amount: minorToDec(-decToMinor(f.amount)),
        date: now,
        method: f.method,
        paymentId: payment.id,
        reversesId: f.id,
        description: `Reversal: ${reason}`,
        createdById: userId,
      },
    });
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: { reversedAt: now, reversedById: userId, reversalReason: reason },
  });
  await audit(tx, {
    supplierId,
    actorId: userId,
    action: 'PAYMENT_REVERSED',
    entity: 'Payment',
    entityId: payment.id,
    before: { amount: decToString(payment.amount), method: payment.method, reversed: false },
    after: { reversed: true, reason },
  });
}
