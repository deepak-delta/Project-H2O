import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, storeUserClient, type Business } from './fixtures';

let ctx: TestContext;
let biz: Business;
let store: Client;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  biz = await setupBusiness(ctx.app);
  store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000001');
});

describe('store app access', () => {
  it('store owners sign in to their own store', async () => {
    const me = (await store.get('/api/auth/me')).json();
    expect(me).toMatchObject({ user: { role: 'STORE', storeId: biz.storeId }, store: { name: 'Sri Ganesh Stores' } });
    const detail = (await biz.client.get(`/api/stores/${biz.storeId}`)).json();
    expect(detail).toMatchObject({ hasLogin: true, loginPhone: '+919700000001' });
  });

  it('a phone number can only belong to one login', async () => {
    const other = await createStore(biz.client, { name: 'Balaji Mart' });
    const res = await biz.client.request('PUT', `/api/stores/${other}/login`, { phone: '9700000001', pin: '111222' });
    expect(res.statusCode).toBe(409);
  });

  it('resetting the PIN signs the store out; disabling blocks it', async () => {
    await biz.client.request('PUT', `/api/stores/${biz.storeId}/login`, { phone: '9700000001', pin: '999888' });
    expect((await store.get('/api/auth/me')).statusCode).toBe(401);

    const again = new Client(ctx.app);
    expect((await again.post('/api/auth/login', { phone: '9700000001', pin: '999888' })).statusCode).toBe(200);
    await biz.client.delete(`/api/stores/${biz.storeId}/login`);
    expect((await again.get('/api/auth/me')).statusCode).toBe(401);
    expect((await new Client(ctx.app).post('/api/auth/login', { phone: '9700000001', pin: '999888' })).statusCode).toBe(401);
  });

  it('deactivating the store blocks its login, and reactivating does not silently restore it', async () => {
    await biz.client.post(`/api/stores/${biz.storeId}/status`, { status: 'INACTIVE' });
    expect((await store.get('/api/auth/me')).statusCode).toBe(401);
    await biz.client.post(`/api/stores/${biz.storeId}/status`, { status: 'ACTIVE' });
    expect((await new Client(ctx.app).post('/api/auth/login', { phone: '9700000001', pin: '135790' })).statusCode).toBe(401);
  });
});

describe('store permissions', () => {
  it.each(['/api/stores', '/api/dashboard', '/api/inventory', '/api/inventory/holders', `/api/orders?storeId=x`])(
    'cannot use supplier screens: %s',
    async (url) => {
      const res = await store.get(url);
      // Order list is allowed but scoped; the rest are supplier-only.
      if (url.startsWith('/api/orders')) expect(res.statusCode).toBe(200);
      else expect(res.statusCode).toBe(403);
    },
  );

  it('cannot record sales, payments, stock or change orders', async () => {
    const quick = await store.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '0' }));
    expect(quick.statusCode).toBe(403);
    const pay = await store.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '1', method: 'CASH' });
    expect(pay.statusCode).toBe(403);
    const stock = await store.post('/api/inventory/movements', { kind: 'PURCHASE', clientId: crypto.randomUUID(), productId: biz.canId, filled: 1, empty: 0 });
    expect(stock.statusCode).toBe(403);
    const products = await store.patch(`/api/products/${biz.canId}`, { name: 'x', sellingPrice: '1' });
    expect(products.statusCode).toBe(403);
  });

  it("sees only its own store's orders, payments and ledger", async () => {
    const otherId = await createStore(biz.client, { name: 'Balaji Mart' });
    const otherSale = await biz.client.post('/api/orders/quick-sale', sale(otherId, [{ productId: biz.canId, quantity: 3 }], { amount: '50' }));
    const ownSale = await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '100' }));

    const orders = (await store.get(`/api/orders?storeId=${otherId}`)).json();
    expect(orders.items.map((o: { id: string }) => o.id)).toEqual([ownSale.json().order.id]);
    expect((await store.get(`/api/orders/${otherSale.json().order.id}`)).statusCode).toBe(404);

    const payments = (await store.get('/api/payments')).json();
    expect(payments.items).toHaveLength(1);
    expect(payments.items[0].storeId).toBe(biz.storeId);

    expect((await store.get(`/api/stores/${otherId}/ledger`)).statusCode).toBe(404);
    expect((await store.get(`/api/stores/${biz.storeId}/ledger`)).statusCode).toBe(200);
    // Store detail (with internal notes, credit limit) stays supplier-only.
    expect((await store.get(`/api/stores/${biz.storeId}`)).statusCode).toBe(403);
  });
});

describe('ordering water from the store app', () => {
  it('places an order for its own store, whatever storeId it sends', async () => {
    const otherId = await createStore(biz.client, { name: 'Balaji Mart' });
    const res = await store.post('/api/orders', {
      clientId: crypto.randomUUID(),
      storeId: otherId,
      items: [{ productId: biz.canId, quantity: 8 }],
      deliveryDate: '2026-10-02',
      notes: 'Before 10am please',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ storeId: biz.storeId, status: 'PENDING', source: 'STORE', total: '400.00', notes: 'Before 10am please' });
    expect(res.json().deliveryDate).toBe('2026-10-01T18:30:00.000Z');
  });

  it('can cancel its own order only while pending', async () => {
    const place = () =>
      store.post('/api/orders', { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 2 }] });
    const first = (await place()).json();
    expect((await store.post(`/api/orders/${first.id}/cancel`, {})).json().status).toBe('CANCELLED');

    const second = (await place()).json();
    await biz.client.post(`/api/orders/${second.id}/status`, { status: 'CONFIRMED' });
    const late = await store.post(`/api/orders/${second.id}/cancel`, {});
    expect(late.statusCode).toBe(403);
    expect(late.json().error.message).toMatch(/call/);
  });

  it('home screen shows balance, cans and recent activity', async () => {
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 2 }], { amount: '200' }));
    await store.post('/api/orders', { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 5 }] });

    const home = (await store.get('/api/store/home')).json();
    expect(home).toMatchObject({
      store: { name: 'Sri Ganesh Stores' },
      supplier: { businessName: 'Aqua Fresh' },
      balance: '300.00',
      cansOutstanding: 8,
      lastDelivery: { quantity: 10 },
      lastOrderItems: [{ productId: biz.canId, quantity: 10 }],
    });
    expect(home.openOrders).toHaveLength(1);
    expect(home.recentOrders).toHaveLength(2);
    expect(home.recentPayments).toEqual([expect.objectContaining({ amount: '200.00' })]);
    expect((await biz.client.get('/api/store/home')).statusCode).toBe(403);
  });
});
