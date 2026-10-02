import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  changePinSchema,
  passkeyRenameSchema,
  pinLoginSchema,
  signupSchema,
  type MeResponse,
  type PasskeySummary,
} from '@wd/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { requireAuth } from '../../lib/auth-context';
import { conflict, locked, notFound, unauthenticated, validationError } from '../../lib/errors';
import { requestOrigin } from '../../lib/origin';
import { parse } from '../../lib/validate';
import { getDummyHash, hashPin, verifyPin } from './pin';
import { clearSessionCookie, createSession, revokeSession, setSessionCookie } from './session';
import { assertIpAllowed, lockUntilFor, recordAttempt } from './throttle';
import { finishLogin, finishRegistration, startLogin, startRegistration, type RelyingParty } from './webauthn';

const LOGIN_FAILED = 'Phone number or PIN is incorrect.';

const credentialResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
  response: z.looseObject({ clientDataJSON: z.string().min(1) }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

export async function loadMe(deps: AppDeps, userId: string): Promise<MeResponse> {
  const user = await deps.db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      supplier: { select: { id: true, businessName: true, currency: true, timezone: true } },
      store: { select: { id: true, name: true } },
      _count: { select: { credentials: true } },
    },
  });
  return {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      supplierId: user.supplierId,
      storeId: user.storeId,
    },
    business: user.supplier,
    store: user.store,
    hasPasskey: user._count.credentials > 0,
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, env, secureCookies } = deps;

  async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const { token, expiresAt } = await createSession(db, userId, req.headers['user-agent']);
    setSessionCookie(reply, token, expiresAt, secureCookies);
  }

  function relyingParty(req: FastifyRequest): RelyingParty {
    const origin = requestOrigin(req);
    return { origin, rpID: new URL(origin).hostname, rpName: env.RP_NAME };
  }

  app.post('/api/auth/signup', async (req, reply) => {
    await assertIpAllowed(db, req.ip);
    const input = parse(signupSchema, req.body);

    const existing = await db.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (existing) throw conflict('This phone number is already registered. Please log in.');

    const pinHash = await hashPin(input.pin, env.PIN_PEPPER);
    const user = await db.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: { businessName: input.businessName, ownerName: input.ownerName, phone: input.phone },
      });
      return tx.user.create({
        data: {
          supplierId: supplier.id,
          role: 'SUPPLIER',
          name: input.ownerName,
          phone: input.phone,
          pinHash,
        },
      });
    });

    await startSession(req, reply, user.id);
    return reply.status(201).send(await loadMe(deps, user.id));
  });

  app.post('/api/auth/login', async (req, reply) => {
    await assertIpAllowed(db, req.ip);
    const input = parse(pinLoginSchema, req.body);

    const user = await db.user.findUnique({ where: { phone: input.phone } });
    if (!user || !user.active) {
      await verifyPin(input.pin, await getDummyHash(env.PIN_PEPPER), env.PIN_PEPPER);
      await recordAttempt(db, req.ip, input.phone, false);
      throw unauthenticated(LOGIN_FAILED);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw locked(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }

    const ok = await verifyPin(input.pin, user.pinHash, env.PIN_PEPPER);
    await recordAttempt(db, req.ip, input.phone, ok);

    if (!ok) {
      const failures = user.failedPinAttempts + 1;
      await db.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: failures, lockedUntil: lockUntilFor(failures) },
      });
      throw unauthenticated(LOGIN_FAILED);
    }

    if (user.failedPinAttempts > 0 || user.lockedUntil) {
      await db.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
    }
    await startSession(req, reply, user.id);
    return loadMe(deps, user.id);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await revokeSession(db, req.auth.sessionId);
    clearSessionCookie(reply, secureCookies);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (req) => loadMe(deps, requireAuth(req).userId));

  /** Like /me, but "not signed in" is a normal answer (no 401 noise when the app starts). */
  app.get('/api/auth/session', async (req) => ({ me: req.auth ? await loadMe(deps, req.auth.userId) : null }));

  app.post('/api/auth/pin', async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(changePinSchema, req.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPin(input.currentPin, user.pinHash, env.PIN_PEPPER))) {
      throw validationError('Current PIN is incorrect.', { currentPin: 'Current PIN is incorrect' });
    }
    const pinHash = await hashPin(input.newPin, env.PIN_PEPPER);
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { pinHash } }),
      // Sign out every other device after a PIN change.
      db.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    return reply.status(204).send();
  });

  // ─── Passkeys (Face ID / fingerprint) ─────────────────────────────────────

  app.post('/api/auth/passkeys/register/options', async (req) => {
    const auth = requireAuth(req);
    return startRegistration(db, relyingParty(req), auth.userId);
  });

  app.post('/api/auth/passkeys/register/verify', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(
      z.object({ response: credentialResponseSchema, deviceName: z.string().trim().max(60).optional() }),
      req.body,
    );
    const credential = await finishRegistration(
      db,
      relyingParty(req),
      auth.userId,
      body.response as unknown as RegistrationResponseJSON,
      body.deviceName || 'This device',
    );
    return reply.status(201).send(toPasskeySummary(credential));
  });

  app.post('/api/auth/passkeys/login/options', async (req) => {
    await assertIpAllowed(db, req.ip);
    return startLogin(db, relyingParty(req));
  });

  app.post('/api/auth/passkeys/login/verify', async (req, reply) => {
    await assertIpAllowed(db, req.ip);
    const body = parse(z.object({ response: credentialResponseSchema }), req.body);
    let userId: string;
    try {
      userId = await finishLogin(db, relyingParty(req), body.response as unknown as AuthenticationResponseJSON);
    } catch (err) {
      await recordAttempt(db, req.ip, null, false);
      throw err;
    }
    await recordAttempt(db, req.ip, null, true);
    await startSession(req, reply, userId);
    return loadMe(deps, userId);
  });

  app.get('/api/auth/passkeys', async (req) => {
    const auth = requireAuth(req);
    const credentials = await db.webAuthnCredential.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
    });
    return credentials.map(toPasskeySummary);
  });

  app.patch('/api/auth/passkeys/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { deviceName } = parse(passkeyRenameSchema, req.body);
    const result = await db.webAuthnCredential.updateMany({
      where: { id, userId: auth.userId },
      data: { deviceName },
    });
    if (result.count === 0) throw notFound('Device');
    return { ok: true };
  });

  app.delete('/api/auth/passkeys/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const result = await db.webAuthnCredential.deleteMany({ where: { id, userId: auth.userId } });
    if (result.count === 0) throw notFound('Device');
    return reply.status(204).send();
  });
}

function toPasskeySummary(c: {
  id: string;
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): PasskeySummary {
  return {
    id: c.id,
    deviceName: c.deviceName,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  };
}
