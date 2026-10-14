import type { RecoverySetupInfo } from '@wd/shared';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recoveryCodeHash } from '../src/modules/auth/recovery-codes';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';

let ctx: TestContext;
const PIN = '482913';
const PEPPER = process.env.PIN_PEPPER ?? 'dev-only-pepper-change-me';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => resetDb(ctx.db));

/** The code an authenticator app would show for a setup key, `offset` seconds from now. */
const codeFor = (groupedSecret: string, offsetSeconds = 0) =>
  new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(groupedSecret.replace(/ /g, '')) }).generate({
    timestamp: Date.now() + offsetSeconds * 1000,
  });

/** An owner with PIN recovery switched on. */
async function ownerWithRecovery() {
  const owner = await signupSupplier(ctx.app, { pin: PIN });
  const setup = await owner.client.post('/api/auth/recovery/setup', { currentPin: PIN });
  expect(setup.statusCode).toBe(200);
  const info = setup.json<RecoverySetupInfo>();
  const verify = await owner.client.post('/api/auth/recovery/verify', { code: codeFor(info.secret) });
  expect(verify.statusCode).toBe(200);
  const { recoveryCodes } = verify.json<{ recoveryCodes: string[] }>();
  return { ...owner, secret: info.secret, recoveryCodes };
}

/** A signed-out phone going through Forgot PIN up to the code step. */
async function startReset(phone: string) {
  const client = new Client(ctx.app);
  const res = await client.post('/api/auth/pin-reset/start', { phone });
  return { client, res };
}

const events = (type: string) => ctx.db.authEvent.count({ where: { type } });

