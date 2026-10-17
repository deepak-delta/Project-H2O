import { fromMinor, toMinor } from '@wd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { sale, setPrice, setupBusiness, stockOf, storeDetail, type Business } from './fixtures';

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

async function placeOrder(quantity: number) {
  const res = await biz.client.post('/api/orders', {
    clientId: crypto.randomUUID(),
    storeId: biz.storeId,
    items: [{ productId: biz.canId, quantity }],
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function deliver(orderId: string, quantity: number, extra: Record<string, unknown> = {}) {
  return biz.client.post(`/api/orders/${orderId}/deliver`, {
    clientId: crypto.randomUUID(),
    items: [{ productId: biz.canId, quantity, emptyCollected: 0 }],
    payment: { amount: '0', method: 'CASH' },
    ...extra,
  });
}

/** Invariant: an order's billed total equals the net of its sale-side ledger entries. */
async function ledgerNetForOrder(orderId: string): Promise<string> {
  const rows = await ctx.db.ledgerEntry.findMany({ where: { orderId, paymentId: null } });
  return fromMinor(rows.reduce((s, r) => s + toMinor(r.amount.toFixed(2)), 0));
}

describe('placing an order', () => {
  it('records nothing financial until delivery', async () => {
    const order = await placeOrder(10);
    // The owner's own order needs no accepting.
    expect(order).toMatchObject({ status: 'CONFIRMED', source: 'SUPPLIER', total: '500.00' });
    expect(await ctx.db.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
    expect(await ctx.db.inventoryMovement.count({ where: { orderId: order.id } })).toBe(0);
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('0.00');

    const open = (await biz.client.get('/api/orders?status=OPEN')).json();
    expect(open.items.map((o: { id: string }) => o.id)).toEqual([order.id]);
    expect((await biz.client.get('/api/dashboard')).json().today.pending).toBe(1);
  });

  it('moves through confirmed and out-for-delivery, but not backwards', async () => {
    const order = await placeOrder(5);
    const confirmed = await biz.client.post(`/api/orders/${order.id}/status`, { status: 'CONFIRMED' });
    expect(confirmed.json().status).toBe('CONFIRMED');
    const out = await biz.client.post(`/api/orders/${order.id}/status`, { status: 'OUT_FOR_DELIVERY' });
    expect(out.json().status).toBe('OUT_FOR_DELIVERY');
    const back = await biz.client.post(`/api/orders/${order.id}/status`, { status: 'CONFIRMED' });
    expect(back.statusCode).toBe(409);
  });
});

describe('delivering an order', () => {
  it('full delivery bills at the price agreed when ordered', async () => {
    const order = await placeOrder(10);
    // Price rises after the order was placed; the order keeps its price.
    await setPrice(biz.client, biz.storeId, biz.canId, '60');
    const res = await deliver(order.id, 10, { payment: { amount: '200', method: 'UPI' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().order).toMatchObject({ status: 'DELIVERED', total: '500.00', amountPaid: '200.00', paymentStatus: 'PARTIAL' });
    expect(res.json().storeBalance).toBe('300.00');
    expect(await ledgerNetForOrder(order.id)).toBe('500.00');
  });

  it('delivering more than ordered: bill, list and counts all show what was delivered', async () => {
    const order = await placeOrder(10);
    const res = await deliver(order.id, 15);
    expect(res.statusCode).toBe(201);
    expect(res.json().order).toMatchObject({ status: 'DELIVERED', total: '750.00' });
    expect(res.json().order.items[0]).toMatchObject({ quantity: 10, delivered: 15 });
    const listed = (await biz.client.get('/api/orders')).json().items.find((o: { id: string }) => o.id === order.id);
    expect(listed).toMatchObject({ totalQuantity: 15, total: '750.00' });
    // Before delivery the list shows what was ordered.
    const next = await placeOrder(8);
    expect((await biz.client.get('/api/orders')).json().items.find((o: { id: string }) => o.id === next.id).totalQuantity).toBe(8);
  });

  it('partial delivery bills only what arrived, then completes', async () => {
    const order = await placeOrder(10);
    const first = await deliver(order.id, 6);
    expect(first.json().order).toMatchObject({ status: 'PARTIALLY_DELIVERED', total: '300.00' });
    expect(first.json().order.items[0]).toMatchObject({ quantity: 10, delivered: 6 });
    expect(await ledgerNetForOrder(order.id)).toBe('300.00');

    const second = await deliver(order.id, 4, { items: [{ productId: biz.canId, quantity: 4, emptyCollected: 3 }] });
    expect(second.json().order).toMatchObject({ status: 'DELIVERED', total: '500.00' });
    expect(second.json().order.items[0]).toMatchObject({ delivered: 10, emptyCollected: 3 });
    expect(await ledgerNetForOrder(order.id)).toBe('500.00');
    expect((await storeDetail(biz.client, biz.storeId)).cansOutstanding).toBe(7);

    const again = await deliver(order.id, 1);
    expect(again.statusCode).toBe(409);
  });

  it('a retried delivery is recorded once', async () => {
    const order = await placeOrder(10);
    const body = {
      clientId: crypto.randomUUID(),
      items: [{ productId: biz.canId, quantity: 4, emptyCollected: 0 }],
      payment: { amount: '0', method: 'CASH' },
    };
    const [a, b] = await Promise.all([
      biz.client.post(`/api/orders/${order.id}/deliver`, body),
      biz.client.post(`/api/orders/${order.id}/deliver`, body),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await ctx.db.delivery.count({ where: { orderId: order.id } })).toBe(1);
    expect(await ledgerNetForOrder(order.id)).toBe('200.00');
  });

  it('rejects products that are not in the order', async () => {
    const other = await biz.client.post('/api/products', { name: 'Bottle crate', isReturnable: false });
    const order = await placeOrder(2);
    const res = await biz.client.post(`/api/orders/${order.id}/deliver`, {
      clientId: crypto.randomUUID(),
      items: [{ productId: other.json().id, quantity: 1 }],
      payment: { amount: '0', method: 'CASH' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('cancelling', () => {
  it('a pending order is simply cancelled', async () => {
    const order = await placeOrder(10);
    const res = await biz.client.post(`/api/orders/${order.id}/cancel`, { reason: 'Shop closed today' });
    expect(res.json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'Shop closed today' });
    expect((await deliver(order.id, 1)).statusCode).toBe(409);
    expect((await biz.client.post(`/api/orders/${order.id}/cancel`, {})).statusCode).toBe(409);
  });

  it('a delivered order is reversed: stock, cans and money all come back', async () => {
    const before = await stockOf(biz.client, biz.canId);
    const sold = await biz.client.post(
      '/api/orders/quick-sale',
      sale(biz.storeId, [{ productId: biz.canId, quantity: 10, emptyCollected: 4 }], { amount: '0' }, { discount: '20' }),
    );
    const orderId = sold.json().order.id;
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('480.00');

    const res = await biz.client.post(`/api/orders/${orderId}/cancel`, { reason: 'Delivered to wrong shop' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CANCELLED');

    const store = await storeDetail(biz.client, biz.storeId);
    expect(store.balance).toBe('0.00');
    expect(store.cansOutstanding).toBe(0);
    expect(await stockOf(biz.client, biz.canId)).toMatchObject({ filled: before.filled, empty: before.empty, withCustomers: 0 });
    expect(await ledgerNetForOrder(orderId)).toBe('0.00');
    // History is kept: originals plus reversals, nothing deleted.
    expect(await ctx.db.ledgerEntry.count({ where: { orderId, type: 'REVERSAL' } })).toBe(2);
    expect(await ctx.db.auditLog.count({ where: { action: 'DELIVERED_ORDER_CANCELLED', entityId: orderId } })).toBe(1);

    const dash = (await biz.client.get('/api/dashboard')).json();
    expect(dash.today).toMatchObject({ sales: '0.00', cansDelivered: 0, emptiesCollected: 0 });
  });

  it('money paid for a cancelled delivery stays as credit unless refunded', async () => {
    const keep = await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 4 }], { amount: '200' }));
    await biz.client.post(`/api/orders/${keep.json().order.id}/cancel`, {});
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('-200.00');

    const refund = await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 2 }], { amount: '100' }));
    await biz.client.post(`/api/orders/${refund.json().order.id}/cancel`, { refundPayments: true });
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('-200.00');
    const payment = await ctx.db.payment.findFirstOrThrow({ where: { orderId: refund.json().order.id } });
    expect(payment.reversedAt).not.toBeNull();
  });
});

describe('payment reversal', () => {
  it('puts the amount back on the balance and nets cash flow to zero', async () => {
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 10 }], { amount: '0' }));
    const paid = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '300', method: 'UPI' });
    expect(paid.json().storeBalance).toBe('200.00');
    const paymentId = paid.json().payment.id;

    const res = await biz.client.post(`/api/payments/${paymentId}/reverse`, { reason: 'Entered twice by mistake' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ storeBalance: '500.00', payment: { reversed: true } });

    const flows = await ctx.db.cashFlowEntry.findMany({ where: { paymentId } });
    expect(flows.reduce((s, f) => s + toMinor(f.amount.toFixed(2)), 0)).toBe(0);
    expect((await biz.client.get('/api/dashboard')).json().today.cashCollected).toBe('0.00');
  });

  it('cannot be reversed twice, even concurrently', async () => {
    const paid = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '100', method: 'CASH' });
    const id = paid.json().payment.id;
    const results = await Promise.all([
      biz.client.post(`/api/payments/${id}/reverse`, { reason: 'Mistake' }),
      biz.client.post(`/api/payments/${id}/reverse`, { reason: 'Mistake' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await ctx.db.ledgerEntry.count({ where: { paymentId: id, type: 'REVERSAL' } })).toBe(1);
    expect((await storeDetail(biz.client, biz.storeId)).balance).toBe('0.00');
  });

  it('needs a reason', async () => {
    const paid = await biz.client.post('/api/payments', { clientId: crypto.randomUUID(), storeId: biz.storeId, amount: '100', method: 'CASH' });
    const res = await biz.client.post(`/api/payments/${paid.json().payment.id}/reverse`, { reason: '' });
    expect(res.statusCode).toBe(400);
  });
});
