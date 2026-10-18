import { timingSafeEqual } from 'node:crypto';
import { scheduleInputSchema } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app';
import { requireSupplier } from '../../lib/auth-context';
import { notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { deleteSchedule, getSchedule, runDueSchedules, saveSchedule } from './schedule';

const storeParams = z.object({ id: z.string().min(1) });

/** The daily cron may fire up to an hour early on Vercel's Hobby plan. */
const CRON_EARLY_HOURS = 1;

export function registerScheduleRoutes(app: FastifyInstance, { db, notifier, env }: Services): void {
  app.get('/api/stores/:id/schedule', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(storeParams, req.params);
    return { schedule: await getSchedule(db, auth.supplierId, id) };
  });

  app.put('/api/stores/:id/schedule', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(storeParams, req.params);
    const input = parse(scheduleInputSchema, req.body);
    const schedule = await saveSchedule(db, auth, id, input);
    // Set up for today, after 6 AM: today's order appears straight away.
    await runDueSchedules({ db, notifier, log: req.log }, { supplierId: auth.supplierId });
    return { schedule };
  });

  app.delete('/api/stores/:id/schedule', async (req, reply) => {
    const auth = requireSupplier(req);
    const { id } = parse(storeParams, req.params);
    await deleteSchedule(db, auth.supplierId, id);
    return reply.status(204).send();
  });

  /** Daily at 6 AM IST (vercel cron): makes the day's regular delivery orders and tells everyone. */
  app.get('/api/cron/schedules', async (req) => {
    const secret = env.CRON_SECRET;
    const given = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound('Page');
    return runDueSchedules({ db, notifier, log: req.log }, { earlyHours: CRON_EARLY_HOURS });
  });
}
