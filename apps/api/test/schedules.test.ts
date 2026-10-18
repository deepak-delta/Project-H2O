import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderDto, ScheduleDto } from '@wd/shared';
import type { PushMessage, PushOutcome, PushSender, PushTarget } from '../src/lib/push';
import { Notifier } from '../src/modules/notifications/notifier';
import { resetScheduleRunsForTests, runDueSchedules } from '../src/modules/schedules/schedule';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';
import { createProduct, setupBusiness, staffClient, storeUserClient, type Business } from './fixtures';

class FakeSender implements PushSender {
  readonly publicKey = 'BFakePublicKeyForTests000000000000000000000';
  sent: { endpoint: string; message: PushMessage }[] = [];
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, message });
    return Promise.resolve({ result: 'ok' });
  }
  to(endpoint: string): PushMessage[] {
    return this.sent.filter((s) => s.endpoint === endpoint).map((s) => s.message);
  }
}

const CRON_SECRET = 'test-cron-secret-0123456789';
const sender = new FakeSender();
let ctx: TestContext;
let biz: Business;
let staff: { client: Client; id: string };
let notifier: Notifier;
const OWNER_PHONE = 'https://push.example.com/owner';
const STAFF_PHONE = 'https://push.example.com/staff';

// Monday 19 Oct 2026. 00:30 UTC is 6:00 AM in India.
const MON_6AM = new Date('2026-10-19T00:30:00Z');
const MON_530AM = new Date('2026-10-19T00:00:00Z');
const SUN_6AM = new Date('2026-10-18T00:30:00Z');

const subscribe = (client: Client, endpoint: string) =>
  client.post('/api/push/subscribe', { endpoint, keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } });
const putSchedule = (client: Client, storeId: string, body: Record<string, unknown>) => client.request('PUT', `/api/stores/${storeId}/schedule`, body);
const run = (now: Date, earlyHours = 0) => {
  resetScheduleRunsForTests();
  return runDueSchedules({ db: ctx.db, notifier, log: ctx.app.log }, { now, earlyHours });
};
/** Read straight from the database: the app's own list would also catch up for the real today. */
const openOrders = async (): Promise<OrderDto[]> => {
  const rows = await ctx.db.order.findMany({ where: { status: { in: ['PENDING', 'CONFIRMED'] } }, select: { id: true } });
  return Promise.all(rows.map(async (o) => (await biz.client.get(`/api/orders/${o.id}`)).json<OrderDto>()));
};

