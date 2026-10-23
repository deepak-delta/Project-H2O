import { addDays, zonedDateKey } from '@wd/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushMessage, PushOutcome, PushSender, PushTarget } from '../src/lib/push';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, storeUserClient, type Business } from './fixtures';

class FakeSender implements PushSender {
  readonly publicKey = 'BFakePublicKeyForTests000000000000000000000';
  sent: { endpoint: string; message: PushMessage }[] = [];
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, message });
    return Promise.resolve({ result: 'ok' });
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

describe('deleting staff', () => {
  it('logs them out for good, frees the phone, gives back their orders, and keeps their past work', async () => {
    // Raju delivers one order today and has another waiting.
    const done = await storeOrder(4, staffId);
    expect((await deliver(staff, done, 4)).statusCode).toBe(201);
    const waiting = await storeOrder(6, staffId);

    expect((await biz.client.delete(`/api/staff/${staffId}`)).statusCode).toBe(204);

    expect((await staff.get('/api/auth/me')).statusCode).toBe(401);
    expect((await new Client(ctx.app).post('/api/auth/login', { phone: '9600000001', pin: '246810' })).statusCode).toBe(401);
    expect((await biz.client.get('/api/staff')).json()).toEqual([]);
    expect((await biz.client.get(`/api/staff/${staffId}/today`)).statusCode).toBe(404);
    expect((await biz.client.get(`/api/orders/${waiting}`)).json().assignedTo).toBeNull();
    // The delivery they made is still theirs.
    const delivery = await ctx.db.delivery.findFirstOrThrow({ where: { orderId: done }, include: { deliveredBy: { select: { name: true } } } });
    expect(delivery.deliveredBy.name).toBe('Raju');
    expect(await ctx.db.auditLog.count({ where: { action: 'STAFF_DELETED', entityId: staffId } })).toBe(1);

    // The number can be given to someone new.
    expect((await biz.client.post('/api/staff', { name: 'Suresh', phone: '9600000001', pin: '135790' })).statusCode).toBe(201);
    // And the deleted person can't be given orders.
    const order = await storeOrder(2);
    expect((await biz.client.post(`/api/orders/${order}/assign`, { staffId })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('only the owner of that business can delete', async () => {
    const other = await signupSupplier(ctx.app);
    expect((await other.client.delete(`/api/staff/${staffId}`)).statusCode).toBe(404);
    expect((await staff.delete(`/api/staff/${staffId}`)).statusCode).toBe(403);
    expect((await staff.get('/api/auth/me')).statusCode).toBe(200);
  });
});

describe("the owner's live-update check", () => {
  it('moves when staff record something; staff and clients have their own', async () => {
    const before = (await biz.client.get('/api/changes')).json().at;
    await new Promise((r) => setTimeout(r, 5));
    await staff.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '50' }));
    const after = (await biz.client.get('/api/changes')).json().at;
    expect(after).not.toBe(before);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());

    expect((await staff.get('/api/changes')).json().at).toBe(after);
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000030');
    expect((await store.get('/api/changes')).statusCode).toBe(200);
  });

  it('another business’s activity does not move it', async () => {
    const before = (await biz.client.get('/api/changes')).json().at;
    const other = await signupSupplier(ctx.app, { phone: '9555500020' });
    await other.client.post('/api/cashflow', { clientId: randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '10', method: 'CASH' });
    expect((await biz.client.get('/api/changes')).json().at).toBe(before);
  });
});

