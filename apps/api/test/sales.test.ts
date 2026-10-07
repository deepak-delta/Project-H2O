import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { addStock, createProduct, createStore, sale, setPrice, setupBusiness, stockOf, storeDetail, type Business } from './fixtures';

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

async function quickSale(body: ReturnType<typeof sale>) {
  const res = await biz.client.post('/api/orders/quick-sale', body);
  return { res, body: res.json() };
}

describe('quick sale — payment scenarios', () => {
  it('full cash payment leaves nothing owed', async () => {
    const { res, body } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '500' }));
    expect(res.statusCode).toBe(201);
    expect(body.order).toMatchObject({ total: '500.00', amountPaid: '500.00', creditAmount: '0.00', paymentStatus: 'PAID', status: 'DELIVERED' });
    expect(body.storeBalance).toBe('0.00');

    const cash = await ctx.db.cashFlowEntry.findMany({ where: { supplierId: biz.supplierId } });
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ type: 'INCOME', category: 'WATER_SALE' });
    expect(cash[0]?.amount.toFixed(2)).toBe('500.00');
  });

  it('partial payment: ₹500 order, ₹200 paid → ₹300 credit', async () => {
    const { body } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '200', method: 'UPI' }));
    expect(body.order).toMatchObject({ amountPaid: '200.00', creditAmount: '300.00', paymentStatus: 'PARTIAL' });
    expect(body.storeBalance).toBe('300.00');
    expect(body.order.payments).toEqual([expect.objectContaining({ amount: '200.00', method: 'UPI' })]);
  });

  it('full credit: no payment row, whole amount owed', async () => {
    const { body } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    expect(body.order).toMatchObject({ paymentStatus: 'UNPAID', creditAmount: '500.00' });
    expect(body.storeBalance).toBe('500.00');
    expect(await ctx.db.payment.count()).toBe(0);
    expect(await ctx.db.cashFlowEntry.count()).toBe(0);
  });

  it('payment against an existing balance: 500 → 300 → 0', async () => {
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));

    const pay = (amount: string) =>
      biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount, method: 'CASH' });

    const first = await pay('200');
    expect(first.statusCode).toBe(201);
    expect(first.json().storeBalance).toBe('300.00');
    const second = await pay('300');
    expect(second.json().storeBalance).toBe('0.00');

    const recovery = await ctx.db.cashFlowEntry.findMany({ where: { category: 'CREDIT_RECOVERY' } });
    expect(recovery.map((r) => r.amount.toFixed(2)).sort()).toEqual(['200.00', '300.00']);
  });

  it('paying more than the bill clears older dues and splits cash flow correctly', async () => {
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 6 }], { amount: '0' })); // owes 300
    const { body } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '800' }));
    expect(body.storeBalance).toBe('0.00');
    // The order shows as paid in full, not "overpaid".
    expect(body.order).toMatchObject({ amountPaid: '500.00', creditAmount: '0.00', paymentStatus: 'PAID' });

    const flows = await ctx.db.cashFlowEntry.findMany();
    expect(flows).toHaveLength(2);
    expect(flows.map((f) => [f.category, f.amount.toFixed(2)])).toEqual(
      expect.arrayContaining([
        ['WATER_SALE', '500.00'],
        ['CREDIT_RECOVERY', '300.00'],
      ]),
    );
  });

  it('decimal amounts never drift: 3 × ₹33.33 − ₹0.99 discount, ₹50.50 paid', async () => {
    const { body } = await quickSale(
      sale(biz.storeId, [{ productId: biz.canId, quantity: 3, unitPrice: '33.33' }], { amount: '50.50' }, { discount: '0.99' }),
    );
    expect(body.order).toMatchObject({ subtotal: '99.99', discount: '0.99', total: '99.00', amountPaid: '50.50', creditAmount: '48.50' });
    expect(body.storeBalance).toBe('48.50');

    const ledger = await ctx.db.ledgerEntry.findMany({ orderBy: { type: 'asc' } });
    expect(ledger.map((l) => [l.type, l.amount.toFixed(2)])).toEqual(
      expect.arrayContaining([
        ['SALE', '99.99'],
        ['DISCOUNT', '-0.99'],
        ['PAYMENT', '-50.50'],
      ]),
    );
  });

  it('answers a malformed amount with a 400, not a crash', async () => {
    for (const amount of ['', 'abc', '1.234']) {
      const res = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount, method: 'CASH' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.amount).toBeDefined();
    }
  });

  it('rejects a discount larger than the order', async () => {
    const { res } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '0' }, { discount: '60' }));
    expect(res.statusCode).toBe(400);
    expect(await ctx.db.order.count()).toBe(0);
  });
});

