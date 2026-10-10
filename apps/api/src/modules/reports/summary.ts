import { fromMinor, PAYMENT_METHODS, type BusinessSummary, type PaymentMethod } from '@wd/shared';
import type { Db } from '../../lib/db';
import { sqlSumToMinor } from '../../lib/money';
import type { ResolvedRange } from '../../lib/range';
import { cashFlowSummary } from '../cashflow/routes';
import { CANS_DELIVERED, COLLECTED, NET_SALES } from './sql';

const TOP = 10;

/**
 * The whole business for one period, worked out in the database (one round of parallel queries,
 * nothing loaded row by row), so a year is as quick as a week.
 */
export async function businessSummary(db: Db, supplierId: string, range: ResolvedRange): Promise<BusinessSummary> {
  const { start, end } = range;

  const [money, deliveries, byMethod, cashFlow, cans, newClients, owing, stock, topClients, topOwing, people] = await Promise.all([
    db.$queryRaw<{ sales: unknown; collected: unknown }[]>`
      SELECT ${NET_SALES} AS sales, ${COLLECTED} AS collected
      FROM "LedgerEntry"
      WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${start} AND "occurredAt" < ${end}`,
    db.$queryRaw<{ deliveries: bigint; cans: unknown }[]>`
      SELECT COUNT(*) AS deliveries,
             (SELECT ${CANS_DELIVERED} FROM "InventoryMovement"
              WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${start} AND "occurredAt" < ${end}) AS cans
      FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId"
      WHERE d."supplierId" = ${supplierId} AND o.status <> 'CANCELLED'
        AND d."deliveredAt" >= ${start} AND d."deliveredAt" < ${end}`,
    // Split of `collected` by method: the same ledger rows, joined to their payment.
    db.$queryRaw<{ method: PaymentMethod; amount: unknown }[]>`
      SELECT p.method, COALESCE(-SUM(l.amount), 0) AS amount
      FROM "LedgerEntry" l JOIN "Payment" p ON p.id = l."paymentId"
      WHERE l."supplierId" = ${supplierId} AND l.type IN ('PAYMENT', 'REVERSAL')
        AND l."occurredAt" >= ${start} AND l."occurredAt" < ${end}
      GROUP BY p.method`,
    cashFlowSummary(db, supplierId, range),
    db.$queryRaw<{ delivered: unknown; empties: unknown; damaged_back: unknown; lost: unknown; refilled: unknown }[]>`
      SELECT ${CANS_DELIVERED} AS delivered,
             COALESCE(SUM("emptyDelta") FILTER (WHERE "storeId" IS NOT NULL AND type IN ('RETURN', 'REVERSAL')), 0) AS empties,
             COALESCE(SUM("damagedDelta") FILTER (WHERE "storeId" IS NOT NULL AND type IN ('DAMAGE', 'REVERSAL')), 0) AS damaged_back,
             COALESCE(-SUM("filledDelta" + "emptyDelta") FILTER (WHERE "storeId" IS NULL AND type IN ('DAMAGE', 'LOSS')), 0) AS lost,
             COALESCE(SUM("filledDelta") FILTER (WHERE type = 'REFILL'), 0) AS refilled
      FROM "InventoryMovement"
      WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${start} AND "occurredAt" < ${end}`,
    db.store.count({ where: { supplierId, createdAt: { gte: start, lt: end } } }),
    db.$queryRaw<{ outstanding: unknown; owing: bigint; cans: unknown }[]>`
      SELECT COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) AS outstanding,
             COUNT(*) FILTER (WHERE balance > 0) AS owing,
             COALESCE(SUM(cans), 0) AS cans
      FROM "ClientTotals" WHERE "supplierId" = ${supplierId}`,
    db.$queryRaw<{ productId: string; productName: string; filled: number; empty: number; withCustomers: number; damaged: number }[]>`
      SELECT p.id AS "productId", p.name AS "productName", s.filled, s.empty, s."withCustomers", s.damaged
      FROM "ProductStock" s JOIN "Product" p ON p.id = s."productId"
      WHERE s."supplierId" = ${supplierId}
      ORDER BY p."sortOrder", p."createdAt"`,
    db.$queryRaw<{ storeId: string; storeName: string; sales: unknown; collected: unknown }[]>`
      SELECT s.id AS "storeId", s.name AS "storeName", l.sales, l.collected
      FROM (
        SELECT "storeId", ${NET_SALES} AS sales, ${COLLECTED} AS collected
        FROM "LedgerEntry"
        WHERE "supplierId" = ${supplierId} AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
        GROUP BY "storeId"
      ) l JOIN "Store" s ON s.id = l."storeId"
      WHERE l.sales > 0
      ORDER BY l.sales DESC, s.name
      LIMIT ${TOP}`,
    db.$queryRaw<{ storeId: string; storeName: string; balance: unknown }[]>`
      SELECT s.id AS "storeId", s.name AS "storeName", t.balance
      FROM "ClientTotals" t JOIN "Store" s ON s.id = t."storeId"
      WHERE t."supplierId" = ${supplierId} AND t.balance > 0
      ORDER BY t.balance DESC, s.name
      LIMIT ${TOP}`,
    db.$queryRaw<{ userId: string; name: string; role: 'SUPPLIER' | 'STAFF'; deliveries: bigint | null; cans: bigint | null; collected: unknown }[]>`
      SELECT u.id AS "userId", u.name, u.role::text AS role, d.deliveries, d.cans, p.collected
      FROM "User" u
      LEFT JOIN (
        SELECT d."deliveredById" AS uid, COUNT(DISTINCT d.id) AS deliveries, SUM(di."deliveredQty") AS cans
        FROM "Delivery" d
        JOIN "DeliveryItem" di ON di."deliveryId" = d.id
        JOIN "Order" o ON o.id = d."orderId"
        WHERE d."supplierId" = ${supplierId} AND o.status <> 'CANCELLED'
          AND d."deliveredAt" >= ${start} AND d."deliveredAt" < ${end}
        GROUP BY 1
      ) d ON d.uid = u.id
      LEFT JOIN (
        SELECT "createdById" AS uid, SUM(amount) AS collected
        FROM "Payment"
        WHERE "supplierId" = ${supplierId} AND "reversedAt" IS NULL
          AND "paymentDate" >= ${start} AND "paymentDate" < ${end}
        GROUP BY 1
      ) p ON p.uid = u.id
      WHERE u."supplierId" = ${supplierId} AND u.role IN ('SUPPLIER', 'STAFF')
        AND (d.uid IS NOT NULL OR p.uid IS NOT NULL)
      ORDER BY d.deliveries DESC NULLS LAST, p.collected DESC NULLS LAST, u.name`,
  ]);

  const salesMinor = sqlSumToMinor(money[0]?.sales);
  const collectedMinor = sqlSumToMinor(money[0]?.collected);
  const methodMinor = new Map(byMethod.map((r) => [r.method, sqlSumToMinor(r.amount)]));
  const c = cans[0];

  return {
    from: range.from,
    to: range.to,
    sales: {
      deliveries: Number(deliveries[0]?.deliveries ?? 0),
      cans: Number(deliveries[0]?.cans ?? 0),
      sales: fromMinor(salesMinor),
      collected: fromMinor(collectedMinor),
      duesChange: fromMinor(salesMinor - collectedMinor),
    },
    collectedByMethod: PAYMENT_METHODS.filter((m) => (methodMinor.get(m) ?? 0) !== 0).map((m) => ({
      method: m,
      amount: fromMinor(methodMinor.get(m) ?? 0),
    })),
    cashFlow,
    cans: {
      delivered: Number(c?.delivered ?? 0),
      emptiesBack: Number(c?.empties ?? 0),
      damagedFromClients: Number(c?.damaged_back ?? 0),
      damagedOrLostInStock: Number(c?.lost ?? 0),
      refilled: Number(c?.refilled ?? 0),
    },
    newClients,
    now: {
      outstanding: fromMinor(sqlSumToMinor(owing[0]?.outstanding)),
      clientsOwing: Number(owing[0]?.owing ?? 0),
      cansWithClients: Number(owing[0]?.cans ?? 0),
      stock,
    },
    topClients: topClients.map((r) => ({
      storeId: r.storeId,
      storeName: r.storeName,
      sales: fromMinor(sqlSumToMinor(r.sales)),
      collected: fromMinor(sqlSumToMinor(r.collected)),
    })),
    topOwing: topOwing.map((r) => ({ storeId: r.storeId, storeName: r.storeName, balance: fromMinor(sqlSumToMinor(r.balance)) })),
    people: people.map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      deliveries: Number(r.deliveries ?? 0),
      cans: Number(r.cans ?? 0),
      collected: fromMinor(sqlSumToMinor(r.collected)),
    })),
  };
}
