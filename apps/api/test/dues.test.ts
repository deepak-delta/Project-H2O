import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, staffClient, storeDetail, storeUserClient, type Business } from './fixtures';

let ctx: TestContext;
let biz: Business;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  biz = await setupBusiness(ctx.app);
});

const sell = async (quantity: number, paid: string, extra: Record<string, unknown> = {}, storeId = biz.storeId) => {
  const res = await biz.client.post('/api/orders/quick-sale', sale(storeId, [{ productId: biz.canId, quantity }], { amount: paid }, extra));
  expect(res.statusCode).toBe(201);
  return res.json<{ order: { id: string; orderNumber: number } }>().order;
};
const pay = (amount: string) => biz.client.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount, method: 'CASH' });
const dues = async (storeId = biz.storeId) => {
  const res = await biz.client.get(`/api/stores/${storeId}/dues`);
  expect(res.statusCode).toBe(200);
  return res.json<{
    balance: string;
    broughtForward: string;
    items: { orderId: string; orderNumber: number; cans: number; billed: string; due: string }[];
  }>();
};

describe('what a client owes, bill by bill', () => {
  it('is empty when nothing is owed', async () => {
    await sell(2, '100');
    expect(await dues()).toMatchObject({ balance: '0.00', broughtForward: '0.00', items: [] });
  });

  it('counts payments against the oldest bills first', async () => {
    const a = await sell(10, '0'); // ₹500
    const b = await sell(6, '0'); // ₹300
    const c = await sell(4, '0'); // ₹200
    expect((await pay('600')).statusCode).toBe(201); // clears a, ₹100 of b

    const d = await dues();
    expect(d.balance).toBe('400.00');
    expect(d.broughtForward).toBe('0.00');
    expect(d.items.map((i) => i.orderId)).not.toContain(a.id);
    expect(d.items).toEqual([
      expect.objectContaining({ orderId: b.id, orderNumber: b.orderNumber, cans: 6, billed: '300.00', due: '200.00' }),
      expect.objectContaining({ orderId: c.id, orderNumber: c.orderNumber, cans: 4, billed: '200.00', due: '200.00' }),
    ]);
  });

  it('shows what was left unpaid at the delivery', async () => {
    const o = await sell(10, '200');
    expect((await dues()).items).toEqual([expect.objectContaining({ orderId: o.id, billed: '500.00', due: '300.00' })]);
  });

  it('puts an old notebook balance in "brought forward"', async () => {
    const res = await biz.client.post('/api/stores', {
      name: 'Old Shop',
      phone: '9811100001',
      openingBalance: '150',
      prices: [{ productId: biz.canId, price: '50' }],
    });
    const storeId = res.json<{ id: string }>().id;
    await sell(2, '0', {}, storeId);
    const d = await dues(storeId);
    expect(d).toMatchObject({ balance: '250.00', broughtForward: '150.00' });
    expect(d.items).toEqual([expect.objectContaining({ billed: '100.00', due: '100.00', cans: 2 })]);
  });

  it('bills a discount net and a damaged-can charge in full', async () => {
    const o = await sell(4, '0', { discount: '20' }); // 200 − 20
    const damaged = await biz.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 2, emptyCollected: 0, damagedCollected: 1, damageChargeEach: '150' }], { amount: '0' }),
    );
    expect(damaged.statusCode).toBe(201);
    const d = await dues();
    expect(d.items).toEqual([
      expect.objectContaining({ orderId: o.id, billed: '180.00', due: '180.00' }),
      expect.objectContaining({ orderId: damaged.json().order.id, billed: '250.00', due: '250.00' }),
    ]);
    expect(d.balance).toBe('430.00');
  });

  it('leaves out a cancelled delivery', async () => {
    const kept = await sell(2, '0');
    const cancelled = await sell(5, '0');
    expect((await biz.client.post(`/api/orders/${cancelled.id}/cancel`, { reason: 'Wrong shop' })).statusCode).toBe(200);
    const d = await dues();
    expect(d.items.map((i) => i.orderId)).toEqual([kept.id]);
    expect(d.balance).toBe('100.00');
  });

  it('always adds up to the balance', async () => {
    await sell(3, '20');
    await sell(7, '0', { discount: '15' });
    await pay('90');
    await sell(1, '50');
    await sell(9, '100');
    const d = await dues();
    const sum = d.items.reduce((s, i) => s + Math.round(Number(i.due) * 100), Math.round(Number(d.broughtForward) * 100));
    expect(sum).toBe(Math.round(Number((await storeDetail(biz.client, biz.storeId)).balance) * 100));
  });

  it('is for the owner only, and only their own clients', async () => {
    await sell(2, '0');
    const { client: staff } = await staffClient(ctx.app, biz.client, '9700000041');
    expect((await staff.get(`/api/stores/${biz.storeId}/dues`)).statusCode).toBe(403);
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000042');
    expect((await store.get(`/api/stores/${biz.storeId}/dues`)).statusCode).toBe(403);
    const other = await signupSupplier(ctx.app, { phone: '9555500041' });
    expect((await other.client.get(`/api/stores/${biz.storeId}/dues`)).statusCode).toBe(404);
  });

  it('the outstanding report carries the owner name for the greeting', async () => {
    await sell(2, '0');
    const report = (await biz.client.get('/api/reports/outstanding')).json<{ rows: { storeId: string; ownerName: string | null }[] }>();
    expect(report.rows).toEqual([expect.objectContaining({ storeId: biz.storeId, ownerName: 'Ganesh' })]);
  });
});

