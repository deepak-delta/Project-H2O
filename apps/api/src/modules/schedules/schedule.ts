import { createHash } from 'node:crypto';
import {
  isScheduleDue,
  nextScheduleDates,
  placeOrderSchema,
  SCHEDULE_HOUR,
  zonedDateKey,
  zonedHour,
  type OrderDto,
  type scheduleInputSchema,
  type ScheduleDto,
  type ScheduleRule,
} from '@wd/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { SupplierContext } from '../../lib/auth-context';
import type { Db } from '../../lib/db';
import { notFound, validationError } from '../../lib/errors';
import type { Notifier } from '../notifications/notifier';
import { placeOrder } from '../orders/lifecycle';

/**
 * Regular deliveries: each day a client's schedule falls on, an order is made for it at 6 AM
 * (business timezone) so it shows under Pending, given to the chosen member of staff.
 */

const scheduleInclude = {
  items: { include: { product: { select: { name: true } } }, orderBy: { product: { name: 'asc' } } },
  assignedTo: { select: { id: true, name: true, active: true, deletedAt: true } },
} as const;

type ScheduleRow = NonNullable<Awaited<ReturnType<typeof findSchedule>>>;

const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const keyToDate = (key: string) => new Date(`${key}T00:00:00Z`);

function findSchedule(db: Db, supplierId: string, storeId: string) {
  return db.deliverySchedule.findFirst({ where: { supplierId, storeId }, include: scheduleInclude });
}

function ruleOf(s: ScheduleRow): ScheduleRule {
  return { frequency: s.frequency, weekdays: s.weekdays, intervalDays: s.intervalDays, monthDays: s.monthDays, startDate: keyOf(s.startDate) };
}

function toDto(s: ScheduleRow, today: string): ScheduleDto {
  const staff = s.assignedTo && s.assignedTo.active && !s.assignedTo.deletedAt ? { id: s.assignedTo.id, name: s.assignedTo.name } : null;
  return {
    id: s.id,
    storeId: s.storeId,
    ...ruleOf(s),
    items: s.items.map((i) => ({ productId: i.productId, productName: i.product.name, quantity: i.quantity })),
    assignedTo: staff,
    active: s.active,
    notes: s.notes,
    nextDates: s.active ? nextScheduleDates(ruleOf(s), today, 3) : [],
  };
}

async function todayKey(db: Db, supplierId: string, now: Date): Promise<string> {
  const { timezone } = await db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { timezone: true } });
  return zonedDateKey(now, timezone);
}

export async function getSchedule(db: Db, supplierId: string, storeId: string, now = new Date()): Promise<ScheduleDto | null> {
  const s = await findSchedule(db, supplierId, storeId);
  return s ? toDto(s, await todayKey(db, supplierId, now)) : null;
}

/** Creates or replaces the client's regular delivery. */
export async function saveSchedule(
  db: Db,
  auth: SupplierContext,
  storeId: string,
  input: z.output<typeof scheduleInputSchema>,
  now = new Date(),
): Promise<ScheduleDto> {
  const store = await db.store.findFirst({ where: { id: storeId, supplierId: auth.supplierId }, select: { id: true } });
  if (!store) throw notFound('Client');
  const products = await db.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, supplierId: auth.supplierId, active: true },
    select: { id: true },
  });
  if (products.length !== input.items.length) throw validationError('One of the products is no longer available. Please refresh.');
  if (input.assignedToId) {
    const staff = await db.user.findFirst({
      where: { id: input.assignedToId, supplierId: auth.supplierId, role: 'STAFF', active: true, deletedAt: null },
      select: { id: true },
    });
    if (!staff) throw validationError('Choose an active member of staff.', { assignedToId: 'Not found' });
  }

  const data = {
    frequency: input.frequency,
    weekdays: input.frequency === 'WEEKDAYS' ? [...new Set(input.weekdays)].sort() : [],
    intervalDays: input.frequency === 'EVERY_N_DAYS' ? (input.intervalDays ?? null) : null,
    monthDays: input.frequency === 'MONTHLY' ? [...new Set(input.monthDays)].sort((a, b) => a - b) : [],
    startDate: keyToDate(input.startDate),
    assignedToId: input.assignedToId ?? null,
    active: input.active,
    notes: input.notes ?? null,
  };
  await db.$transaction(async (tx) => {
    const saved = await tx.deliverySchedule.upsert({
      where: { storeId },
      create: { supplierId: auth.supplierId, storeId, createdById: auth.userId, ...data },
      update: data,
    });
    await tx.deliveryScheduleItem.deleteMany({ where: { scheduleId: saved.id } });
    await tx.deliveryScheduleItem.createMany({
      data: input.items.map((i) => ({ scheduleId: saved.id, productId: i.productId, quantity: i.quantity })),
    });
  });
  forgetRun(auth.supplierId);
  const s = await findSchedule(db, auth.supplierId, storeId);
  if (!s) throw notFound('Regular delivery');
  return toDto(s, await todayKey(db, auth.supplierId, now));
}

/** Stops the client's regular delivery. Orders already made stay as they are. */
export async function deleteSchedule(db: Db, supplierId: string, storeId: string): Promise<void> {
  const { count } = await db.deliverySchedule.deleteMany({ where: { supplierId, storeId } });
  if (count === 0) throw notFound('Regular delivery');
}

// ─── Making the day's orders ────────────────────────────────────────────────

/**
 * Same order id for the same schedule and day, every time: a second run (the cron retrying, or
 * the app catching up) finds the order already there instead of making another.
 */
