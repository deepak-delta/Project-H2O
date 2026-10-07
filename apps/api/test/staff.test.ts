import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushMessage, PushResult, PushSender, PushTarget } from '../src/lib/push';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, storeUserClient, type Business } from './fixtures';

class FakeSender implements PushSender {
  readonly publicKey = 'BFakePublicKeyForTests000000000000000000000';
  sent: { endpoint: string; message: PushMessage }[] = [];
  send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    this.sent.push({ endpoint: target.endpoint, message });
    return Promise.resolve('ok');
  }
}

const sender = new FakeSender();
let ctx: TestContext;
let biz: Business;
let staff: Client;
let staffId: string;

async function addStaff(owner: Client, phone: string, name = 'Raju'): Promise<{ client: Client; id: string }> {
  const res = await owner.post('/api/staff', { name, phone, pin: '246810' });
  if (res.statusCode !== 201) throw new Error(`staff: ${res.body}`);
  const client = new Client(ctx.app);
  const login = await client.post('/api/auth/login', { phone, pin: '246810' });
  if (login.statusCode !== 200) throw new Error(`staff login: ${login.body}`);
  return { client, id: res.json<{ id: string }>().id };
}

/** A store-placed order, optionally given to a member of staff. */
async function storeOrder(quantity: number, assignTo?: string): Promise<string> {
  const order = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity }] });
  const id = order.json<{ id: string }>().id;
  if (assignTo) expect((await biz.client.post(`/api/orders/${id}/assign`, { staffId: assignTo })).statusCode).toBe(200);
  return id;
}

const deliver = (client: Client, orderId: string, quantity: number) =>
  client.post(`/api/orders/${orderId}/deliver`, {
    clientId: randomUUID(),
    items: [{ productId: biz.canId, quantity }],
    payment: { amount: '0', method: 'CASH' },
  });

beforeAll(async () => {
  ctx = await createTestContext({}, { pushSender: sender });
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  sender.sent = [];
  biz = await setupBusiness(ctx.app);
  ({ client: staff, id: staffId } = await addStaff(biz.client, '9600000001'));
});

describe('adding staff', () => {
  it('the owner adds staff, who log in as staff', async () => {
    const me = await staff.get('/api/auth/me');
    expect(me.json().user).toMatchObject({ role: 'STAFF', name: 'Raju' });
    const list = await biz.client.get('/api/staff');
    expect(list.json()).toEqual([expect.objectContaining({ id: staffId, name: 'Raju', phone: '+919600000001', active: true })]);
  });

  it('a phone that already has a login is refused', async () => {
    const res = await biz.client.post('/api/staff', { name: 'Dup', phone: '9600000001', pin: '135790' });
    expect(res.statusCode).toBe(409);
  });

  it('only the owner manages staff', async () => {
    expect((await staff.post('/api/staff', { name: 'X', phone: '9600000099', pin: '135790' })).statusCode).toBe(403);
    expect((await staff.get('/api/staff')).statusCode).toBe(403);
    expect((await staff.patch(`/api/staff/${staffId}`, { active: false })).statusCode).toBe(403);
  });
});