describe('setting up PIN recovery', () => {
  it('starts off, and needs the current PIN to begin', async () => {
    const { client } = await signupSupplier(ctx.app, { pin: PIN });
    expect((await client.get('/api/auth/recovery')).json()).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: 0 });
    const wrong = await client.post('/api/auth/recovery/setup', { currentPin: '111111' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPin).toBeTruthy();
    expect(await events('RECOVERY_PIN_CHECK_FAILED')).toBe(1);
  });

  it('manual setup: issuer, phone, grouped key, time-based; verify one code; 10 one-time codes once', async () => {
    const { client, input, me } = await signupSupplier(ctx.app, { pin: PIN });
    const info = (await client.post('/api/auth/recovery/setup', { currentPin: PIN })).json<RecoverySetupInfo>();
    expect(info).toMatchObject({ issuer: 'Water Delivery', type: 'Time-based', digits: 6, periodSeconds: 30 });
    expect(info.accountName.replace(/\D/g, '')).toBe(input.phone.replace(/\D/g, '').slice(-10));
    expect(info.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(info.otpauthUri).toContain(`secret=${info.secret.replace(/ /g, '')}`);
    expect(info.qrDataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);

    // Not on until a code is verified.
    expect((await client.get('/api/auth/recovery')).json().enabled).toBe(false);

    const res = await client.post('/api/auth/recovery/verify', { code: codeFor(info.secret) });
    expect(res.statusCode).toBe(200);
    const { recoveryCodes } = res.json<{ recoveryCodes: string[] }>();
    expect(recoveryCodes).toHaveLength(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);

    const status = (await client.get('/api/auth/recovery')).json();
    expect(status).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect(JSON.stringify(status)).not.toContain(info.secret.replace(/ /g, '').slice(0, 8));

    // At rest: secret encrypted, recovery codes only as hashes.
    const factor = await ctx.db.totpFactor.findUniqueOrThrow({ where: { userId: me.user.id } });
    expect(factor.secretEnc).not.toContain(info.secret.replace(/ /g, ''));
    expect(factor.pendingSecretEnc).toBeNull();
    const stored = await ctx.db.recoveryCode.findMany({ where: { userId: me.user.id } });
    expect(stored).toHaveLength(10);
    for (const c of recoveryCodes) expect(JSON.stringify(stored)).not.toContain(c.replace('-', ''));
    expect(await events('TOTP_ENABLED')).toBe(1);
  });

  it('rejects wrong and expired codes, and gives up after 5 wrong ones', async () => {
    const { client } = await signupSupplier(ctx.app, { pin: PIN });
    const info = (await client.post('/api/auth/recovery/setup', { currentPin: PIN })).json<RecoverySetupInfo>();
    const expired = await client.post('/api/auth/recovery/verify', { code: codeFor(info.secret, -150) });
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error.fields.code).toBeTruthy();
    for (let i = 0; i < 3; i++) expect((await client.post('/api/auth/recovery/verify', { code: '000000' })).statusCode).toBe(400);
    const fifth = await client.post('/api/auth/recovery/verify', { code: '000000' });
    expect(fifth.statusCode).toBe(410);
    // Even the right code no longer works: the setup must start again.
    expect((await client.post('/api/auth/recovery/verify', { code: codeFor(info.secret) })).statusCode).toBe(410);
  });

  it('an abandoned setup expires', async () => {
    const { client, me } = await signupSupplier(ctx.app, { pin: PIN });
    const info = (await client.post('/api/auth/recovery/setup', { currentPin: PIN })).json<RecoverySetupInfo>();
    await ctx.db.totpFactor.update({ where: { userId: me.user.id }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    const res = await client.post('/api/auth/recovery/verify', { code: codeFor(info.secret) });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('EXPIRED');
  });

  it('replacing the authenticator needs the PIN and a code from the current one', async () => {
    const owner = await ownerWithRecovery();
    expect((await owner.client.post('/api/auth/recovery/setup', { currentPin: PIN })).statusCode).toBe(400);
    expect((await owner.client.post('/api/auth/recovery/setup', { currentPin: PIN, code: '000000' })).statusCode).toBe(400);
    const res = await owner.client.post('/api/auth/recovery/setup', { currentPin: PIN, code: codeFor(owner.secret, 30) });
    expect(res.statusCode).toBe(200);
    const next = res.json<RecoverySetupInfo>();
    expect(next.secret).not.toBe(owner.secret);
    expect((await owner.client.post('/api/auth/recovery/verify', { code: codeFor(next.secret) })).statusCode).toBe(200);
    expect(await events('TOTP_REPLACED')).toBe(1);

    // The old authenticator no longer resets the PIN.
    const { client } = await startReset(owner.input.phone);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: codeFor(owner.secret, 30) })).statusCode).toBe(400);
  });

  it('new recovery codes replace the old ones', async () => {
    const owner = await ownerWithRecovery();
    const res = await owner.client.post('/api/auth/recovery/codes', { currentPin: PIN, code: codeFor(owner.secret, 30) });
    expect(res.statusCode).toBe(200);
    expect(res.json().recoveryCodes).toHaveLength(10);
    const { client } = await startReset(owner.input.phone);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] })).statusCode).toBe(400);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: res.json().recoveryCodes[0] })).statusCode).toBe(200);
  });

  it('turning it off needs the current PIN plus an authenticator code', async () => {
    const owner = await ownerWithRecovery();
    expect((await owner.client.post('/api/auth/recovery/disable', { currentPin: '111111', code: codeFor(owner.secret, 30) })).statusCode).toBe(400);
    expect((await owner.client.post('/api/auth/recovery/disable', { currentPin: PIN, code: '000000' })).statusCode).toBe(400);
    expect((await owner.client.post('/api/auth/recovery/disable', { currentPin: PIN, code: codeFor(owner.secret, 30) })).statusCode).toBe(204);
    expect((await owner.client.get('/api/auth/recovery')).json()).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
    expect(await ctx.db.recoveryCode.count()).toBe(0);
    expect(await events('TOTP_DISABLED')).toBe(1);
    // Old recovery codes are gone with it.
    const { client } = await startReset(owner.input.phone);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] })).statusCode).toBe(400);
  });

  it('too many wrong authenticator codes lock these settings for a while', async () => {
    const owner = await ownerWithRecovery();
    for (let i = 0; i < 5; i++) {
      expect((await owner.client.post('/api/auth/recovery/codes', { currentPin: PIN, code: '000000' })).statusCode).toBe(400);
    }
    expect((await owner.client.post('/api/auth/recovery/codes', { currentPin: PIN, code: codeFor(owner.secret, 30) })).statusCode).toBe(423);
  });
});

