import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { sale, setupBusiness, type Business } from './fixtures';

/**
 * IDOR checks: Supplier B must never read or write Supplier A's records, even with valid IDs.
 * Every failure looks like "not found" so B can't even learn that the record exists.
 */
let ctx: TestContext;
let a: Business;
let b: Business;
let aOrderId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  a = await setupBusiness(ctx.app);
  b = await setupBusiness(ctx.app);
  const res = await a.client.post('/api/orders/quick-sale', sale(a.storeId, [{ productId: a.canId, quantity: 3 }], { amount: '0' }));
  aOrderId = res.json().order.id;
});

describe('cross-business access is denied', () => {
  it.each([
    ['store detail', () => `/api/stores/${a.storeId}`],
    ['store ledger', () => `/api/stores/${a.storeId}/ledger`],
    ['order detail', () => `/api/orders/${aOrderId}`],
  ])('cannot read %s', async (_name, url) => {
    const res = await b.client.get(url());
    expect(res.statusCode).toBe(404);
  });

  it("does not leak A's records into B's lists", async () => {
    const stores = (await b.client.get('/api/stores')).json();
    expect(stores.items.map((s: { id: string }) => s.id)).not.toContain(a.storeId);
    const orders = (await b.client.get(`/api/orders?storeId=${a.storeId}`)).json();
    expect(orders.items).toEqual([]);
    expect((await b.client.get(`/api/stores/${a.storeId}/cans`)).statusCode).toBe(404);
  });

  it("cannot sell to A's store or use A's product", async () => {
    const toAStore = await b.client.post('/api/orders/quick-sale', sale(a.storeId, [{ productId: b.canId, quantity: 1 }], { amount: '0' }));
    expect(toAStore.statusCode).toBe(404);
    const withAProduct = await b.client.post('/api/orders/quick-sale', sale(b.storeId, [{ productId: a.canId, quantity: 1 }], { amount: '0' }));
    expect(withAProduct.statusCode).toBe(404);
  });

  it("cannot record payments, returns or stock changes on A's records", async () => {
    const pay = await b.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: a.storeId, amount: '10', method: 'CASH' });
    expect(pay.statusCode).toBe(404);
    const ret = await b.client.post(`/api/stores/${a.storeId}/can-returns`, {
      clientId: crypto.randomUUID(),
      items: [{ productId: a.canId, quantity: 1 }],
    });
    expect(ret.statusCode).toBe(404);
    const stock = await b.client.post('/api/inventory/movements', {
      kind: 'PURCHASE',
      clientId: crypto.randomUUID(),
      productId: a.canId,
      filled: 5,
      empty: 0,
    });
    expect(stock.statusCode).toBe(404);
    const edit = await b.client.patch(`/api/stores/${a.storeId}`, { name: 'Hijacked' });
    expect(edit.statusCode).toBe(404);
    const status = await b.client.post(`/api/stores/${a.storeId}/status`, { status: 'INACTIVE' });
    expect(status.statusCode).toBe(404);
    const product = await b.client.patch(`/api/products/${a.canId}`, { name: 'x' });
    expect(product.statusCode).toBe(404);

    // And nothing changed for A.
    const aStore = (await a.client.get(`/api/stores/${a.storeId}`)).json();
    expect(aStore).toMatchObject({ name: 'Sri Ganesh Stores', status: 'ACTIVE', balance: '150.00' });
  });

  it('anonymous requests are rejected everywhere', async () => {
    const anon = new Client(ctx.app);
    for (const url of ['/api/stores', '/api/orders', '/api/inventory', '/api/dashboard', '/api/payments', '/api/products']) {
      expect((await anon.get(url)).statusCode).toBe(401);
    }
  });
});

describe('order lifecycle, reversals, cash flow and reports stay within one business', () => {
  it("cannot change, deliver or cancel A's orders, or reverse A's money", async () => {
    const placed = await a.client.post('/api/orders', { clientId: crypto.randomUUID(), storeId: a.storeId, items: [{ productId: a.canId, quantity: 2 }] });
    const pendingId = placed.json().id;
    expect((await b.client.post(`/api/orders/${pendingId}/status`, { status: 'CONFIRMED' })).statusCode).toBe(404);
    const deliver = await b.client.post(`/api/orders/${pendingId}/deliver`, {
      clientId: crypto.randomUUID(),
      items: [{ productId: a.canId, quantity: 2 }],
      payment: { amount: '0', method: 'CASH' },
    });
    expect(deliver.statusCode).toBe(404);
    expect((await b.client.post(`/api/orders/${aOrderId}/cancel`, {})).statusCode).toBe(404);

    const paid = await a.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: a.storeId, amount: '50', method: 'CASH' });
    expect((await b.client.post(`/api/payments/${paid.json().payment.id}/reverse`, { reason: 'Not mine' })).statusCode).toBe(404);

    const expense = await a.client.post('/api/cashflow', { clientId: crypto.randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '99', method: 'CASH' });
    expect((await b.client.post(`/api/cashflow/${expense.json().id}/reverse`, { reason: 'Not mine' })).statusCode).toBe(404);

    expect((await b.client.request('PUT', `/api/stores/${a.storeId}/login`, { phone: '9700000099', pin: '111222' })).statusCode).toBe(404);
    expect((await b.client.delete(`/api/stores/${a.storeId}/login`)).statusCode).toBe(404);

    // A is untouched.
    const order = (await a.client.get(`/api/orders/${pendingId}`)).json();
    expect(order.status).toBe('PENDING');
    expect((await a.client.get(`/api/orders/${aOrderId}`)).json().status).toBe('DELIVERED');
  });

  it("B's reports and cash flow never include A's numbers", async () => {
    await a.client.post('/api/cashflow', { clientId: crypto.randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '500', method: 'CASH' });
    // A's sale (₹150) and expense exist; B has had no activity at all.
    const sales = (await b.client.get(`/api/reports/sales?from=2026-01-01&to=2026-12-31&groupBy=month`)).json();
    expect(sales.totals).toMatchObject({ sales: '0.00', deliveries: 0 });
    expect((await b.client.get('/api/reports/outstanding')).json().rows).toEqual([]);
    expect((await b.client.get(`/api/reports/payments?from=2026-01-01&to=2026-12-31`)).json().rows).toEqual([]);
    expect((await b.client.get('/api/cashflow/summary?from=2026-01-01&to=2026-12-31')).json().moneyOut).toBe('0.00');
  });
});
