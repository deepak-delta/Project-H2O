import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NativePushSender, PushMessage, PushOutcome, PushResult, PushSender, PushTarget } from '../src/lib/push';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { createProduct, sale, setupBusiness, staffClient, storeUserClient, type Business } from './fixtures';

/** Records every push instead of sending it; individual endpoints can be told to fail. */
class FakeSender implements PushSender {
  readonly publicKey = 'BFakePublicKeyForTests000000000000000000000';
  sent: { endpoint: string; message: PushMessage }[] = [];
  responses = new Map<string, PushResult>();
  hang = false;

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (this.hang) return new Promise(() => undefined);
    this.sent.push({ endpoint: target.endpoint, message });
    return Promise.resolve({ result: this.responses.get(target.endpoint) ?? 'ok' });
  }

  to(endpoint: string): PushMessage[] {
    return this.sent.filter((s) => s.endpoint === endpoint).map((s) => s.message);
  }
}

/** Same idea for the native app's FCM tokens. */
class FakeNativeSender implements NativePushSender {
  sent: { token: string; message: PushMessage }[] = [];
  responses = new Map<string, PushResult>();

  send(token: string, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ token, message });
    return Promise.resolve({ result: this.responses.get(token) ?? 'ok' });
  }

  to(token: string): PushMessage[] {
    return this.sent.filter((s) => s.token === token).map((s) => s.message);
  }
}

const sender = new FakeSender();
const nativeSender = new FakeNativeSender();
let ctx: TestContext;
let biz: Business;
let store: Client;
const SUPPLIER_PHONE = 'https://push.example.com/supplier-phone';
const STORE_PHONE = 'https://push.example.com/store-phone';

const subscribe = (client: Client, endpoint: string) =>
  client.post('/api/push/subscribe', { endpoint, keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });

beforeAll(async () => {
  ctx = await createTestContext({}, { pushSender: sender, nativePushSender: nativeSender });
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  sender.sent = [];
  sender.responses.clear();
  sender.hang = false;
  nativeSender.sent = [];
  nativeSender.responses.clear();
  biz = await setupBusiness(ctx.app);
  store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000011');
  expect((await subscribe(biz.client, SUPPLIER_PHONE)).statusCode).toBe(204);
  expect((await subscribe(store, STORE_PHONE)).statusCode).toBe(204);
});

describe('subscriptions', () => {
  it('exposes the public key and only accepts https endpoints', async () => {
    expect((await biz.client.get('/api/push/config')).json()).toEqual({ enabled: true, publicKey: sender.publicKey, nativeEnabled: true });
    expect((await subscribe(biz.client, 'http://insecure.example.com/x')).statusCode).toBe(400);
    expect((await new Client(ctx.app).get('/api/push/config')).statusCode).toBe(401);
  });

  it('a browser used by a new person now belongs to them alone', async () => {
    const other = await signupSupplier(ctx.app);
    await subscribe(other.client, SUPPLIER_PHONE);
    const row = await ctx.db.pushSubscription.findUniqueOrThrow({ where: { endpoint: SUPPLIER_PHONE } });
    expect(row.userId).toBe(other.me.user.id);
  });

  it("can only remove one's own subscription", async () => {
    await store.post('/api/push/unsubscribe', { endpoint: SUPPLIER_PHONE });
    expect(await ctx.db.pushSubscription.count({ where: { endpoint: SUPPLIER_PHONE } })).toBe(1);
    await biz.client.post('/api/push/unsubscribe', { endpoint: SUPPLIER_PHONE });
    expect(await ctx.db.pushSubscription.count({ where: { endpoint: SUPPLIER_PHONE } })).toBe(0);
  });

  it('sends a test notification to my own devices', async () => {
    expect((await biz.client.post('/api/push/test')).json()).toEqual({ devices: 1, delivered: 1, failed: 0, sent: 1 });
    // A phone the push service rejects is reported as failed and dropped, so the app re-registers it.
    sender.responses.set(SUPPLIER_PHONE, 'gone');
    expect((await biz.client.post('/api/push/test')).json()).toEqual({ devices: 1, delivered: 0, failed: 1, sent: 0 });
    expect((await biz.client.post('/api/push/test')).json()).toEqual({ devices: 0, delivered: 0, failed: 0, sent: 0 });
    sender.responses.delete(SUPPLIER_PHONE);
    await subscribe(biz.client, SUPPLIER_PHONE);
    expect((await biz.client.post('/api/push/test')).json()).toMatchObject({ devices: 1, delivered: 1 });
    expect(sender.to(SUPPLIER_PHONE)[0]?.title).toBe('Notifications are on');
    expect(sender.to(STORE_PHONE)).toEqual([]);
  });
});

