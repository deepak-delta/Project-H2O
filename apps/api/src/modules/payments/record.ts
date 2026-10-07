import type { Minor, PaymentMethod } from '@wd/shared';
import type { OperatorContext } from '../../lib/auth-context';
import type { Tx } from '../../lib/db';
import { minorToDec } from '../../lib/money';

export interface PaymentRecord {
  storeId: string;
  orderId: string | null;
  amountMinor: Minor;
  method: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  clientId: string | null;
  at: Date;
  /** Portion that pays for a sale (WATER_SALE); the rest is recovered credit. */
  saleAmountMinor: Minor;
}

/**
 * One payment = one Payment row + one PAYMENT ledger entry + cash-flow income, always together.
 */
export async function recordPaymentInTx(tx: Tx, auth: OperatorContext, p: PaymentRecord) {
  const { supplierId, userId } = auth;
  const payment = await tx.payment.create({
    data: {
      supplierId,
      storeId: p.storeId,
      orderId: p.orderId,
      amount: minorToDec(p.amountMinor),
      method: p.method,
      referenceNumber: p.referenceNumber,
      notes: p.notes,
      paymentDate: p.at,
      clientId: p.clientId,
      createdById: userId,
    },
  });

  await tx.ledgerEntry.create({
    data: {
      supplierId,
      storeId: p.storeId,
      type: 'PAYMENT',
      amount: minorToDec(-p.amountMinor),
      orderId: p.orderId,
      paymentId: payment.id,
      occurredAt: p.at,
      createdById: userId,
    },
  });

  const recovered = p.amountMinor - p.saleAmountMinor;
  const cashFlow = [
    { category: 'WATER_SALE' as const, amount: p.saleAmountMinor },
    { category: 'CREDIT_RECOVERY' as const, amount: recovered },
  ].filter((c) => c.amount > 0);
  await tx.cashFlowEntry.createMany({
    data: cashFlow.map((c) => ({
      supplierId,
      type: 'INCOME' as const,
      category: c.category,
      amount: minorToDec(c.amount),
      date: p.at,
      method: p.method,
      paymentId: payment.id,
      reference: p.referenceNumber,
      createdById: userId,
    })),
  });

  return payment;
}
