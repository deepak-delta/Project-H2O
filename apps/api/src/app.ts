import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './env';
import type { Db } from './lib/db';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerCashFlowRoutes } from './modules/cashflow/routes';
import { registerDashboardRoutes } from './modules/dashboard/routes';
import { registerInventoryRoutes } from './modules/inventory/routes';
import { registerOrderRoutes } from './modules/orders/routes';
import { registerPaymentRoutes } from './modules/payments/routes';
import { registerProductRoutes } from './modules/products/routes';
import { registerReportRoutes } from './modules/reports/routes';
import { registerStoreAppRoutes } from './modules/store-app/routes';
import { registerStoreRoutes } from './modules/stores/routes';
import { registerErrorHandling } from './plugins/errors';
import { registerSecurityHooks } from './plugins/security';

export interface AppDeps {
  db: Db;
  env: Env;
  /** Secure cookies everywhere except plain-http local development and tests. */
  secureCookies: boolean;
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

  registerErrorHandling(app);
  registerSecurityHooks(app, deps.db, deps.secureCookies);

  app.get('/api/health', () => ({ ok: true }));
  registerAuthRoutes(app, deps);
  registerProductRoutes(app, deps);
  registerStoreRoutes(app, deps);
  registerInventoryRoutes(app, deps);
  registerOrderRoutes(app, deps);
  registerPaymentRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  registerStoreAppRoutes(app, deps);
  registerCashFlowRoutes(app, deps);
  registerReportRoutes(app, deps);

  return app;
}
