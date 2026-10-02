import {
  CASHFLOW_TYPES,
  cashEntrySchema,
  fromMinor,
  reverseCashEntrySchema,
  zonedDateKey,
  zonedDayRangeForKey,
  type CashEntryDto,
  type CashFlowSummary,
  type PaymentMethod,
} from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { requireSupplier } from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import { getBusinessSettings } from '../../lib/business';
import { conflict, notFound, validationError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { decToMinor, decToString, minorToDec } from '../../lib/money';
import { decodeCursor, olderThan, toPage } from '../../lib/pagination';
import { resolveRange } from '../../lib/range';
import { parse } from '../../lib/validate';
import type { Prisma } from '../../generated/prisma/client';

const entryInclude = {
  payment: { select: { store: { select: { name: true } } } },
  reversedBy: { select: { id: true } },
} as const satisfies Prisma.CashFlowEntryInclude;

type EntryRow = Prisma.CashFlowEntryGetPayload<{ include: typeof entryInclude }>;

function toEntryDto(e: EntryRow): CashEntryDto {
  return {
    id: e.id,
    type: e.type,
    category: e.category,
    amount: decToString(e.amount),
    date: e.date.toISOString(),
    method: e.method,
    description: e.description,
    reference: e.reference,
    storeName: e.payment?.store.name ?? null,
    fromPayment: e.paymentId !== null,
    reversed: e.reversedBy !== null,
    isReversal: e.reversesId !== null,
  };
}

export function registerCashFlowRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /** Expenses and other income entered by hand. Sales income is recorded by payments. */
  app.post('/api/cashflow', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(cashEntrySchema, req.body);
    const { timezone } = await getBusinessSettings(db, auth.supplierId);
    const today = zonedDateKey(new Date(), timezone);
    if (input.date && input.date > today) throw validationError('The date cannot be in the future.', { date: 'Date is in the future' });

    // Today's entries keep the real time; back-dated ones sit at midday of that day.
    const date =
      !input.date || input.date === today
        ? new Date()
        : new Date(zonedDayRangeForKey(input.date, timezone).start.getTime() + 12 * 60 * 60 * 1000);

    const { result, replayed } = await idempotent(
      () => db.cashFlowEntry.findFirst({ where: { supplierId: auth.supplierId, clientId: input.clientId }, include: entryInclude }),
      () =>
        db.cashFlowEntry.create({
          data: {
            supplierId: auth.supplierId,
            type: input.type,
            category: input.category,
            amount: input.amount,
            method: input.method,
            date,
            description: input.description,
            reference: input.reference,
            clientId: input.clientId,
            createdById: auth.userId,
          },
          include: entryInclude,
        }),
    );
    return reply.status(replayed ? 200 : 201).send(toEntryDto(result));
  });

  app.get('/api/cashflow', async (req) => {
    const auth = requireSupplier(req);
    const range = await resolveRange(db, auth.supplierId, req.query);
    const q = parse(
      z.object({
        type: z.enum(CASHFLOW_TYPES).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    const rows = await db.cashFlowEntry.findMany({
      where: {
        supplierId: auth.supplierId,
        date: { gte: range.start, lt: range.end },
        ...(q.type ? { type: q.type } : {}),
        ...olderThan('date', decodeCursor(q.cursor)),
      },
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (r) => ({ at: r.date, id: r.id }), toEntryDto);
  });

  app.get('/api/cashflow/summary', async (req): Promise<CashFlowSummary> => {
    const auth = requireSupplier(req);
    const range = await resolveRange(db, auth.supplierId, req.query);
    const rows = await db.cashFlowEntry.groupBy({
      by: ['type', 'category', 'method'],
      where: { supplierId: auth.supplierId, date: { gte: range.start, lt: range.end } },
      _sum: { amount: true },
    });

    let moneyIn = 0;
    let moneyOut = 0;
    const byCategory = new Map<string, { type: (typeof rows)[number]['type']; category: (typeof rows)[number]['category']; amount: number }>();
    const byMethod = new Map<PaymentMethod, { moneyIn: number; moneyOut: number }>();
    for (const r of rows) {
      const amount = decToMinor(r._sum.amount);
      if (r.type === 'INCOME') moneyIn += amount;
      else moneyOut += amount;
      const key = `${r.type}:${r.category}`;
      const cat = byCategory.get(key) ?? { type: r.type, category: r.category, amount: 0 };
      cat.amount += amount;
      byCategory.set(key, cat);
      const m = byMethod.get(r.method) ?? { moneyIn: 0, moneyOut: 0 };
      if (r.type === 'INCOME') m.moneyIn += amount;
      else m.moneyOut += amount;
      byMethod.set(r.method, m);
    }

    return {
      from: range.from,
      to: range.to,
      moneyIn: fromMinor(moneyIn),
      moneyOut: fromMinor(moneyOut),
      net: fromMinor(moneyIn - moneyOut),
      byCategory: [...byCategory.values()]
        .filter((c) => c.amount !== 0)
        .sort((a, b) => b.amount - a.amount)
        .map((c) => ({ ...c, amount: fromMinor(c.amount) })),
      byMethod: [...byMethod.entries()].map(([method, m]) => ({
        method,
        moneyIn: fromMinor(m.moneyIn),
        moneyOut: fromMinor(m.moneyOut),
        net: fromMinor(m.moneyIn - m.moneyOut),
      })),
    };
  });

  /** Undo an expense/income entered by mistake: an opposite entry is added, nothing deleted. */
  app.post('/api/cashflow/:id/reverse', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string().min(1) }), req.params);
    const { reason } = parse(reverseCashEntrySchema, req.body);

    const reversal = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CashFlowEntry" WHERE id = ${id} AND "supplierId" = ${auth.supplierId} FOR UPDATE`;
      const entry = await tx.cashFlowEntry.findFirst({
        where: { id, supplierId: auth.supplierId },
        include: { reversedBy: { select: { id: true } } },
      });
      if (!entry) throw notFound('Entry');
      if (entry.paymentId) throw validationError('This came from a payment. Reverse the payment instead.');
      if (entry.reversesId) throw validationError('This entry is itself a reversal.');
      if (entry.reversedBy) throw conflict('This entry was already reversed.');

      const created = await tx.cashFlowEntry.create({
        data: {
          supplierId: auth.supplierId,
          type: entry.type,
          category: entry.category,
          amount: minorToDec(-decToMinor(entry.amount)),
          date: new Date(),
          method: entry.method,
          description: `Reversal: ${reason}`,
          reversesId: entry.id,
          createdById: auth.userId,
        },
        include: entryInclude,
      });
      await audit(tx, {
        supplierId: auth.supplierId,
        actorId: auth.userId,
        action: 'CASH_ENTRY_REVERSED',
        entity: 'CashFlowEntry',
        entityId: entry.id,
        before: { type: entry.type, category: entry.category, amount: decToString(entry.amount) },
        after: { reversedBy: created.id, reason },
      });
      return created;
    });
    return toEntryDto(reversal);
  });
}

