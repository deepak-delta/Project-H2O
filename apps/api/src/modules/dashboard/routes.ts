import { fromMinor, LOW_STOCK_FILLED_CANS, zonedDayRange, type DashboardSummary } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../../app';
import { requireAuth, requireSupplier } from '../../lib/auth-context';
import { getBusinessSettings } from '../../lib/business';
import { decToMinor, sqlSumToMinor } from '../../lib/money';
import { stockByProduct } from '../inventory/stock';
import { catchUpSchedules } from '../schedules/schedule';

const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const;

export function registerDashboardRoutes(app: FastifyInstance, { db, notifier }: Services): void {
  /**
   * "Anything new?", polled every few seconds while the app is open. One indexed lookup
   * returning when the data this person sees last changed; the app refreshes its screens only
   * when this moves, instead of re-running every screen on a timer. The owner and staff see the
   * whole business (a sale, payment, stock move, expense, an order placed or updated by anyone);
   * a client only their own orders, bills, payments and cans. Only a time is returned.
   */
  app.get('/api/changes', async (req) => {
    const auth = requireAuth(req);
    const { supplierId } = auth;
    const [row] =
      auth.role === 'STORE'
        ? await db.$queryRaw<{ at: Date | null }[]>`
            SELECT GREATEST(
              (SELECT MAX("createdAt") FROM "LedgerEntry" WHERE "supplierId" = ${supplierId} AND "storeId" = ${auth.storeId}),
              (SELECT MAX("createdAt") FROM "InventoryMovement" WHERE "supplierId" = ${supplierId} AND "storeId" = ${auth.storeId}),
              (SELECT MAX("updatedAt") FROM "Order" WHERE "storeId" = ${auth.storeId})
            ) AS at`
        : await db.$queryRaw<{ at: Date | null }[]>`
            SELECT GREATEST(
              (SELECT MAX("createdAt") FROM "LedgerEntry" WHERE "supplierId" = ${supplierId}),
              (SELECT MAX("createdAt") FROM "InventoryMovement" WHERE "supplierId" = ${supplierId}),
              (SELECT MAX("createdAt") FROM "CashFlowEntry" WHERE "supplierId" = ${supplierId}),
              (SELECT MAX("updatedAt") FROM "Order" WHERE "supplierId" = ${supplierId})
            ) AS at`;
    return { at: row?.at?.toISOString() ?? null };
  });

  app.get('/api/dashboard', async (req): Promise<DashboardSummary> => {
    const { supplierId } = requireSupplier(req);
    // Today's regular deliveries appear under Pending even if the morning job hasn't run.
    await catchUpSchedules({ db, notifier, log: req.log }, supplierId);
    const { timezone } = await getBusinessSettings(db, supplierId);
    const today = zonedDayRange(timezone);
    const inToday = { gte: today.start, lt: today.end };

    const [ordersToday, deliveredToday, pending, salesToday, paymentsToday, creditRows, outstandingRows, deliveredCans, stock, products, warnings, cashToday] =
      await Promise.all([
        db.order.count({ where: { supplierId, orderDate: inToday, status: { not: 'CANCELLED' } } }),
        db.delivery.count({ where: { supplierId, deliveredAt: inToday } }),
        db.order.count({ where: { supplierId, status: { in: [...OPEN_STATUSES] } } }),
        // Net sales = sales − discounts − reversals of sales, all from the ledger.
        db.ledgerEntry.aggregate({
          where: {
            supplierId,
            occurredAt: inToday,
            // Sale reversals (cancelled deliveries) carry no paymentId; payment reversals do.
            OR: [{ type: { in: ['SALE', 'DISCOUNT'] } }, { type: 'REVERSAL', paymentId: null }],
          },
          _sum: { amount: true },
        }),
        db.payment.aggregate({
          where: { supplierId, paymentDate: inToday, reversedAt: null },
          _sum: { amount: true },
        }),
        // Credit given today: for each of today's orders, the part not paid at the time.
        db.$queryRaw<{ credit: unknown }[]>`
          SELECT COALESCE(SUM(GREATEST(o.total - COALESCE(p.paid, 0), 0)), 0) AS credit
          FROM "Order" o
          LEFT JOIN LATERAL (
            SELECT SUM(amount) AS paid FROM "Payment"
            WHERE "orderId" = o.id AND "reversedAt" IS NULL
          ) p ON true
          WHERE o."supplierId" = ${supplierId}
            AND o.status IN ('DELIVERED', 'PARTIALLY_DELIVERED')
            AND o."orderDate" >= ${today.start} AND o."orderDate" < ${today.end}`,
        db.$queryRaw<{ outstanding: unknown; stores: bigint }[]>`
          SELECT COALESCE(SUM(balance), 0) AS outstanding, COUNT(*) AS stores
          FROM "ClientTotals"
          WHERE "supplierId" = ${supplierId} AND balance > 0`,
        db.inventoryMovement.groupBy({
          by: ['type'],
          // Reversals that undo a delivery (cancelled orders) net the counts back out.
          where: {
            supplierId,
            occurredAt: inToday,
            OR: [{ type: { in: ['DELIVERY', 'RETURN'] } }, { type: 'REVERSAL', deliveryId: { not: null } }],
          },
          _sum: { filledDelta: true, emptyDelta: true },
        }),
        stockByProduct(db, supplierId),
        db.product.findMany({ where: { supplierId, isReturnable: true }, select: { id: true } }),
        db.delivery.count({ where: { supplierId, stockWarning: true, deliveredAt: inToday } }),
        db.cashFlowEntry.groupBy({ by: ['type'], where: { supplierId, date: inToday }, _sum: { amount: true } }),
      ]);

    const inventory = { filled: 0, empty: 0, withCustomers: 0, damaged: 0 };
    for (const p of products) {
      const s = stock.get(p.id);
      if (!s) continue;
      inventory.filled += s.filled;
      inventory.empty += s.empty;
      inventory.withCustomers += s.withCustomers;
      inventory.damaged += s.damaged;
    }

    const incomeToday = decToMinor(cashToday.find((c) => c.type === 'INCOME')?._sum.amount);
    const expensesToday = decToMinor(cashToday.find((c) => c.type === 'EXPENSE')?._sum.amount);
    const sumOf = (type: string, field: 'filledDelta' | 'emptyDelta') => deliveredCans.find((r) => r.type === type)?._sum[field] ?? 0;
    // A reversed delivery adds filled cans back (+) and takes returned empties away (−).
    const cansDelivered = -(sumOf('DELIVERY', 'filledDelta') + sumOf('REVERSAL', 'filledDelta'));
    const emptiesCollected = sumOf('RETURN', 'emptyDelta') + sumOf('REVERSAL', 'emptyDelta');

    return {
      date: today.key,
      today: {
        orders: ordersToday,
        delivered: deliveredToday,
        pending,
        sales: fromMinor(decToMinor(salesToday._sum.amount)),
        cashCollected: fromMinor(decToMinor(paymentsToday._sum.amount)),
        creditGiven: fromMinor(sqlSumToMinor(creditRows[0]?.credit)),
        cansDelivered,
        emptiesCollected,
        expenses: fromMinor(expensesToday),
        netCash: fromMinor(incomeToday - expensesToday),
      },
      money: {
        outstanding: fromMinor(sqlSumToMinor(outstandingRows[0]?.outstanding)),
        storesOwing: Number(outstandingRows[0]?.stores ?? 0),
      },
      inventory: { ...inventory, lowStock: products.length > 0 && inventory.filled < LOW_STOCK_FILLED_CANS },
      stockWarnings: warnings,
    };
  });
}