describe('what staff can do', () => {
  it('delivers, collects money and empties, records expenses — all on their day', async () => {
    const sold = await staff.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 4 }], { amount: '300' }));
    expect(sold.statusCode).toBe(201);
    const paid = await staff.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount: '100', method: 'UPI' });
    expect(paid.statusCode).toBe(201);
    const empties = await staff.post(`/api/stores/${biz.storeId}/can-returns`, { clientId: randomUUID(), items: [{ productId: biz.canId, quantity: 2 }] });
    expect(empties.statusCode).toBe(201);
    const fuel = await staff.post('/api/cashflow', { clientId: randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '50', method: 'CASH' });
    expect(fuel.statusCode).toBe(201);

    const today = (await staff.get('/api/staff/today')).json();
    expect(today).toMatchObject({
      deliveries: 1,
      cansDelivered: 10,
      emptiesCollected: 6,
      sales: '500.00',
      collected: { total: '400.00', byMethod: { CASH: '300.00', UPI: '100.00' } },
      expenses: '50.00',
      cashInHand: '250.00',
    });
    expect(today.activity.map((a: { kind: string }) => a.kind).sort()).toEqual(['DELIVERY', 'EMPTIES', 'EXPENSE', 'PAYMENT']);

    // The owner's numbers include the staff member's work.
    const dash = (await biz.client.get('/api/dashboard')).json();
    expect(dash.today.sales).toBe('500.00');
    expect((await biz.client.get('/api/staff')).json()[0].today).toMatchObject({ deliveries: 1, cashInHand: '250.00' });
  });

  it('starts every day fresh: yesterday’s work is gone from their view but kept for the owner', async () => {
    await staff.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 3 }], { amount: '150' }));
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    // Move everything they did to yesterday.
    await ctx.db.delivery.updateMany({ data: { deliveredAt: yesterday } });
    await ctx.db.payment.updateMany({ data: { paymentDate: yesterday } });
    await ctx.db.order.updateMany({ data: { orderDate: yesterday, deliveryDate: yesterday } });

    const today = (await staff.get('/api/staff/today')).json();
    expect(today).toMatchObject({ deliveries: 0, cansDelivered: 0, collected: { total: '0.00' }, cashInHand: '0.00', activity: [] });
    expect((await staff.get('/api/orders')).json().items).toEqual([]);
    expect((await staff.get('/api/payments')).json().items).toEqual([]);

    expect((await biz.client.get('/api/orders')).json().items).toHaveLength(1);
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json().balance).toBe('0.00');
  });

  it('cannot record income or back-date an expense', async () => {
    const income = await staff.post('/api/cashflow', { clientId: randomUUID(), type: 'INCOME', category: 'OTHER_INCOME', amount: '50', method: 'CASH' });
    expect(income.statusCode).toBe(403);
    const backdated = await staff.post('/api/cashflow', {
      clientId: randomUUID(),
      type: 'EXPENSE',
      category: 'FUEL',
      amount: '50',
      method: 'CASH',
      date: '2020-01-01',
    });
    expect(backdated.statusCode).toBe(400);
  });
});

describe('what staff cannot see or do', () => {
  it('owner-only screens and actions are refused', async () => {
    const paymentId = (await biz.client.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH' })).json().payment.id;
    const forbidden: [string, string, unknown?][] = [
      ['GET', '/api/dashboard'],
      ['GET', '/api/inventory'],
      ['GET', '/api/inventory/movements'],
      ['GET', '/api/reports/sales?period=month'],
      ['GET', '/api/cashflow'],
      ['GET', '/api/cashflow/summary'],
      ['GET', `/api/stores/${biz.storeId}/ledger`],
      ['GET', `/api/stores/${biz.storeId}/cans`],
      ['GET', '/api/stores/price-suggestions'],
      ['POST', '/api/stores', { name: 'New', prices: [{ productId: biz.canId, price: '50' }] }],
      ['PATCH', `/api/stores/${biz.storeId}`, { name: 'Renamed' }],
      ['PUT', `/api/stores/${biz.storeId}/prices`, { prices: [{ productId: biz.canId, price: '1' }] }],
      ['POST', `/api/payments/${paymentId}/reverse`, { reason: 'mistake' }],
      ['POST', '/api/products', { name: 'Crate' }],
      ['POST', '/api/inventory/movements', { kind: 'OPENING', clientId: randomUUID(), productId: biz.canId, filled: 5, empty: 0 }],
      ['POST', '/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity: 1 }] }],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await staff.request(method as 'GET', path, body);
      expect([403, 404], `${method} ${path} → ${res.statusCode}`).toContain(res.statusCode);
      expect(res.statusCode, `${method} ${path}`).not.toBe(200);
    }
  });

  it('sees only their own payments, not the owner’s or other staff’s', async () => {
    const other = await addStaff(biz.client, '9600000002', 'Mani');
    await biz.client.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount: '70', method: 'CASH' });
    await other.client.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount: '80', method: 'CASH' });
    await staff.post('/api/payments', { clientId: randomUUID(), storeId: biz.storeId, amount: '90', method: 'CASH' });
    const mine = (await staff.get('/api/payments')).json().items;
    expect(mine.map((p: { amount: string }) => p.amount)).toEqual(['90.00']);
  });

  it('sees store balances but not app-login details or inactive stores', async () => {
    await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000020');
    const detail = (await staff.get(`/api/stores/${biz.storeId}`)).json();
    expect(detail).toMatchObject({ balance: '0.00', hasLogin: false, loginPhone: null });

    const closed = await createStore(biz.client, { name: 'Closed Shop' });
    await biz.client.post(`/api/stores/${closed}/status`, { status: 'INACTIVE' });
    expect((await staff.get(`/api/stores/${closed}`)).statusCode).toBe(404);
    const list = (await staff.get('/api/stores?filter=inactive')).json().items;
    expect(list.map((s: { name: string }) => s.name)).not.toContain('Closed Shop');
  });
});

