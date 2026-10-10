import {
  fromMinor,
  periodKeys,
  type BusinessSummary,
  type InventoryReport,
  type OutstandingReport,
  type SalesReport,
  type StockCounts,
} from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { requireSupplier } from '../../lib/auth-context';
import { sqlSumToMinor } from '../../lib/money';
import { resolveRange } from '../../lib/range';
import { parse } from '../../lib/validate';
import { Prisma } from '../../generated/prisma/client';
import { paymentInclude, toPaymentDto } from '../payments/routes';
import { CANS_DELIVERED, COLLECTED, NET_SALES } from './sql';
import { businessSummary } from './summary';

const ZERO: StockCounts = { filled: 0, empty: 0, withCustomers: 0, damaged: 0 };
const PAYMENTS_REPORT_CAP = 5000;

/**
 * SQL that buckets a UTC timestamp column into a local day ("YYYY-MM-DD") or month ("YYYY-MM").
 * Columns are timestamp-without-time-zone holding UTC, hence the double AT TIME ZONE.
 */
function periodOf(column: Prisma.Sql, unit: 'day' | 'month', timezone: string): Prisma.Sql {
  const format = unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  return Prisma.sql`to_char(date_trunc(${unit}::text, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}::text), ${format}::text)`;
}

export function registerReportRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /** Daily or monthly sales, collections and cans, all derived from the ledgers. */
  app.get('/api/reports/sales', async (req): Promise<SalesReport> => {
    const { supplierId } = requireSupplier(req);
    const range = await resolveRange(db, supplierId, req.query);
    const { groupBy } = parse(z.object({ groupBy: z.enum(['day', 'month']).default('day') }), req.query);
    const tz = range.timezone;

    const [money, cans, deliveries] = await Promise.all([
      db.$queryRaw<{ period: string; sales: unknown; collected: unknown }[]>`
        SELECT ${periodOf(Prisma.sql`"occurredAt"`, groupBy, tz)} AS period,
               ${NET_SALES} AS sales,
               ${COLLECTED} AS collected
        FROM "LedgerEntry"
        WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}
        GROUP BY 1`,
      db.$queryRaw<{ period: string; cans: unknown }[]>`
        SELECT ${periodOf(Prisma.sql`"occurredAt"`, groupBy, tz)} AS period,
               ${CANS_DELIVERED} AS cans
        FROM "InventoryMovement"
        WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}
        GROUP BY 1`,
      db.$queryRaw<{ period: string; deliveries: unknown }[]>`
        SELECT ${periodOf(Prisma.sql`d."deliveredAt"`, groupBy, tz)} AS period, COUNT(*) AS deliveries
        FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId"
        WHERE d."supplierId" = ${supplierId} AND o.status <> 'CANCELLED'
          AND d."deliveredAt" >= ${range.start} AND d."deliveredAt" < ${range.end}
        GROUP BY 1`,
    ]);

    const moneyBy = new Map(money.map((r) => [r.period, { sales: sqlSumToMinor(r.sales), collected: sqlSumToMinor(r.collected) }]));
    const cansBy = new Map(cans.map((r) => [r.period, Number(r.cans)]));
    const deliveriesBy = new Map(deliveries.map((r) => [r.period, Number(r.deliveries)]));

    const totals = { deliveries: 0, cans: 0, sales: 0, collected: 0 };
    const rows = periodKeys(range.from, range.to, groupBy).map((period) => {
      const m = moneyBy.get(period) ?? { sales: 0, collected: 0 };
      const row = { deliveries: deliveriesBy.get(period) ?? 0, cans: cansBy.get(period) ?? 0, ...m };
      totals.deliveries += row.deliveries;
      totals.cans += row.cans;
      totals.sales += row.sales;
      totals.collected += row.collected;
      return {
        period,
        deliveries: row.deliveries,
        cans: row.cans,
        sales: fromMinor(row.sales),
        collected: fromMinor(row.collected),
        duesChange: fromMinor(row.sales - row.collected),
      };
    });

    return {
      from: range.from,
      to: range.to,
      groupBy,
      rows,
      totals: {
        deliveries: totals.deliveries,
        cans: totals.cans,
        sales: fromMinor(totals.sales),
        collected: fromMinor(totals.collected),
        duesChange: fromMinor(totals.sales - totals.collected),
      },
    };
  });

  /** Everything for one period on one page: sales, money, expenses, cans, staff, clients. */
  app.get('/api/reports/summary', async (req): Promise<BusinessSummary> => {
    const { supplierId } = requireSupplier(req);
    return businessSummary(db, supplierId, await resolveRange(db, supplierId, req.query));
  });

  /** Who owes money right now, biggest first, with when they last paid. */
  app.get('/api/reports/outstanding', async (req): Promise<OutstandingReport> => {
    const { supplierId } = requireSupplier(req);
    const rows = await db.$queryRaw<
      { storeId: string; storeName: string; phone: string | null; balance: unknown; cans: unknown; lastDeliveryAt: Date | null; lastPaymentAt: Date | null }[]
    >`
      SELECT s.id AS "storeId", s.name AS "storeName", s.phone, t.balance,
             t.cans, t."lastDeliveryAt",
             (SELECT MAX(p."paymentDate") FROM "Payment" p WHERE p."supplierId" = ${supplierId} AND p."storeId" = s.id AND p."reversedAt" IS NULL) AS "lastPaymentAt"
      FROM "ClientTotals" t
      JOIN "Store" s ON s.id = t."storeId"
      WHERE t."supplierId" = ${supplierId} AND t.balance > 0
      ORDER BY t.balance DESC, s.name ASC
      LIMIT 2000`;

    let total = 0;
    const mapped = rows.map((r) => {
      const balance = sqlSumToMinor(r.balance);
      total += balance;
      return {
        storeId: r.storeId,
        storeName: r.storeName,
        phone: r.phone,
        balance: fromMinor(balance),
        cans: Number(r.cans),
        lastPaymentAt: r.lastPaymentAt?.toISOString() ?? null,
        lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
      };
    });
    return { total: fromMinor(total), rows: mapped };
  });

  /**
   * Stock movement for a period, per product:
   * opening + Σ movements = closing. Every can is accounted for.
   */
  app.get('/api/reports/inventory', async (req): Promise<InventoryReport> => {
    const { supplierId } = requireSupplier(req);
    const range = await resolveRange(db, supplierId, req.query);
    const sum = { filledDelta: true, emptyDelta: true, withCustomersDelta: true, damagedDelta: true } as const;

    const [products, opening, movements] = await Promise.all([
      db.product.findMany({ where: { supplierId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
      // Opening = today's running total − everything recorded since the period began. One
      // statement (one snapshot), and it only sums the recent movements, not the whole history.
      db.$queryRaw<{ productId: string; filled: number; empty: number; withCustomers: number; damaged: number }[]>`
        SELECT s."productId",
               s.filled - COALESCE(m.filled, 0)::int AS filled,
               s.empty - COALESCE(m.empty, 0)::int AS empty,
               s."withCustomers" - COALESCE(m.with_clients, 0)::int AS "withCustomers",
               s.damaged - COALESCE(m.damaged, 0)::int AS damaged
        FROM "ProductStock" s
        LEFT JOIN (
          SELECT "productId", SUM("filledDelta") AS filled, SUM("emptyDelta") AS empty,
                 SUM("withCustomersDelta") AS with_clients, SUM("damagedDelta") AS damaged
          FROM "InventoryMovement"
          WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${range.start}
          GROUP BY "productId"
        ) m ON m."productId" = s."productId"
        WHERE s."supplierId" = ${supplierId}`,
      db.inventoryMovement.groupBy({
        by: ['productId', 'type'],
        where: { supplierId, occurredAt: { gte: range.start, lt: range.end } },
        _sum: sum,
      }),
    ]);

    const counts = (s: { filledDelta: number | null; emptyDelta: number | null; withCustomersDelta: number | null; damagedDelta: number | null }): StockCounts => ({
      filled: s.filledDelta ?? 0,
      empty: s.emptyDelta ?? 0,
      withCustomers: s.withCustomersDelta ?? 0,
      damaged: s.damagedDelta ?? 0,
    });
    const add = (a: StockCounts, b: StockCounts): StockCounts => ({
      filled: a.filled + b.filled,
      empty: a.empty + b.empty,
      withCustomers: a.withCustomers + b.withCustomers,
      damaged: a.damaged + b.damaged,
    });

    return {
      from: range.from,
      to: range.to,
      products: products
        .map((p) => {
          const open = opening.find((o) => o.productId === p.id);
          const openCounts: StockCounts = open
            ? { filled: open.filled, empty: open.empty, withCustomers: open.withCustomers, damaged: open.damaged }
            : ZERO;
          const moves = movements.filter((m) => m.productId === p.id).map((m) => ({ type: m.type, ...counts(m._sum) }));
          return {
            productId: p.id,
            productName: p.name,
            opening: openCounts,
            movements: moves,
            closing: moves.reduce<StockCounts>((acc, m) => add(acc, m), openCounts),
          };
        })
        .filter((p) => p.movements.length > 0 || Object.values(p.opening).some((v) => v !== 0)),
    };
  });

  /** All payments in a period (for export). */
  app.get('/api/reports/payments', async (req) => {
    const { supplierId } = requireSupplier(req);
    const range = await resolveRange(db, supplierId, req.query);
    const rows = await db.payment.findMany({
      where: { supplierId, paymentDate: { gte: range.start, lt: range.end } },
      include: paymentInclude,
      orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
      take: PAYMENTS_REPORT_CAP,
    });
    return { rows: rows.map(toPaymentDto), truncated: rows.length === PAYMENTS_REPORT_CAP };
  });
}