describe('quick sale — cans and stock', () => {
  it('delivered 10, 7 empties back → store holds 3, stock moves accordingly', async () => {
    const { body } = await quickSale(
      sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 7 }], { amount: '500' }),
    );
    expect(body.order.items[0]).toMatchObject({ delivered: 10, emptyCollected: 7 });

    const store = await storeDetail(biz.client, biz.storeId);
    expect(store.cansOutstanding).toBe(3);
    expect(await stockOf(biz.client, biz.canId)).toMatchObject({ filled: 90, empty: 27, withCustomers: 3, damaged: 0 });

    const cans = await biz.client.get(`/api/stores/${biz.storeId}/cans`);
    expect(cans.json().items.map((m: { change: number }) => m.change).sort()).toEqual([-7, 10]);
  });

  it('non-returnable products leave stock but are not tracked at the store', async () => {
    const crateId = await createProduct(biz.client, { name: 'Bottle crate', isReturnable: false });
    await setPrice(biz.client, biz.storeId, crateId, '120');
    await addStock(biz.client, crateId, 30);
    await quickSale(sale(biz.storeId, [{ productId: crateId, quantity: 5 }], { amount: '0' }));
    expect(await stockOf(biz.client, crateId)).toMatchObject({ filled: 25, withCustomers: 0 });
    expect((await storeDetail(biz.client, biz.storeId)).cansOutstanding).toBe(0);

    const bad = await quickSale(sale(biz.storeId, [{ productId: crateId, quantity: 1, emptyCollected: 1 }], { amount: '0' }));
    expect(bad.res.statusCode).toBe(400);
  });

  it('a delivery larger than filled stock is accepted but flagged', async () => {
    const { res, body } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 120 }], { amount: '0' }));
    expect(res.statusCode).toBe(201);
    expect(body.order.stockWarning).toBe(true);
    expect((await stockOf(biz.client, biz.canId)).filled).toBe(-20);
  });

  it('every container stays accounted for (inventory equation)', async () => {
    // Opening 120 containers (100 filled + 20 empty). Then: deliveries, returns, refill, damage, purchase.
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 30, emptyCollected: 12 }], { amount: '0' }));
    const move = (body: Record<string, unknown>) =>
      biz.client.post('/api/inventory/movements', { clientId: crypto.randomUUID(), productId: biz.canId, ...body });
    expect((await move({ kind: 'REFILL', quantity: 25 })).statusCode).toBe(201);
    expect((await move({ kind: 'DAMAGE', from: 'EMPTY', quantity: 2 })).statusCode).toBe(201);
    expect((await move({ kind: 'PURCHASE', filled: 0, empty: 10 })).statusCode).toBe(201);
    expect((await move({ kind: 'LOSS', from: 'FILLED', quantity: 1, reason: 'Fell off van' })).statusCode).toBe(201);

    const s = await stockOf(biz.client, biz.canId);
    expect(s).toMatchObject({ filled: 100 - 30 + 25 - 1, empty: 20 + 12 - 25 - 2 + 10, withCustomers: 18, damaged: 2 });
    // opening 120 + purchased 10 − lost 1 = 129 containers in existence
    expect(s.filled + s.empty + s.withCustomers + s.damaged).toBe(129);
  });

  it('blocks refilling more empties than exist, and corrects counts by difference', async () => {
    const move = (body: Record<string, unknown>) =>
      biz.client.post('/api/inventory/movements', { clientId: crypto.randomUUID(), productId: biz.canId, ...body });
    const tooMany = await move({ kind: 'REFILL', quantity: 21 });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.message).toMatch(/Only 20 empty cans/);

    const correct = await move({ kind: 'ADJUSTMENT', countedFilled: 97, countedEmpty: 20, reason: 'Weekly count' });
    expect(correct.statusCode).toBe(201);
    expect(correct.json()).toMatchObject({ type: 'ADJUSTMENT', filledDelta: -3, emptyDelta: 0 });
    expect(await ctx.db.auditLog.count({ where: { action: 'STOCK_CORRECTED' } })).toBe(1);
  });

  it('collecting empties without a sale', async () => {
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    const clientId = crypto.randomUUID();
    const body = { clientId, items: [{ productId: biz.canId, quantity: 4 }] };
    const res = await biz.client.post(`/api/stores/${biz.storeId}/can-returns`, body);
    expect(res.statusCode).toBe(201);
    expect(res.json().cansOutstanding).toBe(6);
    // Retried request (e.g. flaky network) does not double count.
    const retry = await biz.client.post(`/api/stores/${biz.storeId}/can-returns`, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().cansOutstanding).toBe(6);
  });
});