describe('owner creates an order for later and gives it to staff', () => {
  it('is accepted already, given to staff on creation, and they are notified', async () => {
    await staff.post('/api/push/subscribe', { endpoint: 'https://push.example.com/raju-2', keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });
    const res = await biz.client.post('/api/orders', {
      clientId: randomUUID(),
      storeId: biz.storeId,
      items: [{ productId: biz.canId, quantity: 6 }],
      assignedToId: staffId,
      notes: 'Back gate',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'CONFIRMED', source: 'SUPPLIER', total: '300.00', assignedTo: { id: staffId, name: 'Raju' } });
    expect(sender.sent.filter((s) => s.endpoint === 'https://push.example.com/raju-2')).toHaveLength(1);

    const day = (await staff.get('/api/staff/today')).json();
    expect(day.assignedOrders.map((o: { id: string }) => o.id)).toEqual([res.json().id]);
    expect((await deliver(staff, res.json().id, 6)).statusCode).toBe(201);
  });

  it('refuses another business’s staff, and a client cannot assign or set prices', async () => {
    const other = await signupSupplier(ctx.app, { phone: '9555500030' });
    const theirs = (await other.client.post('/api/staff', { name: 'T', phone: '9600000060', pin: '246810' })).json().id;
    const bad = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity: 1 }], assignedToId: theirs });
    expect(bad.statusCode).toBe(400);

    const client = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000040');
    const sneaky = await client.post('/api/orders', {
      clientId: randomUUID(),
      items: [{ productId: biz.canId, quantity: 2, unitPrice: '1' }],
      assignedToId: staffId,
    });
    expect(sneaky.statusCode).toBe(201);
    expect(sneaky.json()).toMatchObject({ status: 'PENDING', total: '100.00', assignedTo: null });
  });

  it('the owner can price a product the client has no price for yet', async () => {
    const crate = (await biz.client.post('/api/products', { name: 'Bottle crate', isReturnable: false })).json().id;
    const res = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: crate, quantity: 2, unitPrice: '120' }] });
    expect(res.json().total).toBe('240.00');
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json().prices).toContainEqual({ productId: crate, price: '120.00' });
  });
});

describe('client type', () => {
  it('defaults to Store, and "Other" needs its own label', async () => {
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json()).toMatchObject({ category: 'STORE', categoryOther: null });
    const prices = [{ productId: biz.canId, price: '40' }];
    const home = await biz.client.post('/api/stores', { name: 'Sharma house', category: 'HOME', prices });
    expect(home.json()).toMatchObject({ category: 'HOME', categoryOther: null });
    const missing = await biz.client.post('/api/stores', { name: 'Office', category: 'OTHER', prices });
    expect(missing.statusCode).toBe(400);
    const office = await biz.client.post('/api/stores', { name: 'Tech Park', category: 'OTHER', categoryOther: 'Office', prices });
    expect(office.json()).toMatchObject({ category: 'OTHER', categoryOther: 'Office' });
    const list = (await biz.client.get('/api/stores?search=Tech')).json().items;
    expect(list[0]).toMatchObject({ category: 'OTHER', categoryOther: 'Office' });

    // Search finds clients by type too, and by part of a name.
    const names = async (q: string) => (await biz.client.get(`/api/stores?search=${q}`)).json().items.map((c: { name: string }) => c.name);
    expect(await names('offi')).toEqual(['Tech Park']);
    expect(await names('home')).toEqual(['Sharma house']);
    expect(await names('shar')).toEqual(['Sharma house']);
  });
});

describe('cans at a client = cans already there + delivered − empties back', () => {
  const setCans = (client: Client, storeId: string, quantity: number, clientId = randomUUID()) =>
    client.request('PUT', `/api/stores/${storeId}/cans`, { clientId, items: [{ productId: biz.canId, quantity }] });

  it('the owner can set the cans already at a client; later deliveries and empties build on it', async () => {
    const stockBefore = (await biz.client.get('/api/inventory')).json()[0];
    const res = await setCans(biz.client, biz.storeId, 20);
    expect(res.statusCode).toBe(200);
    expect(res.json().cansOutstanding).toBe(20);
    // The owner's own stock doesn't change: those cans were already out with the client.
    const stockAfter = (await biz.client.get('/api/inventory')).json()[0];
    expect(stockAfter).toMatchObject({ filled: stockBefore.filled, empty: stockBefore.empty, withCustomers: stockBefore.withCustomers + 20 });

    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 5, emptyCollected: 3 }], { amount: '0' }));
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json().cansOutstanding).toBe(22); // 20 + 5 − 3

    // Correcting again records only the difference, with an audit entry.
    await setCans(biz.client, biz.storeId, 18);
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json().cansOutstanding).toBe(18);
    const log = await ctx.db.auditLog.findMany({ where: { action: 'CLIENT_CANS_CORRECTED' }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => [l.before, l.after])).toEqual([
      [{ productId: biz.canId, cans: 0 }, { productId: biz.canId, cans: 20 }],
      [{ productId: biz.canId, cans: 22 }, { productId: biz.canId, cans: 18 }],
    ]);
  });

  it('a retried request does not correct twice', async () => {
    const id = randomUUID();
    await setCans(biz.client, biz.storeId, 10, id);
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '0' }));
    await setCans(biz.client, biz.storeId, 10, id); // replay of the first request
    expect((await biz.client.get(`/api/stores/${biz.storeId}`)).json().cansOutstanding).toBe(12);
  });

  it('only the owner, only their own clients and returnable cans', async () => {
    expect((await setCans(staff, biz.storeId, 5)).statusCode).toBe(403);
    const client = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000050');
    expect((await setCans(client, biz.storeId, 5)).statusCode).toBe(403);
    const other = await signupSupplier(ctx.app, { phone: '9555500040' });
    expect((await setCans(other.client, biz.storeId, 5)).statusCode).toBe(404);
    const crate = (await biz.client.post('/api/products', { name: 'Crate', isReturnable: false })).json().id;
    const bad = await biz.client.request('PUT', `/api/stores/${biz.storeId}/cans`, { clientId: randomUUID(), items: [{ productId: crate, quantity: 3 }] });
    expect(bad.statusCode).toBe(400);
  });
});