describe('resetting a forgotten PIN', () => {
  it('with the authenticator: new PIN works, old PIN and every session stop working', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    // The setup already used this 30-second code; the next one is accepted (clock drift window).
    const verify = await client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: codeFor(owner.secret, 30) });
    expect(verify.statusCode).toBe(200);
    const done = await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' });
    expect(done.statusCode).toBe(204);

    expect((await owner.client.get('/api/auth/me')).statusCode).toBe(401);
    const fresh = new Client(ctx.app);
    expect((await fresh.post('/api/auth/login', { phone: owner.input.phone, pin: PIN })).statusCode).toBe(401);
    expect((await fresh.post('/api/auth/login', { phone: owner.input.phone, pin: '864209' })).statusCode).toBe(200);
    expect(await events('PIN_RESET_COMPLETED')).toBe(1);
  });

  it('with a recovery code, which then never works again', async () => {
    const owner = await ownerWithRecovery();
    const first = await startReset(owner.input.phone);
    expect((await first.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[3] })).statusCode).toBe(200);
    expect((await first.client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(204);

    const again = await startReset(owner.input.phone);
    const reused = await again.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[3] });
    expect(reused.statusCode).toBe(400);
    // Lower case and spaces are fine.
    const other = owner.recoveryCodes[4]!.toLowerCase().replace('-', ' ');
    expect((await again.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: other })).statusCode).toBe(200);

    const login = new Client(ctx.app);
    await login.post('/api/auth/login', { phone: owner.input.phone, pin: '864209' });
    expect((await login.get('/api/auth/recovery')).json().recoveryCodesLeft).toBe(8);
    expect(await events('RECOVERY_CODE_USED')).toBe(2);
  });

  it('with a one-time support code (admin-assisted), only once and only before it expires', async () => {
    const { input, me } = await signupSupplier(ctx.app, { pin: PIN });
    const issue = (code: string, minutes: number) =>
      ctx.db.assistedResetCode.create({
        data: { userId: me.user.id, codeHash: recoveryCodeHash(code, me.user.id, PEPPER), issuedBy: 'Test', evidence: 'Called back registered number', expiresAt: new Date(Date.now() + minutes * 60000) },
      });
    await issue('7KQ2MXW9PD', -1);
    await issue('8LR3NYX2QE', 30);

    const { client } = await startReset(input.phone);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'ASSISTED', code: '7KQ2M-XW9PD' })).statusCode).toBe(400);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'ASSISTED', code: '8LR3N-YX2QE' })).statusCode).toBe(200);
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(204);
    const again = await startReset(input.phone);
    expect((await again.client.post('/api/auth/pin-reset/verify', { method: 'ASSISTED', code: '8LR3N-YX2QE' })).statusCode).toBe(400);
  });

  it("answers the same for a phone with no account, so it can't be used to find accounts", async () => {
    const owner = await ownerWithRecovery();
    const known = await startReset(owner.input.phone);
    const unknown = await startReset('9000011111');
    expect(unknown.res.statusCode).toBe(known.res.statusCode);
    expect(Object.keys(unknown.res.json())).toEqual(Object.keys(known.res.json()));
    const a = await known.client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: '000000' });
    const b = await unknown.client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: '000000' });
    expect([a.statusCode, a.json().error.message]).toEqual([b.statusCode, b.json().error.message]);
    const c = await unknown.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });
    expect(c.statusCode).toBe(400);
  });

  it('rejects an expired authenticator code', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    const res = await client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: codeFor(owner.secret, -150) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/30 seconds/);
  });

  it('locks the phone after 5 wrong codes, even across new resets', async () => {
    const owner = await ownerWithRecovery();
    const first = await startReset(owner.input.phone);
    for (let i = 0; i < 4; i++) {
      expect((await first.client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: '000000' })).statusCode).toBe(400);
    }
    const second = await startReset(owner.input.phone);
    expect((await second.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: 'AAAAA-AAAAA' })).statusCode).toBe(400);
    // Locked now: even a correct code is refused, and says when to come back.
    const res = await second.client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.message).toMatch(/Try again in \d+ minutes/);
    expect(await events('PIN_RESET_LOCKED')).toBe(1);
    // The recovery code wasn't used up by the refused attempt.
    expect(await ctx.db.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(0);
  });

  it('one reset allows at most 5 wrong codes', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    // Spread over different phones' counters is impossible here, so check the session counter directly.
    await ctx.db.pinResetSession.updateMany({ data: { failedAttempts: 5 } });
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] })).statusCode).toBe(410);
  });

  it('limits how often a reset can be started', async () => {
    const phone = '9000022222';
    for (let i = 0; i < 5; i++) expect((await startReset(phone)).res.statusCode).toBe(200);
    expect((await startReset(phone)).res.statusCode).toBe(429);
  });

  it('the new PIN: 6 digits, typed twice the same, not the current PIN', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '12345', confirmPin: '12345' })).statusCode).toBe(400);
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864208' })).statusCode).toBe(400);
    const same = await client.post('/api/auth/pin-reset/complete', { pin: PIN, confirmPin: PIN });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.fields.pin).toBeTruthy();
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(204);
  });

  it('a reset works once, only after a code, and only on the phone that started it', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(410);
    await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });

    // Another browser without the reset cookie gets nowhere.
    const stranger = new Client(ctx.app);
    expect((await stranger.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(410);

    const cookie = client.cookie;
    expect((await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' })).statusCode).toBe(204);
    const replay = new Client(ctx.app);
    replay.cookie = cookie;
    expect((await replay.post('/api/auth/pin-reset/complete', { pin: '753108', confirmPin: '753108' })).statusCode).toBe(410);
  });

  it('a reset expires', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    await ctx.db.pinResetSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('EXPIRED');
  });

  it('an account without recovery set up cannot be reset (and says nothing more)', async () => {
    const { input } = await signupSupplier(ctx.app, { pin: PIN });
    const { client } = await startReset(input.phone);
    expect((await client.post('/api/auth/pin-reset/verify', { method: 'TOTP', code: '123456' })).statusCode).toBe(400);
  });

  it('the audit trail never contains codes, secrets or PINs', async () => {
    const owner = await ownerWithRecovery();
    const { client } = await startReset(owner.input.phone);
    await client.post('/api/auth/pin-reset/verify', { method: 'RECOVERY', code: owner.recoveryCodes[0] });
    await client.post('/api/auth/pin-reset/complete', { pin: '864209', confirmPin: '864209' });
    const all = JSON.stringify(await ctx.db.authEvent.findMany());
    for (const secret of [owner.recoveryCodes[0]!, owner.recoveryCodes[0]!.replace('-', ''), owner.secret.replace(/ /g, ''), PIN, '864209']) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain('PIN_RESET_COMPLETED');
  });
});

describe('without an encryption key in production', () => {
  it('PIN recovery is reported unavailable instead of failing', async () => {
    const prod = await createTestContext({ NODE_ENV: 'production', PIN_PEPPER: 'a-real-production-pepper-123', TOTP_ENCRYPTION_KEY: '' });
    try {
      const { client } = await signupSupplier(prod.app, { pin: PIN });
      expect((await client.get('/api/auth/recovery')).json().available).toBe(false);
      const res = await client.post('/api/auth/recovery/setup', { currentPin: PIN });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('UNAVAILABLE');
    } finally {
      await closeTestContext(prod);
    }
  });
});