export function scheduleOrderClientId(scheduleId: string, day: string): string {
  const h = createHash('sha256').update(`schedule:${scheduleId}:${day}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export interface ScheduleRunReport {
  created: number;
  failed: number;
}

interface Deps {
  db: Db;
  notifier: Notifier;
  log: FastifyBaseLogger;
}

/** Businesses already caught up today on this server instance (so app opens cost nothing). */
const caughtUp = new Map<string, string>();
function forgetRun(supplierId: string) {
  caughtUp.delete(supplierId);
}
/** Tests run the same day several times. */
export function resetScheduleRunsForTests(): void {
  caughtUp.clear();
}

/**
 * Makes today's orders for every due schedule of every business whose clock has reached 6 AM.
 * `earlyHours` lets the daily cron start a little before (its timing is only hour-accurate).
 */
export async function runDueSchedules(deps: Deps, options: { supplierId?: string; now?: Date; earlyHours?: number } = {}): Promise<ScheduleRunReport> {
  const now = options.now ?? new Date();
  const report: ScheduleRunReport = { created: 0, failed: 0 };
  const suppliers = await deps.db.supplier.findMany({
    where: { ...(options.supplierId ? { id: options.supplierId } : {}), schedules: { some: { active: true } } },
    select: { id: true, timezone: true },
  });
  for (const supplier of suppliers) {
    if (zonedHour(now, supplier.timezone) < SCHEDULE_HOUR - (options.earlyHours ?? 0)) continue;
    const day = zonedDateKey(now, supplier.timezone);
    if (caughtUp.get(supplier.id) === day) continue;
    try {
      const r = await runForSupplier(deps, supplier.id, day);
      report.created += r.created;
      report.failed += r.failed;
      caughtUp.set(supplier.id, day);
    } catch (err) {
      deps.log.error({ err, supplierId: supplier.id }, 'regular deliveries failed');
    }
  }
  return report;
}

/** For app opens: catch up this business (cheap after the first call of the day). */
export async function catchUpSchedules(deps: Deps, supplierId: string): Promise<void> {
  await runDueSchedules(deps, { supplierId }).catch((err: unknown) => deps.log.warn({ err }, 'regular deliveries catch-up failed'));
}

async function runForSupplier({ db, notifier, log }: Deps, supplierId: string, day: string): Promise<ScheduleRunReport> {
  const schedules = await db.deliverySchedule.findMany({
    where: { supplierId, active: true, startDate: { lte: keyToDate(day) }, store: { status: 'ACTIVE' } },
    include: { ...scheduleInclude, store: { select: { name: true } } },
  });
  const due = schedules.filter((s) => isScheduleDue(ruleOf(s), day));
  if (due.length === 0) return { created: 0, failed: 0 };

  const created: OrderDto[] = [];
  const failures: string[] = [];
  for (const s of due) {
    const actor: SupplierContext = { role: 'SUPPLIER', userId: s.createdById, sessionId: 'schedule', supplierId, storeId: null };
    const staffOk = s.assignedTo && s.assignedTo.active && !s.assignedTo.deletedAt;
    try {
      const input = placeOrderSchema.parse({
        clientId: scheduleOrderClientId(s.id, day),
        storeId: s.storeId,
        items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        assignedToId: staffOk ? s.assignedToId : null,
        deliveryDate: day,
        notes: s.notes,
      });
      const { order, replayed } = await placeOrder(db, actor, input, { scheduleId: s.id });
      if (!replayed) created.push(order);
    } catch (err) {
      failures.push(s.store.name);
      log.warn({ err, scheduleId: s.id }, 'regular delivery order not made');
    }
  }
  await announce(notifier, supplierId, created, failures);
  return { created: created.length, failed: failures.length };
}

const cans = (n: number) => `${n} can${n === 1 ? '' : 's'}`;
const cansIn = (orders: OrderDto[]) => orders.reduce((s, o) => s + o.items.reduce((t, i) => t + i.quantity, 0), 0);
const names = (orders: OrderDto[]) =>
  orders.length <= 3 ? orders.map((o) => o.storeName).join(', ') : `${orders.slice(0, 2).map((o) => o.storeName).join(', ')} +${orders.length - 2} more`;

/** One summary for the owner, and one for each member of staff with deliveries today. */
async function announce(notifier: Notifier, supplierId: string, created: OrderDto[], failures: string[]): Promise<void> {
  if (created.length === 0 && failures.length === 0) return;
  const byStaff = new Map<string, { name: string; orders: OrderDto[] }>();
  for (const o of created) {
    if (!o.assignedTo) continue;
    const entry = byStaff.get(o.assignedTo.id) ?? { name: o.assignedTo.name, orders: [] };
    entry.orders.push(o);
    byStaff.set(o.assignedTo.id, entry);
  }
  const forStaff = [...byStaff.values()].map((s) => `${s.orders.length} for ${s.name}`);
  await notifier.toSupplier(supplierId, {
    title: created.length ? `Today's regular deliveries: ${created.length}` : "Today's regular deliveries",
    body: [
      created.length ? `${cans(cansIn(created))} · ${names(created)}` : null,
      forStaff.length ? forStaff.join(', ') : null,
      failures.length ? `Couldn't make ${failures.length}: ${failures.join(', ')}. Check their prices and products.` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    url: '/orders',
    tag: 'regular-deliveries',
  });
  for (const [staffId, { orders }] of byStaff) {
    await notifier.toUser(staffId, {
      title: `Today: ${orders.length} deliver${orders.length === 1 ? 'y' : 'ies'} for you`,
      body: `${cans(cansIn(orders))} · ${names(orders)}`,
      url: '/',
      tag: 'regular-deliveries',
    });
  }
}
