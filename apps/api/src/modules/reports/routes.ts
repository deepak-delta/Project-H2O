import {
  fromMinor,
  periodKeys,
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
               COALESCE(SUM(amount) FILTER (WHERE type IN ('SALE', 'DISCOUNT') OR (type = 'REVERSAL' AND "paymentId" IS NULL)), 0) AS sales,
               COALESCE(-SUM(amount) FILTER (WHERE type = 'PAYMENT' OR (type = 'REVERSAL' AND "paymentId" IS NOT NULL)), 0) AS collected
        FROM "LedgerEntry"
        WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}
        GROUP BY 1`,
      db.$queryRaw<{ period: string; cans: unknown }[]>`
        SELECT ${periodOf(Prisma.sql`"occurredAt"`, groupBy, tz)} AS period,
               COALESCE(SUM(-"filledDelta") FILTER (WHERE type = 'DELIVERY' OR (type = 'REVERSAL' AND "deliveryId" IS NOT NULL)), 0) AS cans
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

  /** Who owes money right now, biggest first, with when they last paid. */
  app.get('/api/reports/outstanding', async (req): Promise<OutstandingReport> => {
    const { supplierId } = requireSupplier(req);
    const rows = await db.$queryRaw<
      { storeId: string; storeName: string; phone: string | null; balance: unknown; cans: unknown; lastDeliveryAt: Date | null; lastPaymentAt: Date | null }[]
    >`
      WITH bal AS (
        SELECT "storeId", SUM(amount) AS balance FROM "LedgerEntry" WHERE "supplierId" = ${supplierId} GROUP BY "storeId"
      ), cans AS (
        SELECT "storeId", SUM("withCustomersDelta") AS cans, MAX("occurredAt") FILTER (WHERE type = 'DELIVERY') AS last_delivery
        FROM "InventoryMovement" WHERE "supplierId" = ${supplierId} AND "storeId" IS NOT NULL GROUP BY "storeId"
      ), pay AS (
        SELECT "storeId", MAX("paymentDate") AS last_payment
        FROM "Payment" WHERE "supplierId" = ${supplierId} AND "reversedAt" IS NULL GROUP BY "storeId"
      )
      SELECT s.id AS "storeId", s.name AS "storeName", s.phone, bal.balance,
             COALESCE(cans.cans, 0) AS cans, cans.last_delivery AS "lastDeliveryAt", pay.last_payment AS "lastPaymentAt"
      FROM "Store" s
      JOIN bal ON bal."storeId" = s.id
      LEFT JOIN cans ON cans."storeId" = s.id
      LEFT JOIN pay ON pay."storeId" = s.id
      WHERE s."supplierId" = ${supplierId} AND bal.balance > 0
      ORDER BY bal.balance DESC, s.name ASC
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
      db.inventoryMovement.groupBy({ by: ['productId'], where: { supplierId, occurredAt: { lt: range.start } }, _sum: sum }),
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
          const openCounts = open ? counts(open._sum) : ZERO;
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
