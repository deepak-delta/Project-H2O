import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './env';
import type { Db } from './lib/db';
import { createFcmSender, createWebPushSender, type NativePushSender, type PushSender } from './lib/push';
import { Notifier } from './modules/notifications/notifier';
import { registerPushRoutes } from './modules/notifications/routes';
import { registerStaffRoutes } from './modules/staff/routes';
import { registerPinResetRoutes } from './modules/auth/pin-reset-routes';
import { registerRecoveryRoutes } from './modules/auth/recovery-routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerCashFlowRoutes } from './modules/cashflow/routes';
import { registerDashboardRoutes } from './modules/dashboard/routes';
import { registerInventoryRoutes } from './modules/inventory/routes';
import { registerOrderRoutes } from './modules/orders/routes';
import { registerPaymentRoutes } from './modules/payments/routes';
import { registerProductRoutes } from './modules/products/routes';
import { registerReportRoutes } from './modules/reports/routes';
import { registerStoreAppRoutes } from './modules/store-app/routes';
import { registerScheduleRoutes } from './modules/schedules/routes';
import { registerStoreRoutes } from './modules/stores/routes';
import { registerErrorHandling } from './plugins/errors';
import { registerSecurityHooks } from './plugins/security';

export interface AppDeps {
  db: Db;
  env: Env;
  /** Secure cookies everywhere except plain-http local development and tests. */
  secureCookies: boolean;
  /** Override the push sender (tests); `null` disables push. Default: web-push if configured. */
  pushSender?: PushSender | null;
  /** Override the native-app (FCM) sender (tests); `null` disables it. Default: FCM if configured. */
  nativePushSender?: NativePushSender | null;
}

/** What route modules receive: the app's dependencies plus shared services built from them. */
export interface Services extends AppDeps {
  notifier: Notifier;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, {
    // The API only returns JSON; the page CSP is set by the static host (vercel.json).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: deps.env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  const services: Services = {
    ...deps,
    notifier: new Notifier(
      deps.db,
      deps.pushSender === undefined ? createWebPushSender(deps.env) : deps.pushSender,
      deps.nativePushSender === undefined ? createFcmSender(deps.env) : deps.nativePushSender,
      app.log,
    ),
  };

  registerErrorHandling(app);
  registerSecurityHooks(app, deps.db, deps.secureCookies);

  app.get('/api/health', () => ({ ok: true }));
  registerAuthRoutes(app, services);
  registerRecoveryRoutes(app, services);
  registerPinResetRoutes(app, services);
  registerProductRoutes(app, services);
  registerStoreRoutes(app, services);
  registerInventoryRoutes(app, services);
  registerOrderRoutes(app, services);
  registerPaymentRoutes(app, services);
  registerDashboardRoutes(app, services);
  registerStoreAppRoutes(app, services);
  registerStaffRoutes(app, services);
  registerCashFlowRoutes(app, services);
  registerReportRoutes(app, services);
  registerPushRoutes(app, services);
  registerScheduleRoutes(app, services);

  return app;
}
