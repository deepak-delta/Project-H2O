import { createStaffSchema, staffPinSchema, updateStaffSchema, type StaffDto } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app';
import { requireAuth, requireSupplier } from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import type { Db, Tx } from '../../lib/db';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { hashPin } from '../auth/pin';
import { staffToday } from './today';

const idParams = z.object({ id: z.string().min(1) });

async function toStaffDto(db: Db, supplierId: string, u: { id: string; name: string; phone: string; active: boolean; createdAt: Date }): Promise<StaffDto> {
  const today = await staffToday(db, supplierId, { id: u.id, name: u.name });
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
    today: { deliveries: today.deliveries, cansDelivered: today.cansDelivered, collected: today.collected, expenses: today.expenses, cashInHand: today.cashInHand },
  };
}

/** Signs a member of staff out everywhere and stops their notifications. */
async function cutOff(tx: Tx, userId: string): Promise<void> {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.pushSubscription.deleteMany({ where: { userId } });
}

export function registerStaffRoutes(app: FastifyInstance, { db, env }: Services): void {
  const findStaff = (supplierId: string, id: string) => db.user.findFirst({ where: { id, supplierId, role: 'STAFF' } });

  /** A member of staff's own day. Starts empty every morning. */
  app.get('/api/staff/today', async (req) => {
    const auth = requireAuth(req);
    if (auth.role !== 'STAFF') throw forbidden();
    const me = await db.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true } });
    return staffToday(db, auth.supplierId, me);
  });

  app.get('/api/staff', async (req) => {
    const auth = requireSupplier(req);
    const staff = await db.user.findMany({ where: { supplierId: auth.supplierId, role: 'STAFF' }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return Promise.all(staff.map((u) => toStaffDto(db, auth.supplierId, u)));
  });

  /** The owner looks at any member of staff's day. */
  app.get('/api/staff/:id/today', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const staff = await findStaff(auth.supplierId, id);
    if (!staff) throw notFound('Staff member');
    return staffToday(db, auth.supplierId, { id: staff.id, name: staff.name });
  });

  app.post('/api/staff', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(createStaffSchema, req.body);
    const taken = await db.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (taken) throw conflict('This phone number already has a login. Use a different number.');
    const pinHash = await hashPin(input.pin, env.PIN_PEPPER);
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { supplierId: auth.supplierId, role: 'STAFF', name: input.name, phone: input.phone, pinHash } });
      await audit(tx, { supplierId: auth.supplierId, actorId: auth.userId, action: 'STAFF_ADDED', entity: 'User', entityId: created.id, after: { name: input.name, phone: input.phone } });
      return created;
    });
    return reply.status(201).send(await toStaffDto(db, auth.supplierId, user));
  });

  /** Rename, or turn access off/on. Turning off signs them out and hands their open orders back. */
  app.patch('/api/staff/:id', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const input = parse(updateStaffSchema, req.body);
    const staff = await findStaff(auth.supplierId, id);
    if (!staff) throw notFound('Staff member');
    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.active !== undefined ? { active: input.active } : {}) },
      });
      if (input.active === false && staff.active) {
        await cutOff(tx, id);
        await tx.order.updateMany({
          where: { supplierId: auth.supplierId, assignedToId: id, status: { in: ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED'] } },
          data: { assignedToId: null },
        });
      }
      if (input.active !== undefined && input.active !== staff.active) {
        await audit(tx, {
          supplierId: auth.supplierId,
          actorId: auth.userId,
          action: input.active ? 'STAFF_ENABLED' : 'STAFF_DISABLED',
          entity: 'User',
          entityId: id,
        });
      }
      return updated;
    });
    return toStaffDto(db, auth.supplierId, user);
  });

  /** New PIN: signs them out everywhere. */
  app.put('/api/staff/:id/pin', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const { pin } = parse(staffPinSchema, req.body);
    const staff = await findStaff(auth.supplierId, id);
    if (!staff) throw notFound('Staff member');
    const pinHash = await hashPin(pin, env.PIN_PEPPER);
    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { pinHash, failedPinAttempts: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { supplierId: auth.supplierId, actorId: auth.userId, action: 'STAFF_PIN_RESET', entity: 'User', entityId: id });
      return updated;
    });
    return toStaffDto(db, auth.supplierId, user);
  });
}
