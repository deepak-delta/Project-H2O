import { pushSubscribeSchema, pushUnsubscribeSchema, type PushConfig } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../../app';
import { requireAuth } from '../../lib/auth-context';
import { validationError } from '../../lib/errors';
import { parse } from '../../lib/validate';

export function registerPushRoutes(app: FastifyInstance, { db, notifier }: Services): void {
  app.get('/api/push/config', (req): PushConfig => {
    requireAuth(req);
    return { enabled: notifier.enabled, publicKey: notifier.publicKey };
  });

  /**
   * Saves this device's subscription for the signed-in user. If the same browser was used by
   * someone else before, the subscription now belongs to the current user only.
   */
  app.post('/api/push/subscribe', async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(pushSubscribeSchema, req.body);
    const data = {
      userId: auth.userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
      lastUsedAt: new Date(),
    };
    await db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
    return reply.status(204).send();
  });

  /** Only removes the caller's own subscription. */
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const auth = requireAuth(req);
    const { endpoint } = parse(pushUnsubscribeSchema, req.body);
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: auth.userId } });
    return reply.status(204).send();
  });

  app.post('/api/push/test', async (req) => {
    const auth = requireAuth(req);
    if (!notifier.enabled) throw validationError('Notifications are not set up on the server yet.');
    const report = await notifier.testUser(auth.userId, {
      title: 'Notifications are on',
      body: "You'll be told about orders, deliveries and payments here.",
      url: '/',
      tag: 'test',
    });
    return { ...report, sent: report.delivered };
  });
}
