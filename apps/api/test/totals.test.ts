import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, type Business } from './fixtures';

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

/** Full recount from the history, to compare with the running totals. */
async function recount() {
  const [stock] = await ctx.db.$queryRaw<{ filled: bigint; empty: bigint; with_clients: bigint }[]>`
    SELECT SUM("filledDelta") filled, SUM("emptyDelta") empty, SUM("withCustomersDelta") with_clients FROM "InventoryMovement" WHERE "productId" = ${biz.canId}`;
  const balances = await ctx.db.$queryRaw<{ storeId: string; balance: string }[]>`
    SELECT "storeId", SUM(amount)::text balance FROM "LedgerEntry" GROUP BY 1`;
  const cans = await ctx.db.$queryRaw<{ storeId: string; cans: bigint }[]>`
    SELECT "storeId", SUM("withCustomersDelta") cans FROM "InventoryMovement" WHERE "storeId" IS NOT NULL GROUP BY 1`;
  return { stock, balances, cans };
}

describe('running totals', () => {
  it('always equal a full recount of the history', async () => {
    const other = await createStore(biz.client, { name: 'Other', openingBalance: '75', openingCans: [{ productId: biz.canId, quantity: 4 }] });
    const s1 = (await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 3 }], { amount: '200' }))).json();
    await biz.client.post('/api/orders/quick-sale', sale(other, [{ productId: biz.canId, quantity: 6, emptyCollected: 6 }], { amount: '0' }));
    const pay = (await biz.client.post('/api/payments', { clientId: randomUUID(), storeId: other, amount: '50', method: 'UPI' })).json().payment;
    await biz.client.post(`/api/payments/${pay.id}/reverse`, { reason: 'test' });
    await biz.client.post(`/api/stores/${biz.storeId}/can-returns`, { clientId: randomUUID(), items: [{ productId: biz.canId, quantity: 2 }] });
    await biz.client.post(`/api/orders/${s1.order.id}/cancel`, { reason: 'test' });
    await biz.client.request('PUT', `/api/stores/${other}/cans`, { clientId: randomUUID(), items: [{ productId: biz.canId, quantity: 9 }] });

    const r = await recount();
    const ps = await ctx.db.productStock.findUniqueOrThrow({ where: { productId: biz.canId } });
    expect({ filled: ps.filled, empty: ps.empty, with: ps.withCustomers }).toEqual({ filled: Number(r.stock?.filled), empty: Number(r.stock?.empty), with: Number(r.stock?.with_clients) });
    for (const b of r.balances) {
      const t = await ctx.db.clientTotals.findUniqueOrThrow({ where: { storeId: b.storeId } });
      expect(t.balance.toFixed(2)).toBe(Number(b.balance).toFixed(2));
    }
    for (const c of r.cans) {
      const t = await ctx.db.clientTotals.findUniqueOrThrow({ where: { storeId: c.storeId } });
      expect(t.cans).toBe(Number(c.cans));
    }
    // And the screens agree with both.
    expect((await biz.client.get(`/api/stores/${other}`)).json().cansOutstanding).toBe(9);
  });

  it('history cannot be edited or deleted, only added to', async () => {
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '0' }));
    await expect(ctx.db.ledgerEntry.updateMany({ data: { amount: '1' } })).rejects.toThrow(/append-only/);
    await expect(ctx.db.ledgerEntry.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(ctx.db.inventoryMovement.updateMany({ data: { filledDelta: 5 } })).rejects.toThrow(/append-only/);
    await expect(ctx.db.inventoryMovement.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