beforeAll(async () => {
  ctx = await createTestContext({ CRON_SECRET }, { pushSender: sender });
  notifier = new Notifier(ctx.db, sender, null, ctx.app.log);
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => {
  await resetDb(ctx.db);
  sender.sent = [];
  biz = await setupBusiness(ctx.app);
  staff = await staffClient(ctx.app, biz.client, '9600000031', 'Raju');
  await subscribe(biz.client, OWNER_PHONE);
  await subscribe(staff.client, STAFF_PHONE);
  sender.sent = [];
});

describe('setting up a regular delivery', () => {
  it('saves, shows the next days, and can be changed or stopped', async () => {
    const res = await putSchedule(biz.client, biz.storeId, {
      frequency: 'WEEKDAYS',
      weekdays: [5, 1, 3, 1],
      startDate: '2030-01-01',
      items: [{ productId: biz.canId, quantity: 3 }],
      assignedToId: staff.id,
      notes: 'Leave at the back door',
    });
    expect(res.statusCode).toBe(200);
    const { schedule } = res.json<{ schedule: ScheduleDto }>();
    expect(schedule).toMatchObject({
      frequency: 'WEEKDAYS',
      weekdays: [1, 3, 5],
      monthDays: [],
      intervalDays: null,
      items: [{ productId: biz.canId, productName: '20L can', quantity: 3 }],
      assignedTo: { id: staff.id, name: 'Raju' },
      active: true,
    });
    // 1 Jan 2030 is a Tuesday.
    expect(schedule.nextDates).toEqual(['2030-01-02', '2030-01-04', '2030-01-07']);

    const paused = await putSchedule(biz.client, biz.storeId, { frequency: 'DAILY', startDate: '2030-01-01', items: [{ productId: biz.canId, quantity: 1 }], active: false });
    expect(paused.json<{ schedule: ScheduleDto }>().schedule).toMatchObject({ frequency: 'DAILY', weekdays: [], active: false, nextDates: [], assignedTo: null });

    expect((await biz.client.get(`/api/stores/${biz.storeId}/schedule`)).json<{ schedule: ScheduleDto }>().schedule.id).toBe(schedule.id);
    expect((await biz.client.delete(`/api/stores/${biz.storeId}/schedule`)).statusCode).toBe(204);
    expect((await biz.client.get(`/api/stores/${biz.storeId}/schedule`)).json()).toEqual({ schedule: null });
  });

  it('only the owner of that client can see or change it', async () => {
    const body = { frequency: 'DAILY', startDate: '2030-01-01', items: [{ productId: biz.canId, quantity: 1 }] };
    const other = await signupSupplier(ctx.app);
    expect((await putSchedule(other.client, biz.storeId, body)).statusCode).toBe(404);
    expect((await other.client.get(`/api/stores/${biz.storeId}/schedule`)).json()).toEqual({ schedule: null });
    expect((await putSchedule(staff.client, biz.storeId, body)).statusCode).toBe(403);
    const store = await storeUserClient(ctx.app, biz.client, biz.storeId, '9700000031');
    expect((await putSchedule(store, biz.storeId, body)).statusCode).toBe(403);
    // Someone else's product or staff.
    const theirCan = await createProduct(other.client);
    expect((await putSchedule(biz.client, biz.storeId, { ...body, items: [{ productId: theirCan, quantity: 1 }] })).statusCode).toBe(400);
    const theirStaff = await staffClient(ctx.app, other.client, '9600000032');
    expect((await putSchedule(biz.client, biz.storeId, { ...body, assignedToId: theirStaff.id })).statusCode).toBe(400);
  });
});

describe('the morning run', () => {
  beforeEach(async () => {
    expect(
      (await putSchedule(biz.client, biz.storeId, {
        frequency: 'DAILY',
        startDate: '2026-10-01',
        items: [{ productId: biz.canId, quantity: 5 }],
        assignedToId: staff.id,
        notes: 'Gate 2',
      })).statusCode,
    ).toBe(200);
    // The PUT itself may have made today's order (real clock); start these tests clean.
    await ctx.db.order.deleteMany({});
    sender.sent = [];
  });

  it('makes the day’s order under Pending, given to the staff member, and tells both', async () => {
    expect(await run(MON_6AM)).toEqual({ created: 1, failed: 0 });
    const [order] = await openOrders();
    expect(order).toMatchObject({ storeName: 'Sri Ganesh Stores', status: 'CONFIRMED', regular: true, notes: 'Gate 2', assignedTo: { id: staff.id, name: 'Raju' } });
    expect(order?.items.map((i) => i.quantity)).toEqual([5]);
    expect(order?.deliveryDate?.slice(0, 10)).toBe('2026-10-18'); // 00:00 IST on the 19th, in UTC
    expect(sender.to(OWNER_PHONE)).toEqual([
      expect.objectContaining({ title: "Today's regular deliveries: 1", body: '5 cans · Sri Ganesh Stores · 1 for Raju', url: '/orders' }),
    ]);
    expect(sender.to(STAFF_PHONE)).toEqual([expect.objectContaining({ title: 'Today: 1 delivery for you', body: '5 cans · Sri Ganesh Stores', url: '/' })]);
  });

  it('never makes the same day twice, and tells nobody the second time', async () => {
    await run(MON_6AM);
    sender.sent = [];
    expect(await run(new Date('2026-10-19T09:00:00Z'))).toEqual({ created: 0, failed: 0 });
    expect(await openOrders()).toHaveLength(1);
    expect(sender.sent).toEqual([]);
    // The next day is a new order.
    expect(await run(new Date('2026-10-20T00:30:00Z'))).toEqual({ created: 1, failed: 0 });
  });

  it('waits for 6 AM (the cron may start up to an hour early)', async () => {
    expect(await run(MON_530AM)).toEqual({ created: 0, failed: 0 });
    expect(await run(MON_530AM, 1)).toEqual({ created: 1, failed: 0 });
  });

  it('skips days off, paused schedules and inactive clients', async () => {
    await putSchedule(biz.client, biz.storeId, { frequency: 'WEEKDAYS', weekdays: [1], startDate: '2026-10-01', items: [{ productId: biz.canId, quantity: 5 }] });
    await ctx.db.order.deleteMany({});
    expect(await run(SUN_6AM)).toEqual({ created: 0, failed: 0 });
    await putSchedule(biz.client, biz.storeId, { frequency: 'DAILY', startDate: '2026-10-01', items: [{ productId: biz.canId, quantity: 5 }], active: false });
    await ctx.db.order.deleteMany({});
    expect(await run(MON_6AM)).toEqual({ created: 0, failed: 0 });
    await putSchedule(biz.client, biz.storeId, { frequency: 'DAILY', startDate: '2026-10-01', items: [{ productId: biz.canId, quantity: 5 }] });
    await ctx.db.order.deleteMany({});
    await ctx.db.store.update({ where: { id: biz.storeId }, data: { status: 'INACTIVE' } });
    expect(await run(MON_6AM)).toEqual({ created: 0, failed: 0 });
  });

  it('a staff member who left: the order goes to the owner instead', async () => {
    await ctx.db.user.update({ where: { id: staff.id }, data: { active: false } });
    await run(MON_6AM);
    expect((await openOrders())[0]?.assignedTo).toBeNull();
    expect(sender.to(OWNER_PHONE)[0]?.body).toBe('5 cans · Sri Ganesh Stores');
  });

  it("tells the owner about one it couldn't make (no price for this client)", async () => {
    const jar = await createProduct(biz.client, { name: '1L bottle', isReturnable: false });
    await putSchedule(biz.client, biz.storeId, { frequency: 'DAILY', startDate: '2026-10-01', items: [{ productId: jar, quantity: 2 }] });
    await ctx.db.order.deleteMany({});
    sender.sent = [];
    expect(await run(MON_6AM)).toEqual({ created: 0, failed: 1 });
    expect(sender.to(OWNER_PHONE)[0]?.body).toBe("Couldn't make 1: Sri Ganesh Stores. Check their prices and products.");
  });
});

describe('the daily job endpoint', () => {
  it('needs the cron secret', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.get('/api/cron/schedules')).statusCode).toBe(404);
    expect((await anon.request('GET', '/api/cron/schedules', undefined, { authorization: 'Bearer wrong-secret-0123456789xx' })).statusCode).toBe(404);
    const ok = await anon.request('GET', '/api/cron/schedules', undefined, { authorization: `Bearer ${CRON_SECRET}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ created: expect.any(Number), failed: 0 });
  });
});
