import { randomUUID } from 'node:crypto';
import { addDays, zonedDateKey, zonedDayRangeForKey } from '@wd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { weekPlan } from '../src/modules/orders/week';
import { resetScheduleRunsForTests, runDueSchedules } from '../src/modules/schedules/schedule';
import { Notifier } from '../src/modules/notifications/notifier';
import { closeTestContext, createTestContext, resetDb, type TestContext } from './helpers';
import { createStore, sale, setupBusiness, staffClient, storeUserClient, type Business } from './fixtures';

let ctx: TestContext;
let biz: Business;
const TZ = 'Asia/Kolkata';
const today = () => zonedDateKey(new Date(), TZ);

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  biz = await setupBusiness(ctx.app);
});

const order = async (quantity: number, deliveryDate?: string, storeId = biz.storeId) => {
  const res = await biz.client.post('/api/orders', { clientId: randomUUID(), storeId, items: [{ productId: biz.canId, quantity }], ...(deliveryDate ? { deliveryDate } : {}) });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string; orderNumber: number }>();
};

describe("the owner's week", () => {
  it('lists pending orders day by day for the next 7 days, late ones first', async () => {
    const d0 = today();
    const now = await order(2); // no wanted day: due the day it was placed
    const inTwo = await order(5, addDays(d0, 2));
    const lastDay = await order(3, addDays(d0, 6));
    await order(4, addDays(d0, 7)); // beyond the week
    const late = await order(6, addDays(d0, 1));
    await ctx.db.order.update({ where: { id: late.id }, data: { deliveryDate: zonedDayRangeForKey(addDays(d0, -2), TZ).start } });
    await biz.client.post('/api/orders/quick-sale', sale(biz.storeId, [{ productId: biz.canId, quantity: 1 }], { amount: '50' })); // delivered: not pending
    const cancelled = await order(1, addDays(d0, 1));
    await biz.client.post(`/api/orders/${cancelled.id}/cancel`, {});

    const plan = await weekPlan(ctx.db, biz.supplierId);
    expect(plan.from).toBe(d0);
    expect(plan.to).toBe(addDays(d0, 6));
    expect(plan.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(d0, i)));
    expect(plan.late.map((o) => o.id)).toEqual([late.id]);
    expect(plan.days[0]!.orders.map((o) => o.id)).toEqual([now.id]);
    expect(plan.days[1]!.orders).toEqual([]);
    expect(plan.days[2]!.orders.map((o) => o.id)).toEqual([inTwo.id]);
    expect(plan.days[6]!.orders.map((o) => o.id)).toEqual([lastDay.id]);
    expect(plan.days.flatMap((d) => d.orders)).toHaveLength(3);
  });

  it('shows regular deliveries still to be made, and not twice once made', async () => {
    const d0 = today();
    const { id: staffId } = await staffClient(ctx.app, biz.client, '9600000051', 'Raju');
    const res = await biz.client.request('PUT', `/api/stores/${biz.storeId}/schedule`, {
      frequency: 'WEEKDAYS',
      weekdays: [0, 1, 2, 3, 4, 5, 6].filter((w) => w !== new Date(`${addDays(d0, 3)}T00:00:00Z`).getUTCDay()),
      startDate: d0,
      items: [{ productId: biz.canId, quantity: 4 }],
      assignedToId: staffId,
    });
    expect(res.statusCode, res.body).toBe(200);
    // A paused one never shows.
    const other = await createStore(biz.client, { name: 'Paused Shop', phone: '9811100050' });
    await biz.client.request('PUT', `/api/stores/${other}/schedule`, { frequency: 'DAILY', startDate: d0, items: [{ productId: biz.canId, quantity: 1 }], active: false });

    let plan = await weekPlan(ctx.db, biz.supplierId);
    // Today's may already be an order (saving catches up once it's past 6 AM); every other day
    // the schedule falls on shows the delivery still to be made.
    const regularDays = plan.days.slice(1).filter((d) => d.regulars.length > 0).map((d) => d.date);
    expect(regularDays).toEqual(plan.days.slice(1).map((d) => d.date).filter((d) => d !== addDays(d0, 3)));
    expect(plan.days[1]!.regulars[0]).toMatchObject({ storeId: biz.storeId, storeName: 'Sri Ganesh Stores', totalQuantity: 4, assignedTo: { id: staffId, name: 'Raju' } });
    expect(plan.days[0]!.regulars.length + plan.days[0]!.orders.length).toBe(1);

    // Today's order gets made: today shows the order, not the upcoming one.
    resetScheduleRunsForTests();
    await runDueSchedules({ db: ctx.db, notifier: new Notifier(ctx.db, null, null, ctx.app.log), log: ctx.app.log }, { supplierId: biz.supplierId, earlyHours: 24 });
    plan = await weekPlan(ctx.db, biz.supplierId);
    expect(plan.days[0]!.regulars).toEqual([]);
    expect(plan.days[0]!.orders).toEqual([expect.objectContaining({ storeId: biz.storeId, regular: true, totalQuantity: 4 })]);
    expect(plan.days[1]!.regulars).toHaveLength(1);
  });

  it('is for the owner only', async () => {
    const res = await biz.client.get('/api/orders/week');
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(7);
    const { client: staff } = await staffClient(ctx.app, biz.client, '9600000052');
    expect((await staff.get('/api/orders/week')).statusCode).toBe(403);
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000053');
    expect((await store.get('/api/orders/week')).statusCode).toBe(403);
  });
});
