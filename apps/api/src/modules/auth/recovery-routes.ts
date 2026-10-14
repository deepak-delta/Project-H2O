import {
  formatPhone,
  recoveryConfirmSchema,
  recoverySetupSchema,
  recoveryVerifySchema,
  type RecoveryCodesResult,
  type RecoverySetupInfo,
  type RecoveryStatus,
} from '@wd/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app';
import { requireAuth } from '../../lib/auth-context';
import type { Db, Tx } from '../../lib/db';
import { expired, locked, unavailable, validationError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import type { User } from '../../generated/prisma/client';
import { recentEvents, recordAuthEvent } from './auth-events';
import { verifyPin } from './pin';
import { formatRecoveryCode, newRecoveryCode, RECOVERY_CODE_COUNT, recoveryCodeHash } from './recovery-codes';
import { seal, totpKey, unseal } from './secret-box';
import { groupSecret, newTotpSecret, otpauthUri, qrDataUrl, TOTP_SETTINGS, verifyTotp } from './totp';
import { lockUntilFor } from './throttle';

const SETUP_MINUTES = 15;
const MAX_SETUP_FAILURES = 5;
const CODE_CHECK_WINDOW_MS = 30 * 60 * 1000;
const MAX_CODE_FAILURES = 5;
const WRONG_CODE = "That code didn't work. Enter the current 6-digit code from your authenticator app.";

/** What a TOTP secret is bound to when encrypted: it only decrypts for this user. */
export const totpBinding = (userId: string) => `totp:${userId}`;

export function requireTotpKey(deps: Pick<AppDeps, 'env'>): Buffer {
  const key = totpKey(deps.env);
  if (!key) throw unavailable("PIN recovery isn't available yet. Please try again later.");
  return key;
}

const minutesUntil = (at: Date) => Math.max(1, Math.ceil((at.getTime() - Date.now()) / 60000));

/** Fresh one-time codes; any older ones stop working. Returns them formatted, to show once. */
export async function issueRecoveryCodes(tx: Tx, userId: string, pepper: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryCodeHash(c, userId, pepper) })) });
  return codes.map(formatRecoveryCode);
}

/**
 * Marks a TOTP time step as used, only if no later step was used already: two requests racing
 * with the same code can't both succeed.
 */