describe('idempotency and concurrency', () => {
  it('replaying the same sale returns the original and records nothing new', async () => {
    const body = sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 2 }], { amount: '200' });
    const first = await quickSale(body);
    const again = await quickSale(body);
    expect(first.res.statusCode).toBe(201);
    expect(again.res.statusCode).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.order.id).toBe(first.body.order.id);
    expect(again.body.storeBalance).toBe('300.00');

    expect(await ctx.db.order.count()).toBe(1);
    expect(await ctx.db.payment.count()).toBe(1);
    expect(await ctx.db.ledgerEntry.count()).toBe(2);
    expect(await ctx.db.inventoryMovement.count({ where: { storeId: biz.storeId } })).toBe(2);
  });

  it('two identical requests racing each other still create one sale', async () => {
    const body = sale(biz.storeId, [{ productId: biz.canId, quantity: 5 }], { amount: '100' });
    const results = await Promise.all([quickSale(body), quickSale(body), quickSale(body)]);
    expect(new Set(results.map((r) => r.body.order.id)).size).toBe(1);
    expect(await ctx.db.order.count()).toBe(1);
    expect(await ctx.db.payment.count()).toBe(1);
  });

  it('duplicate payment submissions are recorded once', async () => {
    const body = { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '150', method: 'UPI' };
    const [a, b] = await Promise.all([biz.client.post('/api/payments', body), biz.client.post('/api/payments', body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await ctx.db.payment.count()).toBe(1);
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('-150.00');
  });

  it('concurrent sales get unique, gap-free order numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '50' }))),
    );
    expect(results.map((r) => r.body.order.orderNumber).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('store ledger', () => {
  it('opening balance and cans carry over from the notebook', async () => {
    const id = await createStore(biz.client, {
      name: 'Old Customer',
      openingBalance: '1250.50',
      openingCans: [{ productId: biz.canId, quantity: 5 }],
    });
    const store = await storeDetail(biz.client, id);
    expect(store.balance).toBe('1250.50');
    expect(store.cansOutstanding).toBe(5);
    // Opening cans are at the store, so the warehouse total grows but filled/empty don't change.
    expect(await stockOf(biz.client, biz.canId)).toMatchObject({ filled: 100, empty: 20, withCustomers: 5 });
  });

  it('shows a running balance on every row, across pages', async () => {
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' })); // +500
    await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '200', method: 'CASH' }); // 300
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '100' })); // +100 −100 → 300

    const page1 = (await biz.client.get(`/api/stores/${biz.storeId}/ledger?limit=2`)).json();
    const page2 = (await biz.client.get(`/api/stores/${biz.storeId}/ledger?limit=2&cursor=${page1.nextCursor}`)).json();
    const rows = [...page1.items, ...page2.items];
    expect(rows.map((r: { type: string; amount: string; balanceAfter: string }) => [r.type, r.amount, r.balanceAfter])).toEqual([
      ['PAYMENT', '-100.00', '300.00'],
      ['SALE', '100.00', '400.00'],
      ['PAYMENT', '-200.00', '300.00'],
      ['SALE', '500.00', '500.00'],
    ]);
    expect(page2.nextCursor).toBeNull();
  });

  it('lists stores that owe money and that hold cans', async () => {
    const other = await createStore(biz.client, { name: 'Balaji Mart', phone: '9822233344' });
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 4 }], { amount: '0' }));
    await quickSale(sale(other, [{ productId: biz.canId, quantity: 2, emptyCollected: 2 }], { amount: '100' }));

    const owes = (await biz.client.get('/api/stores?filter=owes')).json();
    expect(owes.items.map((s: { name: string }) => s.name)).toEqual(['Sri Ganesh Stores']);
    const byPhone = (await biz.client.get('/api/stores?search=23334')).json();
    expect(byPhone.items.map((s: { name: string }) => s.name)).toEqual(['Balaji Mart']);

    const holders = (await biz.client.get('/api/inventory/holders')).json();
    expect(holders).toEqual([expect.objectContaining({ storeName: 'Sri Ganesh Stores', quantity: 4 })]);
  });

  it('inactive stores cannot get new deliveries', async () => {
    await biz.client.post(`/api/stores/${biz.storeId}/status`, { status: 'INACTIVE' });
    const { res } = await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '0' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/inactive/);
  });
});

describe('dashboard', () => {
  it("adds up today's business", async () => {
    await quickSale(sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 7 }], { amount: '200' }));
    const other = await createStore(biz.client, { name: 'Balaji Mart', openingBalance: '100' });
    await quickSale(sale(other, [{ productId: biz.canId, quantity: 2 }], { amount: '100' }));

    const d = (await biz.client.get('/api/dashboard')).json();
    expect(d.today).toMatchObject({
      orders: 2,
      delivered: 2,
      pending: 0,
      sales: '600.00',
      cashCollected: '300.00',
      creditGiven: '300.00',
      cansDelivered: 12,
      emptiesCollected: 7,
    });
    expect(d.money).toEqual({ outstanding: '400.00', storesOwing: 2 });
    expect(d.inventory).toMatchObject({ filled: 88, empty: 27, withCustomers: 5 });
  });
});