describe('client location', () => {
  const link = 'https://maps.app.goo.gl/AbC123xyz';

  it('takes a pasted Google Maps share (link inside text), and can be cleared', async () => {
    const id = await createStore(biz.client, { name: 'Map Shop', phone: '9811100002', mapLink: `Map Shop ${link}` });
    expect((await biz.client.get(`/api/stores/${id}`)).json().mapLink).toBe(link);

    const cleared = await biz.client.request('PATCH', `/api/stores/${id}`, { name: 'Map Shop', category: 'STORE', mapLink: '' });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().mapLink).toBeNull();
  });

  it('refuses links that are not maps', async () => {
    for (const bad of ['https://evil.example.com/maps', 'http://maps.app.goo.gl/x', 'https://www.google.com/search?q=x', 'javascript:alert(1)', 'not a link']) {
      const res = await biz.client.post('/api/stores', { name: 'Bad', phone: '9811100003', mapLink: bad, prices: [{ productId: biz.canId, price: '50' }] });
      expect(res.statusCode, bad).toBe(400);
    }
    const ok = ['https://www.google.com/maps/place/Chennai', 'https://maps.google.co.in/?q=12.9,80.2', 'https://maps.apple.com/?ll=12.9,80.2'];
    for (const [n, good] of ok.entries()) {
      const res = await biz.client.post('/api/stores', { name: `Good ${n}`, phone: `981110001${n}`, mapLink: good, prices: [{ productId: biz.canId, price: '50' }] });
      expect(res.statusCode, good).toBe(201);
    }
  });

  it('staff see it on the orders given to them', async () => {
    await biz.client.request('PATCH', `/api/stores/${biz.storeId}`, { name: 'Sri Ganesh Stores', category: 'STORE', address: '12 Main Road', mapLink: link });
    const { client: staff, id: staffId } = await staffClient(ctx.app, biz.client, '9700000043');
    const order = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity: 3 }], assignedToId: staffId });
    expect(order.statusCode).toBe(201);

    const day = (await staff.get('/api/staff/today')).json();
    expect(day.assignedOrders[0]).toMatchObject({ storeAddress: '12 Main Road', storeMapLink: link });
    expect((await staff.get(`/api/orders/${order.json().id}`)).json()).toMatchObject({ storeAddress: '12 Main Road', storeMapLink: link });
    expect((await staff.get(`/api/stores/${biz.storeId}`)).json()).toMatchObject({ mapLink: link });
  });
});

describe('"anything new?" for staff and clients', () => {
  it("a client's check moves with their own deliveries only", async () => {
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000044');
    const otherStore = await createStore(biz.client, { name: 'Other', phone: '9811100020' });
    await sell(1, '50');
    const before = (await store.get('/api/changes')).json().at;
    expect(before).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    await sell(2, '0', {}, otherStore);
    await biz.client.post('/api/cashflow', { clientId: randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '10', method: 'CASH' });
    expect((await store.get('/api/changes')).json().at).toBe(before);

    await new Promise((r) => setTimeout(r, 5));
    await pay('20');
    const after = (await store.get('/api/changes')).json().at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('staff see the whole business move', async () => {
    const { client: staff } = await staffClient(ctx.app, biz.client, '9700000045');
    const before = (await staff.get('/api/changes')).json().at;
    await new Promise((r) => setTimeout(r, 5));
    await biz.client.post('/api/cashflow', { clientId: randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '10', method: 'CASH' });
    expect(new Date((await staff.get('/api/changes')).json().at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});
