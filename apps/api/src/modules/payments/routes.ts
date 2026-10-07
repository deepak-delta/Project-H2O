import { fromMinor, recordPaymentSchema, reversePaymentSchema, toMinor, zonedDayRangeForKey, type PaymentDto } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app';
import * as notify from '../notifications/events';
import { ownedBy, requireAuth, requireOperator, requireSupplier } from '../../lib/auth-context';
import { businessToday, staffPaymentWhere } from '../staff/scope';
import { getBusinessSettings } from '../../lib/business';
import { notFound } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { decToString } from '../../lib/money';
import { resolveOccurredAt } from '../../lib/occurred-at';
import { decodeCursor, olderThan, toPage } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import type { Prisma } from '../../generated/prisma/client';
import { storeBalanceMinor } from '../ledger/balance';
import { recordPaymentInTx } from './record';
import { reversePaymentInTx } from './reverse';

export const paymentInclude = {
  store: { select: { name: true } },
  order: { select: { orderNumber: true } },
} as const satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function toPaymentDto(p: PaymentRow): PaymentDto {
  return {
    id: p.id,
    storeId: p.storeId,
    storeName: p.store.name,
    orderId: p.orderId,
    orderNumber: p.order?.orderNumber ?? null,
    amount: decToString(p.amount),
    method: p.method,
    referenceNumber: p.referenceNumber,
    paymentDate: p.paymentDate.toISOString(),
    notes: p.notes,
    reversed: p.reversedAt !== null,
  };
}

export function registerPaymentRoutes(app: FastifyInstance, { db, notifier }: Services): void {
  /** Money received against a store's balance (not tied to a particular order). */
  app.post('/api/payments', async (req, reply) => {
    const auth = requireOperator(req);
    const input = parse(recordPaymentSchema, req.body);

    const store = await db.store.findFirst({ where: { id: input.storeId, supplierId: auth.supplierId } });
    if (!store) throw notFound('Store');

    const { result, replayed } = await idempotent(
      () =>
        db.payment.findFirst({
          where: { supplierId: auth.supplierId, clientId: input.clientId },
          include: paymentInclude,
        }),
      () =>
        db.$transaction(async (tx) => {
          const payment = await recordPaymentInTx(tx, auth, {
            storeId: store.id,
            orderId: null,
            amountMinor: toMinor(input.amount),
            method: input.method,
            referenceNumber: input.referenceNumber ?? null,
            notes: input.notes,
            clientId: input.clientId,
            at: resolveOccurredAt(input.occurredAt),
            saleAmountMinor: 0,
          });
          return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude });
        }),
    );

    const balance = await storeBalanceMinor(db, auth.supplierId, store.id);
    if (!replayed) {
      await notify.paymentRecorded(db, notifier, auth.supplierId, store.id, decToString(result.amount), fromMinor(balance));
    }
    return reply
      .status(replayed ? 200 : 201)
      .send({ payment: toPaymentDto(result), storeBalance: fromMinor(balance), replayed });
  });

  /** Undo a payment recorded by mistake. The original row stays, marked reversed. */
  app.post('/api/payments/:id/reverse', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string().min(1) }), req.params);
    const { reason } = parse(reversePaymentSchema, req.body);
    await db.$transaction((tx) => reversePaymentInTx(tx, auth, id, reason));
    const payment = await db.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude });
    const balance = await storeBalanceMinor(db, auth.supplierId, payment.storeId);
    await notify.paymentReversed(db, notifier, auth.supplierId, payment.storeId, decToString(payment.amount), fromMinor(balance));
    return { payment: toPaymentDto(payment), storeBalance: fromMinor(balance) };
  });

  app.get('/api/payments', async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      z.object({
        storeId: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    const where: Prisma.PaymentWhereInput =
      auth.role === 'STAFF' ? staffPaymentWhere(auth, await businessToday(db, auth.supplierId)) : { ...ownedBy(auth) };
    if (q.storeId && auth.role === 'SUPPLIER') where.storeId = q.storeId;
    if (q.date) {
      const { timezone } = await getBusinessSettings(db, auth.supplierId);
      const range = zonedDayRangeForKey(q.date, timezone);
      where.paymentDate = { gte: range.start, lt: range.end };
    }
    const rows = await db.payment.findMany({
      where: { AND: [where, olderThan('paymentDate', decodeCursor(q.cursor))] },
      include: paymentInclude,
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (r) => ({ at: r.paymentDate, id: r.id }), toPaymentDto);
  });
}
