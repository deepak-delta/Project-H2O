import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveOccurredAt } from '../src/lib/occurred-at';
import { closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { sale, setupBusiness, type Business } from './fixtures';

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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe('entries saved offline keep the time they really happened', () => {
  it('a quick sale synced later is dated when it was made', async () => {
    const at = hoursAgo(5);
    const res = await biz.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 3, emptyCollected: 1 }], { amount: '100' }, { occurredAt: at.toISOString() }),
    );
    expect(res.statusCode).toBe(201);
    const order = await ctx.db.order.findUniqueOrThrow({ where: { id: res.json().order.id }, include: { deliveries: true, payments: true } });
    expect(order.orderDate.toISOString()).toBe(at.toISOString());
    expect(order.deliveries[0]?.deliveredAt.toISOString()).toBe(at.toISOString());
    expect(order.payments[0]?.paymentDate.toISOString()).toBe(at.toISOString());
    const ledger = await ctx.db.ledgerEntry.findMany({ where: { orderId: order.id } });
    expect(ledger.every((l) => l.occurredAt.toISOString() === at.toISOString())).toBe(true);
    const moves = await ctx.db.inventoryMovement.findMany({ where: { orderId: order.id } });
    expect(moves.every((m) => m.occurredAt.toISOString() === at.toISOString())).toBe(true);
  });

  it('payments, can returns and delivered orders honour the time too', async () => {
    const at = hoursAgo(2).toISOString();
    const pay = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '50', method: 'CASH', occurredAt: at });
    expect(pay.json().payment.paymentDate).toBe(at);

    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 4 }], { amount: '0' }));
    await biz.client.post(`/api/stores/${biz.storeId}/can-returns`, { clientId: crypto.randomUUID(), items: [{ productId: biz.canId, quantity: 2 }], occurredAt: at });
    const ret = await ctx.db.inventoryMovement.findFirstOrThrow({ where: { type: 'RETURN' } });
    expect(ret.occurredAt.toISOString()).toBe(at);

    const placed = await biz.client.post('/api/orders', { clientId: crypto.randomUUID(), storeId: biz.storeId, items: [{ productId: biz.canId, quantity: 5 }], occurredAt: at });
    expect(placed.json().orderDate).toBe(at);
    const delivered = await biz.client.post(`/api/orders/${placed.json().id}/deliver`, {
      clientId: crypto.randomUUID(),
      items: [{ productId: biz.canId, quantity: 5 }],
      payment: { amount: '0', method: 'CASH' },
      occurredAt: at,
    });
    expect(delivered.json().order.deliveredAt).toBe(at);
  });

  it('a phone clock running ahead is clamped to now; very old entries are refused', async () => {
    const future = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const res = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH', occurredAt: future });
    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().payment.paymentDate).getTime()).toBeLessThanOrEqual(Date.now());

    const old = hoursAgo(31 * 24).toISOString();
    const tooOld = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH', occurredAt: old });
    expect(tooOld.statusCode).toBe(400);

    const bad = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '10', method: 'CASH', occurredAt: 'yesterday' });
    expect(bad.statusCode).toBe(400);
  });

  it('resolveOccurredAt rules', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(resolveOccurredAt(null, now)).toBe(now);
    expect(resolveOccurredAt('2026-10-01T12:00:00Z', now)).toBe(now);
    expect(resolveOccurredAt('2026-09-30T10:00:00+05:30', now).toISOString()).toBe('2026-09-30T04:30:00.000Z');
    expect(() => resolveOccurredAt('2026-08-01T00:00:00Z', now)).toThrow();
  });

  it('a sync retried many times still records one sale', async () => {
    const body = sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '100' }, { occurredAt: hoursAgo(1).toISOString() });
    const results = await Promise.all(Array.from({ length: 4 }, () => biz.client.post('/api/orders/quick-sale', body)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(await ctx.db.order.count()).toBe(1);
    expect(await ctx.db.payment.count()).toBe(1);
  });
});