describe('giving many orders to staff at once', () => {
  const place = async (quantity: number, deliveryDate?: string) => {
    const res = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity }], ...(deliveryDate ? { deliveryDate } : {}) });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; orderNumber: number }>();
  };

  it('assigns them all, skips delivered ones, and sends one summary', async () => {
    await staff.post('/api/push/subscribe', { endpoint: 'https://push.example.com/raju-bulk', keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });
    const a = await place(3);
    const b = await place(4);
    const done = await place(2);
    expect((await deliver(biz.client, done.id, 2)).statusCode).toBe(201);
    sender.sent = [];

    const res = await biz.client.post('/api/orders/assign', { orderIds: [a.id, b.id, done.id], staffId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assigned: 2, skipped: 1 });

    const rows = await ctx.db.order.findMany({ where: { id: { in: [a.id, b.id, done.id] } }, select: { id: true, assignedToId: true } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.assignedToId]))).toEqual({ [a.id]: staffId, [b.id]: staffId, [done.id]: null });
    const pushes = sender.sent.filter((s) => s.endpoint === 'https://push.example.com/raju-bulk');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.message).toMatchObject({ title: 'New deliveries: 2 orders', body: '7 cans · Sri Ganesh Stores' });

    const day = (await staff.get('/api/staff/today')).json<{ assignedOrders: { id: string }[] }>();
    expect(day.assignedOrders.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());

    // Again: nothing new for them, so no second notification. Then back to the owner.
    sender.sent = [];
    await biz.client.post('/api/orders/assign', { orderIds: [a.id, b.id], staffId });
    expect(sender.sent).toHaveLength(0);
    expect((await biz.client.post('/api/orders/assign', { orderIds: [a.id], staffId: null })).json()).toEqual({ assigned: 1, skipped: 0 });
    expect((await ctx.db.order.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBeNull();
  });

  it('later orders reach staff on their day only', async () => {
    const tomorrow = addDays(zonedDateKey(new Date(), 'Asia/Kolkata'), 1);
    const later = await place(5, tomorrow);
    await biz.client.post('/api/orders/assign', { orderIds: [later.id], staffId });
    expect((await staff.get('/api/staff/today')).json().assignedOrders).toEqual([]);
  });

  it("refuses another business's orders, unknown staff, and anyone but the owner", async () => {
    const mine = await place(1);
    const other = await signupSupplier(ctx.app, { phone: '9555500060' });
    expect((await other.client.post('/api/orders/assign', { orderIds: [mine.id], staffId: null })).statusCode).toBe(404);
    expect((await biz.client.post('/api/orders/assign', { orderIds: [mine.id], staffId: 'nobody' })).statusCode).toBe(400);
    expect((await biz.client.post('/api/orders/assign', { orderIds: [], staffId })).statusCode).toBe(400);
    expect((await staff.post('/api/orders/assign', { orderIds: [mine.id], staffId })).statusCode).toBe(403);
    expect((await ctx.db.order.findUniqueOrThrow({ where: { id: mine.id } })).assignedToId).toBeNull();
  });
});

describe('can staff be notified?', () => {
  it('shows the owner whether a phone of theirs gets notifications', async () => {
    const list = async () => (await biz.client.get('/api/staff')).json<{ id: string; canNotify: boolean }[]>().find((s) => s.id === staffId);
    expect(await list()).toMatchObject({ canNotify: false });
    await staff.post('/api/push/subscribe', { endpoint: 'https://push.example.com/raju-can', keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });
    expect(await list()).toMatchObject({ canNotify: true });
  });
});
