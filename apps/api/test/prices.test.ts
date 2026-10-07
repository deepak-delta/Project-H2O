import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { addStock, createProduct, createStore, sale, setPrice, setupBusiness, storeDetail, storeUserClient, type Business } from './fixtures';

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

const quickSale = (body: ReturnType<typeof sale>) => biz.client.post('/api/orders/quick-sale', body);

describe('each store pays its own price', () => {
  it('the same delivery is billed at each store’s price', async () => {
    const cheap = await createStore(biz.client, { name: 'Bulk Buyer', prices: [{ productId: biz.canId, price: '40' }] });

    const a = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    const b = await quickSale(sale(cheap, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    expect(a.json().order.total).toBe('500.00');
    expect(b.json().order.total).toBe('400.00');
    expect((await storeDetail(biz.client, cheap)).balance).toBe('400.00');
  });

  it('a store must be created with a price for every product on sale', async () => {
    const res = await biz.client.post('/api/stores', { name: 'No Price Mart', prices: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/price for 20L can/);
  });

  it('rejects a zero or negative price', async () => {
    for (const price of ['0', '-5']) {
      const res = await biz.client.post('/api/stores', { name: 'Zero Mart', prices: [{ productId: biz.canId, price }] });
      expect(res.statusCode).toBe(400);
    }
  });

  it('suggests the most recently agreed price for a new store', async () => {
    await createStore(biz.client, { name: 'Bulk Buyer', prices: [{ productId: biz.canId, price: '45' }] });
    const res = await biz.client.get('/api/stores/price-suggestions');
    expect(res.json()).toEqual([{ productId: biz.canId, price: '45.00' }]);
  });

  it('changing a price affects future sales only, and is audited', async () => {
    const first = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '0' }));
    await setPrice(biz.client, biz.storeId, biz.canId, '55');
    const second = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '0' }));

    expect(second.json().order.total).toBe('110.00');
    const old = await biz.client.get(`/api/orders/${first.json().order.id}`);
    expect(old.json().total).toBe('100.00');
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('210.00');

    const log = await ctx.db.auditLog.findMany({ where: { supplierId: biz.supplierId, action: 'PRICE_CHANGED' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: 'Store', entityId: biz.storeId, before: { price: '50.00' }, after: { price: '55.00' } });
  });

  it('setting the same price again is not logged as a change', async () => {
    await setPrice(biz.client, biz.storeId, biz.canId, '50');
    expect(await ctx.db.auditLog.count({ where: { action: 'PRICE_CHANGED' } })).toBe(0);
  });
});

describe('a product the store has no price for yet', () => {
  let crateId: string;
  beforeEach(async () => {
    crateId = await createProduct(biz.client, { name: 'Bottle crate', isReturnable: false });
    await addStock(biz.client, crateId, 30);
  });

  it('cannot be sold without a price', async () => {
    const res = await quickSale(sale(biz.storeId, [{ productId: crateId, quantity: 1 }], { amount: '0' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/price for Bottle crate/);
    expect(await ctx.db.order.count()).toBe(0);
  });

  it('the price given on the first sale becomes the store’s price', async () => {
    const first = await quickSale(sale(biz.storeId, [{ productId: crateId, quantity: 2, unitPrice: '120' }], { amount: '0' }));
    expect(first.json().order.total).toBe('240.00');
    const detail = await biz.client.get(`/api/stores/${biz.storeId}`);
    expect(detail.json().prices).toContainEqual({ productId: crateId, price: '120.00' });

    const next = await quickSale(sale(biz.storeId, [{ productId: crateId, quantity: 1 }], { amount: '0' }));
    expect(next.json().order.total).toBe('120.00');
  });

  it('a retried offline sale does not set or change anything twice', async () => {
    const body = sale(biz.storeId, [{ productId: crateId, quantity: 2, unitPrice: '120' }], { amount: '0' });
    await quickSale(body);
    const replay = await quickSale(body);
    expect(replay.json().replayed).toBe(true);
    expect(await ctx.db.storePrice.count({ where: { storeId: biz.storeId, productId: crateId } })).toBe(1);
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('240.00');
  });

  it('a store owner cannot order it until the supplier sets their price', async () => {
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000009');
    const order = (items: { productId: string; quantity: number }[]) => store.post('/api/orders', { clientId: randomUUID(), items });

    const blocked = await order([{ productId: crateId, quantity: 1 }]);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.message).toMatch(/ask your supplier/);

    await setPrice(biz.client, biz.storeId, crateId, '110');
    const ok = await order([{ productId: crateId, quantity: 1 }]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().total).toBe('110.00');
  });
});

describe('who can see and change prices', () => {
  it('a store owner sees their own prices but cannot change them or send their own price', async () => {
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000010');
    const home = await store.get('/api/store/home');
    expect(home.json().prices).toEqual([{ productId: biz.canId, price: '50.00' }]);

    const change = await store.request('PUT', `/api/stores/${biz.storeId}/prices`, { prices: [{ productId: biz.canId, price: '1' }] });
    expect(change.statusCode).toBe(403);
    const sneaky = await store.post('/api/orders', { clientId: randomUUID(), items: [{ productId: biz.canId, quantity: 2, unitPrice: '1' }] });
    expect(sneaky.json().total).toBe('100.00');
  });

  it('another business cannot read or change this store’s prices', async () => {
    const other = await signupSupplier(ctx.app, { phone: '9555500001' });
    const change = await other.client.request('PUT', `/api/stores/${biz.storeId}/prices`, { prices: [{ productId: biz.canId, price: '1' }] });
    expect(change.statusCode).toBe(404);
    const suggestions = await other.client.get('/api/stores/price-suggestions');
    expect(suggestions.json()).toEqual([]);
  });

  it('cannot price another business’s product', async () => {
    const other = await signupSupplier(ctx.app, { phone: '9555500002' });
    const theirs = await createProduct(other.client);
    const res = await biz.client.request('PUT', `/api/stores/${biz.storeId}/prices`, { prices: [{ productId: theirs, price: '10' }] });
    expect(res.statusCode).toBe(400);
  });
});
