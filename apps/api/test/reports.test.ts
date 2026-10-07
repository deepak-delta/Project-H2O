import { addDays, toMinor, zonedDateKey } from '@wd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, type TestContext, rewriteHistoryForTest } from './helpers';
import { createStore, sale, setupBusiness, stockOf, storeUserClient, type Business } from './fixtures';

let ctx: TestContext;
let biz: Business;
const TZ = 'Asia/Kolkata';
const today = () => zonedDateKey(new Date(), TZ);

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  biz = await setupBusiness(ctx.app);
});

function entry(body: Record<string, unknown>) {
  return biz.client.post('/api/cashflow', { clientId: crypto.randomUUID(), method: 'CASH', ...body });
}

async function quickSale(storeId: string, quantity: number, paid: string) {
  const res = await biz.client.post('/api/orders/quick-sale', sale(storeId, [{ productId: biz.canId, quantity }], { amount: paid }));
  expect(res.statusCode).toBe(201);
  return res.json().order.id as string;
}

/** Moves every record of an order (and its payments) to a given instant. */
async function backdate(orderId: string, at: Date) {
  await rewriteHistoryForTest(ctx.db, async (tx) => {
    await tx.ledgerEntry.updateMany({ where: { orderId }, data: { occurredAt: at } });
    await tx.inventoryMovement.updateMany({ where: { orderId }, data: { occurredAt: at } });
  });
  await ctx.db.delivery.updateMany({ where: { orderId }, data: { deliveredAt: at } });
  await ctx.db.payment.updateMany({ where: { orderId }, data: { paymentDate: at } });
  await ctx.db.order.update({ where: { id: orderId }, data: { orderDate: at } });
}