describe('who is told what', () => {
  it('a store order tells the supplier (once, even if the request is retried)', async () => {
    const body = { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 8 }], notes: 'Before 10am' };
    const placed = await store.post('/api/orders', body);
    await store.post('/api/orders', body);
    const msgs = sender.to(SUPPLIER_PHONE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ title: 'New order · Sri Ganesh Stores', url: `/orders/${placed.json().id}` });
    expect(msgs[0]?.body).toContain('8 cans');
    expect(msgs[0]?.body).toContain('Before 10am');
    expect(sender.to(STORE_PHONE)).toEqual([]);
  });

  it('accepting and sending out an order tell the store; repeating a status does not', async () => {
    const placed = (await store.post('/api/orders', { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 3 }] })).json();
    await biz.client.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    await biz.client.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    await biz.client.post(`/api/orders/${placed.id}/status`, { status: 'OUT_FOR_DELIVERY' });
    expect(sender.to(STORE_PHONE).map((m) => m.title)).toEqual(['Order accepted', 'Your water is on the way']);
  });

  it('a delivery tells the store the bill and new balance', async () => {
    const res = await biz.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 7 }], { amount: '200' }),
    );
    const [msg] = sender.to(STORE_PHONE);
    expect(msg).toMatchObject({ title: 'Delivered: 10 cans', url: `/orders/${res.json().order.id}` });
    expect(msg?.body).toBe('Bill ₹500 · paid ₹200 · 7 empties collected · You owe ₹300');
    expect(sender.to(SUPPLIER_PHONE)).toEqual([]);
  });

  it('a delivery by staff tells the owner; their own deliveries do not', async () => {
    const staff = await staffClient(ctx.app, biz.client, '9600000021', 'Raju');
    const res = await staff.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 4, emptyCollected: 4 }], { amount: '0' }),
    );
    expect(res.statusCode).toBe(201);
    expect(sender.to(SUPPLIER_PHONE)).toEqual([
      expect.objectContaining({ title: 'Delivered · Sri Ganesh Stores', body: '4 cans by Raju · Bill ₹200 · on credit', url: `/orders/${res.json().order.id}` }),
    ]);
    sender.sent = [];
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '50' }));
    expect(sender.to(SUPPLIER_PHONE)).toEqual([]);
  });

  it('payments and reversals tell the store', async () => {
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    sender.sent = [];
    const paid = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '200', method: 'UPI' });
    await biz.client.post(`/api/payments/${paid.json().payment.id}/reverse`, { reason: 'Bounced' });
    expect(sender.to(STORE_PHONE).map((m) => [m.title, m.body])).toEqual([
      ['Payment received: ₹200', 'You owe ₹300 · Aqua Fresh'],
      ['Payment of ₹200 was reversed', 'You owe ₹500 · Contact Aqua Fresh if this is wrong.'],
    ]);
  });

  it('cancellations tell the other side', async () => {
    const mine = (await store.post('/api/orders', { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 2 }] })).json();
    sender.sent = [];
    await store.post(`/api/orders/${mine.id}/cancel`, {});
    expect(sender.to(SUPPLIER_PHONE)[0]?.title).toBe(`Order #${mine.orderNumber} cancelled by Sri Ganesh Stores`);

    const theirs = (await store.post('/api/orders', { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 2 }] })).json();
    sender.sent = [];
    await biz.client.post(`/api/orders/${theirs.id}/cancel`, { reason: 'Van broke down' });
    expect(sender.to(STORE_PHONE)[0]).toMatchObject({ title: `Order #${theirs.orderNumber} was cancelled`, body: 'Van broke down' });
  });

  it('warns the supplier once when filled stock drops below the threshold', async () => {
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 85 }], { amount: '0' }));
    expect(sender.to(SUPPLIER_PHONE)).toEqual([]); // 15 left
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 7 }], { amount: '0' }));
    expect(sender.to(SUPPLIER_PHONE).map((m) => m.body)).toEqual(['Only 8 filled cans left. Refill or add stock.']);
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '0' }));
    expect(sender.to(SUPPLIER_PHONE)).toHaveLength(1);
  });

  it('payment reminders reach the store; not for settled stores or other businesses', async () => {
    expect((await biz.client.post(`/api/stores/${biz.storeId}/remind`)).statusCode).toBe(400);
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 4 }], { amount: '0' }));
    sender.sent = [];
    const res = await biz.client.post(`/api/stores/${biz.storeId}/remind`);
    expect(res.json()).toEqual({ sent: 1 });
    expect(sender.to(STORE_PHONE)[0]).toMatchObject({ title: 'Payment reminder from Aqua Fresh', url: '/statement' });

    const other = await signupSupplier(ctx.app);
    expect((await other.client.post(`/api/stores/${biz.storeId}/remind`)).statusCode).toBe(404);
  });
});

