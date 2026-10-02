import type { FastifyInstance } from 'fastify';
import { forbidden } from '../lib/errors';
import { sameOriginSource } from '../lib/origin';
import type { Db } from '../lib/db';
import { resolveSession, sessionCookieName } from '../modules/auth/session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerSecurityHooks(app: FastifyInstance, db: Db, secureCookies: boolean): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    // CSRF: cookies are SameSite=Lax, and every state-changing request must also come from
    // our own origin. The API is never called cross-origin, so there is no CORS to configure.
    if (!SAFE_METHODS.has(req.method) && !sameOriginSource(req)) {
      throw forbidden('This request was blocked for your security. Please reload the app.');
    }

    const token = req.cookies[sessionCookieName(secureCookies)];
    req.auth = token ? await resolveSession(db, token) : null;
  });

  app.addHook('onSend', async (_req, reply) => {
    // API responses hold private business data; never let a shared cache keep them.
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
}