describe('cash flow', () => {
  it('records expenses and other income alongside automatic sales income', async () => {
    await quickSale(biz.storeId, 10, '500');
    expect((await entry({ type: 'EXPENSE', category: 'FUEL', amount: '450.50', description: 'Van diesel' })).statusCode).toBe(201);
    expect((await entry({ type: 'EXPENSE', category: 'SALARY', amount: '300', method: 'UPI' })).statusCode).toBe(201);
    expect((await entry({ type: 'INCOME', category: 'DEPOSIT', amount: '100' })).statusCode).toBe(201);

    const s = (await biz.client.get(`/api/cashflow/summary?from=${today()}&to=${today()}`)).json();
    expect(s).toMatchObject({ moneyIn: '600.00', moneyOut: '750.50', net: '-150.50' });
    expect(s.byCategory).toEqual(
      expect.arrayContaining([
        { type: 'INCOME', category: 'WATER_SALE', amount: '500.00' },
        { type: 'EXPENSE', category: 'FUEL', amount: '450.50' },
      ]),
    );
    expect(s.byMethod).toEqual(
      expect.arrayContaining([
        { method: 'CASH', moneyIn: '600.00', moneyOut: '450.50', net: '149.50' },
        { method: 'UPI', moneyIn: '0.00', moneyOut: '300.00', net: '-300.00' },
      ]),
    );

    const list = (await biz.client.get(`/api/cashflow?from=${today()}&to=${today()}`)).json();
    expect(list.items).toHaveLength(4);
    expect(list.items.find((e: { category: string }) => e.category === 'WATER_SALE')).toMatchObject({ fromPayment: true, storeName: 'Sri Ganesh Stores' });

    const dash = (await biz.client.get('/api/dashboard')).json();
    expect(dash.today).toMatchObject({ expenses: '750.50', netCash: '-150.50' });
  });

  it('rejects categories that do not match money in/out, and future dates', async () => {
    expect((await entry({ type: 'EXPENSE', category: 'DEPOSIT', amount: '10' })).statusCode).toBe(400);
    // Sales income can only come from payments, never typed in.
    expect((await entry({ type: 'INCOME', category: 'WATER_SALE', amount: '10' })).statusCode).toBe(400);
    expect((await entry({ type: 'EXPENSE', category: 'FUEL', amount: '10', date: addDays(today(), 1) })).statusCode).toBe(400);
  });

  it('back-dated entries land on their own day', async () => {
    const yesterday = addDays(today(), -1);
    await entry({ type: 'EXPENSE', category: 'ELECTRICITY', amount: '1200', date: yesterday });
    const y = (await biz.client.get(`/api/cashflow/summary?from=${yesterday}&to=${yesterday}`)).json();
    const t = (await biz.client.get(`/api/cashflow/summary?from=${today()}&to=${today()}`)).json();
    expect(y.moneyOut).toBe('1200.00');
    expect(t.moneyOut).toBe('0.00');
  });

  it('a retried entry is recorded once', async () => {
    const body = { clientId: crypto.randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '99', method: 'CASH' };
    const [a, b] = await Promise.all([biz.client.post('/api/cashflow', body), biz.client.post('/api/cashflow', body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await ctx.db.cashFlowEntry.count()).toBe(1);
  });

  it('reversing an expense nets it out; payments must be reversed at the payment', async () => {
    const created = (await entry({ type: 'EXPENSE', category: 'MAINTENANCE', amount: '800' })).json();
    const rev = await biz.client.post(`/api/cashflow/${created.id}/reverse`, { reason: 'Typed twice' });
    expect(rev.statusCode).toBe(200);
    expect(rev.json()).toMatchObject({ amount: '-800.00', isReversal: true });
    expect((await biz.client.post(`/api/cashflow/${created.id}/reverse`, { reason: 'Typed twice' })).statusCode).toBe(409);
    expect((await biz.client.post(`/api/cashflow/${rev.json().id}/reverse`, { reason: 'Again' })).statusCode).toBe(400);
    expect((await biz.client.get(`/api/cashflow/summary?from=${today()}&to=${today()}`)).json().moneyOut).toBe('0.00');

    await quickSale(biz.storeId, 2, '100');
    const auto = await ctx.db.cashFlowEntry.findFirstOrThrow({ where: { paymentId: { not: null } } });
    expect((await biz.client.post(`/api/cashflow/${auto.id}/reverse`, { reason: 'Nope' })).statusCode).toBe(400);
  });

  it('validates the period', async () => {
    expect((await biz.client.get('/api/cashflow/summary?from=2026-10-05&to=2026-10-01')).statusCode).toBe(400);
    expect((await biz.client.get('/api/cashflow/summary?from=2025-01-01&to=2026-10-01')).statusCode).toBe(400);
    expect((await biz.client.get('/api/cashflow/summary?from=2026-02-30&to=2026-03-01')).statusCode).toBe(400);
  });
});

describe('sales report', () => {
  it('buckets by the business timezone, by day and by month', async () => {
    const a = await quickSale(biz.storeId, 4, '100'); // 00:30 IST on 1 Oct
    const b = await quickSale(biz.storeId, 2, '0'); // 22:30 IST on 30 Sep
    await backdate(a, new Date('2026-09-30T19:00:00Z'));
    await backdate(b, new Date('2026-09-30T17:00:00Z'));

    const daily = (await biz.client.get('/api/reports/sales?from=2026-09-29&to=2026-10-01')).json();
    expect(daily.rows).toEqual([
      { period: '2026-09-29', deliveries: 0, cans: 0, sales: '0.00', collected: '0.00', duesChange: '0.00' },
      { period: '2026-09-30', deliveries: 1, cans: 2, sales: '100.00', collected: '0.00', duesChange: '100.00' },
      { period: '2026-10-01', deliveries: 1, cans: 4, sales: '200.00', collected: '100.00', duesChange: '100.00' },
    ]);
    expect(daily.totals).toEqual({ deliveries: 2, cans: 6, sales: '300.00', collected: '100.00', duesChange: '200.00' });

    const monthly = (await biz.client.get('/api/reports/sales?from=2026-09-01&to=2026-10-31&groupBy=month')).json();
    expect(monthly.rows.map((r: { period: string; sales: string }) => [r.period, r.sales])).toEqual([
      ['2026-09', '100.00'],
      ['2026-10', '200.00'],
    ]);
  });

  it('cancelled deliveries and reversed payments do not count', async () => {
    const kept = await quickSale(biz.storeId, 5, '250');
    const cancelled = await quickSale(biz.storeId, 3, '0');
    await biz.client.post(`/api/orders/${cancelled}/cancel`, {});
    const payment = await ctx.db.payment.findFirstOrThrow({ where: { orderId: kept } });
    await biz.client.post(`/api/payments/${payment.id}/reverse`, { reason: 'Bounced UPI' });

    const r = (await biz.client.get(`/api/reports/sales?from=${today()}&to=${today()}`)).json();
    expect(r.totals).toEqual({ deliveries: 1, cans: 5, sales: '250.00', collected: '0.00', duesChange: '250.00' });
  });
});

describe('other reports', () => {
  it('outstanding: who owes what, biggest first', async () => {
    const other = await createStore(biz.client, { name: 'Balaji Mart' });
    const settled = await createStore(biz.client, { name: 'Paid Up' });
    await quickSale(biz.storeId, 4, '0'); // owes 200
    await quickSale(other, 10, '100'); // owes 400
    await quickSale(settled, 1, '50');

    const r = (await biz.client.get('/api/reports/outstanding')).json();
    expect(r.total).toBe('600.00');
    expect(r.rows.map((s: { storeName: string; balance: string }) => [s.storeName, s.balance])).toEqual([
      ['Balaji Mart', '400.00'],
      ['Sri Ganesh Stores', '200.00'],
    ]);
    expect(r.rows[0].lastPaymentAt).not.toBeNull();
    expect(r.rows[1]).toMatchObject({ lastPaymentAt: null, cans: 4 });
  });

  it('inventory: opening + movements = closing = current stock', async () => {
    const before = await ctx.db.inventoryMovement.findMany();
    // Push the opening stock into the past so it shows as the opening figure.
    await rewriteHistoryForTest(ctx.db, (tx) =>
      tx.inventoryMovement.updateMany({
        where: { id: { in: before.map((m) => m.id) } },
        data: { occurredAt: new Date(Date.now() - 3 * 86_400_000) },
      }),
    );
    await quickSale(biz.storeId, 10, '0');
    await biz.client.post(`/api/stores/${biz.storeId}/can-returns`, { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 6 }] });
    await biz.client.post('/api/inventory/movements', { kind: 'REFILL', clientId: crypto.randomUUID(), productId: biz.canId, quantity: 15 });

    const r = (await biz.client.get(`/api/reports/inventory?from=${addDays(today(), -1)}&to=${today()}`)).json();
    const p = r.products[0];
    expect(p.opening).toEqual({ filled: 100, empty: 20, withCustomers: 0, damaged: 0 });
    expect(p.movements).toEqual(
      expect.arrayContaining([
        { type: 'DELIVERY', filled: -10, empty: 0, withCustomers: 10, damaged: 0 },
        { type: 'RETURN', filled: 0, empty: 6, withCustomers: -6, damaged: 0 },
        { type: 'REFILL', filled: 15, empty: -15, withCustomers: 0, damaged: 0 },
      ]),
    );
    const current = await stockOf(biz.client, biz.canId);
    expect(p.closing).toEqual({ filled: current.filled, empty: current.empty, withCustomers: current.withCustomers, damaged: current.damaged });
    expect(p.closing).toEqual({ filled: 105, empty: 11, withCustomers: 4, damaged: 0 });
  });

  it('payments report lists every payment in the period', async () => {
    await quickSale(biz.storeId, 2, '100');
    await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '40.50', method: 'UPI' });
    const r = (await biz.client.get(`/api/reports/payments?from=${today()}&to=${today()}`)).json();
    expect(r.truncated).toBe(false);
    expect(r.rows.map((p: { amount: string }) => toMinor(p.amount)).reduce((a: number, b: number) => a + b, 0)).toBe(14050);
  });

  it('are supplier-only', async () => {
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000002');
    for (const url of [
      `/api/reports/sales?from=${today()}&to=${today()}`,
      '/api/reports/outstanding',
      `/api/reports/inventory?from=${today()}&to=${today()}`,
      `/api/cashflow/summary?from=${today()}&to=${today()}`,
    ]) {
      expect((await store.get(url)).statusCode).toBe(403);
    }
  });
});