describe('reliability and privacy', () => {
  it('a subscription the push service reports gone is deleted', async () => {
    sender.responses.set(STORE_PHONE, 'gone');
    await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH' });
    expect(await ctx.db.pushSubscription.count({ where: { endpoint: STORE_PHONE } })).toBe(0);
  });

  it('a stuck push service never blocks or fails the sale', async () => {
    sender.hang = true;
    const started = Date.now();
    const res = await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '50' }));
    expect(res.statusCode).toBe(201);
    expect(Date.now() - started).toBeLessThan(6000);
  });

  it("ending a store's access removes its phones' subscriptions", async () => {
    await biz.client.delete(`/api/stores/${biz.storeId}/login`);
    expect(await ctx.db.pushSubscription.count({ where: { endpoint: STORE_PHONE } })).toBe(0);
    await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH' });
    expect(sender.to(STORE_PHONE)).toEqual([]);
  });

  it('push off on the server: everything still works, config says disabled', async () => {
    const off = await createTestContext({}, { pushSender: null });
    try {
      const { client } = await signupSupplier(off.app);
      expect((await client.get('/api/push/config')).json()).toEqual({ enabled: false, publicKey: null, nativeEnabled: false });
      expect((await client.post('/api/push/test')).statusCode).toBe(400);
      const productId = await createProduct(client);
      expect(productId).toBeTruthy();
    } finally {
      await closeTestContext(off);
    }
  });
});

describe('native app (Android) phones', () => {
  const SUPPLIER_APP = 'fcm-token-supplier-phone-0000000000000000';
  const STORE_APP = 'fcm-token-store-phone-00000000000000000000';
  const register = (client: Client, token: string) => client.post('/api/push/native/register', { token, platform: 'ANDROID', appVersion: '1' });

  beforeEach(async () => {
    expect((await register(biz.client, SUPPLIER_APP)).statusCode).toBe(204);
    expect((await register(store, STORE_APP)).statusCode).toBe(204);
  });

  it('needs a login and a sensible token', async () => {
    expect((await register(new Client(ctx.app), 'fcm-token-anonymous-000000000000000')).statusCode).toBe(401);
    expect((await biz.client.post('/api/push/native/register', { token: 'short', platform: 'ANDROID' })).statusCode).toBe(400);
    expect((await biz.client.post('/api/push/native/register', { token: SUPPLIER_APP, platform: 'WINDOWS' })).statusCode).toBe(400);
  });

  it('a phone handed to someone else now notifies them alone', async () => {
    const other = await signupSupplier(ctx.app);
    await register(other.client, SUPPLIER_APP);
    const rows = await ctx.db.nativePushToken.findMany({ where: { token: SUPPLIER_APP } });
    expect(rows.map((r) => r.userId)).toEqual([other.me.user.id]);
  });

  it("can only unregister one's own phone", async () => {
    await store.post('/api/push/native/unregister', { token: SUPPLIER_APP });
    expect(await ctx.db.nativePushToken.count({ where: { token: SUPPLIER_APP } })).toBe(1);
    await biz.client.post('/api/push/native/unregister', { token: SUPPLIER_APP });
    expect(await ctx.db.nativePushToken.count({ where: { token: SUPPLIER_APP } })).toBe(0);
  });

  it('business events reach both the browser and the app', async () => {
    const res = await biz.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 7 }], { amount: '200' }),
    );
    const expected = { title: 'Delivered: 10 cans', url: `/orders/${res.json().order.id}` };
    expect(sender.to(STORE_PHONE)[0]).toMatchObject(expected);
    expect(nativeSender.to(STORE_APP)[0]).toMatchObject(expected);
    expect(nativeSender.to(SUPPLIER_APP)).toEqual([]);
  });

  it('the test notification counts browsers and app phones', async () => {
    expect((await biz.client.post('/api/push/test')).json()).toEqual({ devices: 2, delivered: 2, failed: 0, sent: 2 });
    nativeSender.responses.set(SUPPLIER_APP, 'gone');
    expect((await biz.client.post('/api/push/test')).json()).toEqual({ devices: 2, delivered: 1, failed: 1, sent: 1 });
    // Uninstalled app: its token is dropped; the app registers a fresh one when reinstalled.
    expect(await ctx.db.nativePushToken.count({ where: { token: SUPPLIER_APP } })).toBe(0);
  });

  it("ending a store's access removes its app phones too", async () => {
    await biz.client.delete(`/api/stores/${biz.storeId}/login`);
    expect(await ctx.db.nativePushToken.count({ where: { token: STORE_APP } })).toBe(0);
  });

  it('only the app set up on the server: web push off, native still works', async () => {
    const appOnly = await createTestContext({}, { pushSender: null, nativePushSender: nativeSender });
    try {
      const { client } = await signupSupplier(appOnly.app);
      expect((await client.get('/api/push/config')).json()).toEqual({ enabled: false, publicKey: null, nativeEnabled: true });
      await register(client, 'fcm-token-app-only-0000000000000000000');
      expect((await client.post('/api/push/test')).json()).toMatchObject({ devices: 1, delivered: 1 });
    } finally {
      await closeTestContext(appOnly);
    }
  });
});