export async function claimTotpStep(db: Db | Tx, userId: string, step: number): Promise<boolean> {
  const { count } = await db.totpFactor.updateMany({
    where: { userId, enabledAt: { not: null }, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
    data: { lastUsedStep: step },
  });
  return count === 1;
}

export function registerRecoveryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, env } = deps;
  // Per-instance cap on top of the database-backed limits below.
  const rateLimit = { max: Math.max(30, Math.floor(env.RATE_LIMIT_PER_MINUTE / 10)), timeWindow: '15 minutes' };

  /** Re-check the current PIN; wrong guesses count towards the same lockout as logging in. */
  async function confirmPin(req: FastifyRequest, user: User, pin: string): Promise<void> {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw locked(`Too many wrong PINs. Try again in ${minutesUntil(user.lockedUntil)} minutes.`);
    }
    if (await verifyPin(pin, user.pinHash, env.PIN_PEPPER)) {
      if (user.failedPinAttempts > 0) await db.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
      return;
    }
    const failures = user.failedPinAttempts + 1;
    await db.user.update({ where: { id: user.id }, data: { failedPinAttempts: failures, lockedUntil: lockUntilFor(failures) } });
    await recordAuthEvent(db, { type: 'RECOVERY_PIN_CHECK_FAILED', userId: user.id, ip: req.ip });
    throw validationError('Current PIN is incorrect.', { currentPin: 'Current PIN is incorrect' });
  }

  /** A code from the user's active authenticator (used to replace or turn off recovery). */
  async function confirmAuthenticator(req: FastifyRequest, user: User, code: string | undefined, key: Buffer): Promise<void> {
    const factor = await db.totpFactor.findUnique({ where: { userId: user.id } });
    if (!factor?.secretEnc || !factor.enabledAt) throw validationError('PIN recovery is not set up.');
    if (!code) throw validationError('Enter the 6-digit code from your authenticator app.', { code: 'Enter the 6-digit code' });

    const since = new Date(Date.now() - CODE_CHECK_WINDOW_MS);
    const recent = await recentEvents(db, { types: ['TOTP_CHECK_FAILED'], userId: user.id }, since);
    if (recent.count >= MAX_CODE_FAILURES && recent.oldest) {
      throw locked(`Too many wrong codes. Try again in ${minutesUntil(new Date(recent.oldest.getTime() + CODE_CHECK_WINDOW_MS))} minutes.`);
    }
    const step = verifyTotp(unseal(factor.secretEnc, key, totpBinding(user.id)), code, { lastUsedStep: factor.lastUsedStep });
    if (step === null || !(await claimTotpStep(db, user.id, step))) {
      await recordAuthEvent(db, { type: 'TOTP_CHECK_FAILED', userId: user.id, ip: req.ip });
      throw validationError(WRONG_CODE, { code: 'Wrong or expired code' });
    }
  }

  const me = (req: FastifyRequest) => db.user.findUniqueOrThrow({ where: { id: requireAuth(req).userId } });

  app.get('/api/auth/recovery', async (req): Promise<RecoveryStatus> => {
    const { userId } = requireAuth(req);
    const [factor, codesLeft] = await Promise.all([
      db.totpFactor.findUnique({ where: { userId }, select: { enabledAt: true } }),
      db.recoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      available: totpKey(env) !== null,
      enabled: Boolean(factor?.enabledAt),
      enabledAt: factor?.enabledAt?.toISOString() ?? null,
      recoveryCodesLeft: factor?.enabledAt ? codesLeft : 0,
    };
  });

  /** Step 1: a new secret, held as "pending" until a code from it is verified. */
  app.post('/api/auth/recovery/setup', { config: { rateLimit } }, async (req): Promise<RecoverySetupInfo> => {
    const key = requireTotpKey(deps);
    const input = parse(recoverySetupSchema, req.body);
    const user = await me(req);
    await confirmPin(req, user, input.currentPin);
    const existing = await db.totpFactor.findUnique({ where: { userId: user.id } });
    // Replacing a working authenticator needs a code from it, not just the PIN.
    if (existing?.enabledAt) await confirmAuthenticator(req, user, input.code, key);

    const secret = newTotpSecret();
    const pendingExpiresAt = new Date(Date.now() + SETUP_MINUTES * 60 * 1000);
    const pending = { pendingSecretEnc: seal(secret, key, totpBinding(user.id)), pendingExpiresAt, pendingFailedAttempts: 0 };
    await db.totpFactor.upsert({ where: { userId: user.id }, create: { userId: user.id, ...pending }, update: pending });
    await recordAuthEvent(db, { type: 'TOTP_SETUP_STARTED', userId: user.id, ip: req.ip, detail: { replacing: Boolean(existing?.enabledAt) } });

    const accountName = formatPhone(user.phone);
    const uri = otpauthUri(secret, env.RP_NAME, accountName);
    return {
      issuer: env.RP_NAME,
      accountName,
      secret: groupSecret(secret),
      otpauthUri: uri,
      qrDataUrl: await qrDataUrl(uri),
      type: 'Time-based',
      digits: TOTP_SETTINGS.digits,
      periodSeconds: TOTP_SETTINGS.period,
      expiresAt: pendingExpiresAt.toISOString(),
    };
  });

  /** Step 2: prove the authenticator works; recovery turns on and recovery codes are shown once. */
  app.post('/api/auth/recovery/verify', { config: { rateLimit } }, async (req): Promise<RecoveryCodesResult> => {
    const key = requireTotpKey(deps);
    const { code } = parse(recoveryVerifySchema, req.body);
    const { userId } = requireAuth(req);
    const factor = await db.totpFactor.findUnique({ where: { userId } });
    if (!factor?.pendingSecretEnc || !factor.pendingExpiresAt || factor.pendingExpiresAt.getTime() <= Date.now()) {
      throw expired('This setup has expired. Please start again.');
    }

    const secret = unseal(factor.pendingSecretEnc, key, totpBinding(userId));
    const step = verifyTotp(secret, code);
    if (step === null) {
      const failures = factor.pendingFailedAttempts + 1;
      await recordAuthEvent(db, { type: 'TOTP_SETUP_FAILED', userId, ip: req.ip });
      if (failures >= MAX_SETUP_FAILURES) {
        await db.totpFactor.update({ where: { userId }, data: { pendingSecretEnc: null, pendingExpiresAt: null, pendingFailedAttempts: 0 } });
        throw expired('Too many wrong codes. Please start the setup again.');
      }
      await db.totpFactor.update({ where: { userId }, data: { pendingFailedAttempts: failures } });
      throw validationError(
        "That code didn't work. Make sure your phone's time is set automatically, then enter the current code.",
        { code: 'Wrong or expired code' },
      );
    }

    const replacing = Boolean(factor.enabledAt);
    const recoveryCodes = await db.$transaction(async (tx) => {
      // Only the request that still finds this exact pending secret switches it on.
      const { count } = await tx.totpFactor.updateMany({
        where: { userId, pendingSecretEnc: factor.pendingSecretEnc },
        data: {
          secretEnc: factor.pendingSecretEnc,
          enabledAt: new Date(),
          lastUsedStep: step,
          pendingSecretEnc: null,
          pendingExpiresAt: null,
          pendingFailedAttempts: 0,
        },
      });
      if (count !== 1) throw expired('This setup has expired. Please start again.');
      const codes = await issueRecoveryCodes(tx, userId, env.PIN_PEPPER);
      await recordAuthEvent(tx, { type: replacing ? 'TOTP_REPLACED' : 'TOTP_ENABLED', userId, ip: req.ip });
      await recordAuthEvent(tx, { type: 'RECOVERY_CODES_GENERATED', userId, ip: req.ip, detail: { count: codes.length } });
      return codes;
    });
    return { recoveryCodes };
  });

  /** New recovery codes (the old ones stop working): current PIN plus an authenticator code. */
  app.post('/api/auth/recovery/codes', { config: { rateLimit } }, async (req): Promise<RecoveryCodesResult> => {
    const key = requireTotpKey(deps);
    const input = parse(recoveryConfirmSchema, req.body);
    const user = await me(req);
    await confirmPin(req, user, input.currentPin);
    await confirmAuthenticator(req, user, input.code, key);
    const recoveryCodes = await db.$transaction(async (tx) => {
      const codes = await issueRecoveryCodes(tx, user.id, env.PIN_PEPPER);
      await recordAuthEvent(tx, { type: 'RECOVERY_CODES_GENERATED', userId: user.id, ip: req.ip, detail: { count: codes.length } });
      return codes;
    });
    return { recoveryCodes };
  });

  /** Turn recovery off: current PIN plus an authenticator code. */
  app.post('/api/auth/recovery/disable', { config: { rateLimit } }, async (req, reply) => {
    const key = requireTotpKey(deps);
    const input = parse(recoveryConfirmSchema, req.body);
    const user = await me(req);
    await confirmPin(req, user, input.currentPin);
    await confirmAuthenticator(req, user, input.code, key);
    await db.$transaction(async (tx) => {
      await tx.totpFactor.delete({ where: { userId: user.id } });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await recordAuthEvent(tx, { type: 'TOTP_DISABLED', userId: user.id, ip: req.ip });
    });
    return reply.status(204).send();
  });
}