describe('orders given to staff', () => {
  it('staff see and deliver only orders given to them', async () => {
    const mine = await storeOrder(5, staffId);
    const notMine = await storeOrder(4);

    const list = (await staff.get('/api/orders')).json().items;
    expect(list.map((o: { id: string }) => o.id)).toEqual([mine]);
    expect((await staff.get(`/api/orders/${notMine}`)).statusCode).toBe(404);
    expect((await deliver(staff, notMine, 4)).statusCode).toBe(404);

    const done = await deliver(staff, mine, 5);
    expect(done.statusCode).toBe(201);
    expect(done.json().order.status).toBe('DELIVERED');
    // Still visible today because they delivered it.
    expect((await staff.get(`/api/orders/${mine}`)).statusCode).toBe(200);
    expect((await staff.get('/api/staff/today')).json()).toMatchObject({ deliveries: 1, cansDelivered: 5, assignedOrders: [] });
  });

  it('another member of staff cannot deliver it', async () => {
    const other = await addStaff(biz.client, '9600000003', 'Mani');
    const order = await storeOrder(2, staffId);
    expect((await deliver(other.client, order, 2)).statusCode).toBe(404);
  });

  it('assigning notifies that staff member and shows on the order', async () => {
    await staff.post('/api/push/subscribe', { endpoint: 'https://push.example.com/raju', keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });
    const order = await storeOrder(3, staffId);
    expect(sender.sent.filter((s) => s.endpoint === 'https://push.example.com/raju').map((s) => s.message.title)).toEqual([
      'New delivery · Sri Ganesh Stores',
    ]);
    expect((await biz.client.get(`/api/orders/${order}`)).json().assignedTo).toEqual({ id: staffId, name: 'Raju' });
  });

  it('only the owner assigns, only to their own active staff', async () => {
    const order = await storeOrder(1);
    expect((await staff.post(`/api/orders/${order}/assign`, { staffId })).statusCode).toBe(403);
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000021');
    expect((await store.post(`/api/orders/${order}/assign`, { staffId })).statusCode).toBe(403);

    const otherBiz = await signupSupplier(ctx.app, { phone: '9555500010' });
    const theirStaff = (await otherBiz.client.post('/api/staff', { name: 'Theirs', phone: '9600000050', pin: '246810' })).json().id;
    expect((await biz.client.post(`/api/orders/${order}/assign`, { staffId: theirStaff })).statusCode).toBe(400);
  });

  it('cannot give a delivered or cancelled order', async () => {
    const order = await storeOrder(1);
    await biz.client.post(`/api/orders/${order}/cancel`, {});
    expect((await biz.client.post(`/api/orders/${order}/assign`, { staffId })).statusCode).toBe(400);
  });
});

describe('turning staff off', () => {
  it('signs them out and hands their open orders back to the owner', async () => {
    const order = await storeOrder(2, staffId);
    const off = await biz.client.patch(`/api/staff/${staffId}`, { active: false });
    expect(off.json().active).toBe(false);
    expect((await staff.get('/api/staff/today')).statusCode).toBe(401);
    expect((await biz.client.get(`/api/orders/${order}`)).json().assignedTo).toBeNull();

    const login = await new Client(ctx.app).post('/api/auth/login', { phone: '9600000001', pin: '246810' });
    expect(login.statusCode).not.toBe(200);
  });

  it('a new PIN signs them out everywhere', async () => {
    await biz.client.request('PUT', `/api/staff/${staffId}/pin`, { pin: '135791' });
    expect((await staff.get('/api/staff/today')).statusCode).toBe(401);
    const login = await new Client(ctx.app).post('/api/auth/login', { phone: '9600000001', pin: '135791' });
    expect(login.statusCode).toBe(200);
  });

  it('another business cannot see or manage this staff member', async () => {
    const other = await signupSupplier(ctx.app, { phone: '9555500011' });
    expect((await other.client.get(`/api/staff/${staffId}/today`)).statusCode).toBe(404);
    expect((await other.client.patch(`/api/staff/${staffId}`, { active: false })).statusCode).toBe(404);
  });
});
