import { createHash, randomBytes } from 'node:crypto';
import { pinResetCompleteSchema, pinResetStartSchema, pinResetVerifySchema, type PinResetMethod } from '@wd/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app';
import type { PinResetSession } from '../../generated/prisma/client';
import { expired, locked, rateLimited, validationError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { recentEvents, recordAuthEvent } from './auth-events';
import { hashPin, verifyPin } from './pin';
import { recoveryCodeHash } from './recovery-codes';
import { claimTotpStep, totpBinding } from './recovery-routes';
import { totpKey, unseal } from './secret-box';
import { newTotpSecret, verifyTotp } from './totp';

/**
 * "Forgot PIN": phone number → authenticator code, recovery code or support code → new PIN.
 *
 * - Every answer looks the same whether or not the phone has an account (or has recovery set up).
 * - The reset is bound to an HttpOnly cookie whose hash is stored; it lasts 15 minutes, then 10
 *   minutes after the code is accepted, and works once.
 * - Wrong codes are limited per phone (5 in 30 min, 10 in a day), per IP, and per reset.
 */
const START_MINUTES = 15;
const VERIFIED_MINUTES = 10;
const MAX_SESSION_FAILURES = 5;
const PHONE_WINDOW_MS = 30 * 60 * 1000;
const MAX_PHONE_FAILURES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PHONE_FAILURES_PER_DAY = 10;
const MAX_IP_FAILURES = 20;
const START_WINDOW_MS = 15 * 60 * 1000;
const MAX_STARTS_PER_IP = 15;
const MAX_STARTS_PER_PHONE = 5;

const EXPIRED = 'This PIN reset has expired. Please start again.';
const WRONG_CODE: Record<PinResetMethod, string> = {
  TOTP: "That code didn't work. Codes change every 30 seconds: enter the current one.",
  RECOVERY: "That recovery code didn't work. Check it, or try another one.",
  ASSISTED: "That support code didn't work. Check it, or ask for a new one.",
};

export function resetCookieName(secure: boolean): string {
  return secure ? '__Host-wd_reset' : 'wd_reset';
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const minutesUntil = (at: Date) => Math.max(1, Math.ceil((at.getTime() - Date.now()) / 60000));

export function registerPinResetRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, env, secureCookies } = deps;
  const cookie = resetCookieName(secureCookies);
  const rateLimit = { max: Math.max(30, Math.floor(env.RATE_LIMIT_PER_MINUTE / 10)), timeWindow: '15 minutes' };
  // Unknown accounts still do the same work, so response times don't give them away.
  const dummySecret = newTotpSecret();

  function setCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(cookie, token, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', expires: expiresAt });
  }
  function clearCookie(reply: FastifyReply) {
    reply.clearCookie(cookie, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/' });
  }

  /** The caller's reset, if it's still usable. */
  async function currentReset(req: FastifyRequest): Promise<PinResetSession> {
    const token = req.cookies[cookie];
    const session = token ? await db.pinResetSession.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
    if (!session || session.usedAt || session.expiresAt.getTime() <= Date.now() || session.failedAttempts >= MAX_SESSION_FAILURES) {
      throw expired(EXPIRED);
    }
    return session;
  }

  /** Locks out guessing per phone and per IP, whether or not the phone has an account. */
  async function assertNotLocked(session: PinResetSession, ip: string): Promise<void> {
    const now = Date.now();
    const short = await recentEvents(db, { types: ['PIN_RESET_FAILED'], phone: session.phone }, new Date(now - PHONE_WINDOW_MS));
    if (short.count >= MAX_PHONE_FAILURES && short.oldest) {
      throw locked(`Too many wrong codes. Try again in ${minutesUntil(new Date(short.oldest.getTime() + PHONE_WINDOW_MS))} minutes.`);
    }
    const day = await recentEvents(db, { types: ['PIN_RESET_FAILED'], phone: session.phone }, new Date(now - DAY_MS));
    if (day.count >= MAX_PHONE_FAILURES_PER_DAY && day.oldest) {
      throw locked(`Too many wrong codes today. Try again in ${minutesUntil(new Date(day.oldest.getTime() + DAY_MS))} minutes.`);
    }
    const byIp = await recentEvents(db, { types: ['PIN_RESET_FAILED'], ip }, new Date(now - PHONE_WINDOW_MS));
    if (byIp.count >= MAX_IP_FAILURES) throw rateLimited();
  }

  /** Checks (and uses up) a code. Always does comparable work, even for unknown accounts. */
  async function useCode(userId: string | null, method: PinResetMethod, code: string): Promise<boolean> {
    const now = new Date();
    if (method === 'TOTP') {
      const key = totpKey(env);
      const factor = userId && key ? await db.totpFactor.findUnique({ where: { userId } }) : null;
      if (!userId || !key || !factor?.secretEnc || !factor.enabledAt) {
        verifyTotp(dummySecret, code);
        return false;
      }
      const step = verifyTotp(unseal(factor.secretEnc, key, totpBinding(userId)), code, { lastUsedStep: factor.lastUsedStep });
      return step !== null && (await claimTotpStep(db, userId, step));
    }
    const codeHash = recoveryCodeHash(code, userId ?? 'no-account', env.PIN_PEPPER);
    if (!userId) return false;
    if (method === 'RECOVERY') {
      // Recovery codes only count while recovery is on; used codes never work again.
      const factor = await db.totpFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
      if (!factor?.enabledAt) return false;
      const { count } = await db.recoveryCode.updateMany({ where: { userId, codeHash, usedAt: null }, data: { usedAt: now } });
      return count === 1;
    }
    const { count } = await db.assistedResetCode.updateMany({
      where: { userId, codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  app.post('/api/auth/pin-reset/start', { config: { rateLimit } }, async (req, reply) => {
    const { phone } = parse(pinResetStartSchema, req.body);
    const since = new Date(Date.now() - START_WINDOW_MS);
    const [byIp, byPhone] = await Promise.all([
      recentEvents(db, { types: ['PIN_RESET_STARTED'], ip: req.ip }, since),
      recentEvents(db, { types: ['PIN_RESET_STARTED'], phone }, since),
    ]);
    if (byIp.count >= MAX_STARTS_PER_IP || byPhone.count >= MAX_STARTS_PER_PHONE) throw rateLimited();

    const user = await db.user.findUnique({ where: { phone }, select: { id: true, active: true } });
    const userId = user?.active ? user.id : null;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + START_MINUTES * 60 * 1000);
    await db.pinResetSession.create({ data: { tokenHash: hashToken(token), phone, userId, ip: req.ip, expiresAt } });
    await recordAuthEvent(db, { type: 'PIN_RESET_STARTED', userId, phone, ip: req.ip });
    setCookie(reply, token, expiresAt);
    // Same answer for every phone number.
    return { ok: true, expiresAt: expiresAt.toISOString() };
  });

  app.post('/api/auth/pin-reset/verify', { config: { rateLimit } }, async (req) => {
    const input = parse(pinResetVerifySchema, req.body);
    const session = await currentReset(req);
    if (session.verifiedAt) return { ok: true };
    await assertNotLocked(session, req.ip);

    const ok = await useCode(session.userId, input.method, input.code);
    if (!ok) {
      await db.pinResetSession.update({ where: { id: session.id }, data: { failedAttempts: { increment: 1 } } });
      await recordAuthEvent(db, { type: 'PIN_RESET_FAILED', userId: session.userId, phone: session.phone, ip: req.ip, method: input.method });
      const failures = await recentEvents(db, { types: ['PIN_RESET_FAILED'], phone: session.phone }, new Date(Date.now() - PHONE_WINDOW_MS));
      if (failures.count === MAX_PHONE_FAILURES) {
        await recordAuthEvent(db, { type: 'PIN_RESET_LOCKED', userId: session.userId, phone: session.phone, ip: req.ip });
      }
      throw validationError(WRONG_CODE[input.method], { code: WRONG_CODE[input.method] });
    }

    await db.pinResetSession.update({
      where: { id: session.id },
      data: { verifiedAt: new Date(), method: input.method, expiresAt: new Date(Date.now() + VERIFIED_MINUTES * 60 * 1000) },
    });
    await recordAuthEvent(db, { type: 'PIN_RESET_VERIFIED', userId: session.userId, phone: session.phone, ip: req.ip, method: input.method });
    if (input.method === 'RECOVERY' && session.userId) {
      const left = await db.recoveryCode.count({ where: { userId: session.userId, usedAt: null } });
      await recordAuthEvent(db, { type: 'RECOVERY_CODE_USED', userId: session.userId, ip: req.ip, detail: { codesLeft: left } });
    }
    if (input.method === 'ASSISTED') {
      await recordAuthEvent(db, { type: 'ASSISTED_CODE_USED', userId: session.userId, ip: req.ip });
    }
    return { ok: true };
  });

  app.post('/api/auth/pin-reset/complete', { config: { rateLimit } }, async (req, reply) => {
    const input = parse(pinResetCompleteSchema, req.body);
    const session = await currentReset(req);
    if (!session.verifiedAt || !session.userId) throw expired(EXPIRED);
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user?.active) throw expired(EXPIRED);
    if (await verifyPin(input.pin, user.pinHash, env.PIN_PEPPER)) {
      throw validationError('Choose a new PIN, not the one you had before.', { pin: 'Choose a different PIN' });
    }
    const pinHash = await hashPin(input.pin, env.PIN_PEPPER);

    await db.$transaction(async (tx) => {
      // Single use: only one request can claim this reset.
      const { count } = await tx.pinResetSession.updateMany({ where: { id: session.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count !== 1) throw expired(EXPIRED);
      await tx.user.update({ where: { id: user.id }, data: { pinHash, failedPinAttempts: 0, lockedUntil: null } });
      // Sign out every device, and close any other reset in progress for this account.
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.pinResetSession.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await recordAuthEvent(tx, { type: 'PIN_RESET_COMPLETED', userId: user.id, phone: user.phone, ip: req.ip, method: session.method });
    });
    clearCookie(reply);
    return reply.status(204).send();
  });
}
