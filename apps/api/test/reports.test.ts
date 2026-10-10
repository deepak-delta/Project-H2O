import { addDays, toMinor, zonedDateKey } from '@wd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, closeTestContext, createTestContext, resetDb, type TestContext, rewriteHistoryForTest } from './helpers';
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
      `/api/reports/summary?from=${today()}&to=${today()}`,
    ]) {
      expect((await store.get(url)).statusCode).toBe(403);
    }
  });
});

describe('business summary', () => {
  it('puts sales, money, expenses, cans, clients and staff for a period on one page', async () => {
    const martId = await createStore(biz.client, { name: 'Mart', phone: '9811100077' });
    await biz.client.post('/api/staff', { name: 'Raju', phone: '9600000011', pin: '246810' });
    const raju = new Client(ctx.app);
    expect((await raju.post('/api/auth/login', { phone: '9600000011', pin: '246810' })).statusCode).toBe(200);

    // Owner: 10 cans to Sri Ganesh (₹50), ₹200 cash, 4 empties back.
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 4 }], { amount: '200' }));
    // Raju: 6 cans to Mart, ₹300 UPI, 1 broken can back at ₹120; later ₹100 cash from Sri Ganesh.
    await raju.post(
      '/api/orders/quick-sale',
      sale(martId, [{ productId: biz.canId, quantity: 6, damagedCollected: 1, damageChargeEach: '120' }], { amount: '300', method: 'UPI' }),
    );
    await raju.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '100', method: 'CASH' });
    await entry({ type: 'EXPENSE', category: 'FUEL', amount: '80' });
    const move = (body: Record<string, unknown>) => biz.client.post('/api/inventory/movements', { clientId: crypto.randomUUID(), productId: biz.canId, ...body });
    await move({ kind: 'DAMAGE', from: 'EMPTY', quantity: 2 });
    await move({ kind: 'REFILL', quantity: 5 });
    // Six weeks ago: 3 cans to Sri Ganesh on credit. Outside the last 7 days, inside 3 months.
    const old = await quickSale(biz.storeId, 3, '0');
    await backdate(old, new Date(Date.now() - 42 * 86_400_000));

    const week = (await biz.client.get(`/api/reports/summary?from=${addDays(today(), -6)}&to=${today()}`)).json();
    expect(week.sales).toEqual({ deliveries: 2, cans: 16, sales: '920.00', collected: '600.00', duesChange: '320.00' });
    expect(week.collectedByMethod).toEqual([
      { method: 'CASH', amount: '300.00' },
      { method: 'UPI', amount: '300.00' },
    ]);
    expect(week.cans).toEqual({ delivered: 16, emptiesBack: 4, damagedFromClients: 1, damagedOrLostInStock: 2, refilled: 5 });
    expect(week.cashFlow).toMatchObject({ moneyOut: '80.00' });
    expect(week.newClients).toBe(2);
    // Today's position: Sri Ganesh 500 − 200 − 100 + 150 old = 350; Mart 420 − 300 = 120.
    expect(week.now).toMatchObject({ outstanding: '470.00', clientsOwing: 2, cansWithClients: 10 - 4 + 3 + 6 - 1 });
    expect(week.now.stock[0]).toMatchObject({ filled: 100 - 10 - 6 - 3 + 5, empty: 20 + 4 - 2 - 5, damaged: 2 + 1 });
    expect(week.topClients.map((c: { storeName: string; sales: string }) => [c.storeName, c.sales])).toEqual([
      ['Sri Ganesh Stores', '500.00'],
      ['Mart', '420.00'],
    ]);
    expect(week.topOwing.map((c: { storeName: string; balance: string }) => [c.storeName, c.balance])).toEqual([
      ['Sri Ganesh Stores', '350.00'],
      ['Mart', '120.00'],
    ]);
    expect(week.people.map((p: { role: string; deliveries: number; cans: number; collected: string }) => [p.role, p.deliveries, p.cans, p.collected])).toEqual([
      ['STAFF', 1, 6, '400.00'],
      ['SUPPLIER', 1, 10, '200.00'],
    ]);

    // Same definitions as the sales report.
    const sales = (await biz.client.get(`/api/reports/sales?from=${addDays(today(), -6)}&to=${today()}`)).json();
    expect(sales.totals).toMatchObject({ deliveries: week.sales.deliveries, cans: week.sales.cans, sales: week.sales.sales, collected: week.sales.collected });

    // Three months includes the old credit sale.
    const quarter = (await biz.client.get(`/api/reports/summary?from=${addDays(today(), -90)}&to=${today()}`)).json();
    expect(quarter.sales).toEqual({ deliveries: 3, cans: 19, sales: '1070.00', collected: '600.00', duesChange: '470.00' });

    // A year is allowed; more than a year is not. Staff can't see it.
    expect((await biz.client.get(`/api/reports/summary?from=${addDays(today(), -365)}&to=${today()}`)).statusCode).toBe(200);
    expect((await biz.client.get(`/api/reports/summary?from=${addDays(today(), -400)}&to=${today()}`)).statusCode).toBe(400);
    expect((await raju.get(`/api/reports/summary?from=${today()}&to=${today()}`)).statusCode).toBe(403);
  });
});
