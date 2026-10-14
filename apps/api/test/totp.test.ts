import { pinResetCompleteSchema, recoveryCodeSchema, totpCodeSchema } from '@wd/shared';
import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from '../src/modules/auth/pin';
import { formatRecoveryCode, newRecoveryCode, recoveryCodeHash } from '../src/modules/auth/recovery-codes';
import { seal, totpKey, unseal } from '../src/modules/auth/secret-box';
import { currentStep, groupSecret, newTotpSecret, otpauthUri, verifyTotp } from '../src/modules/auth/totp';

/** What an authenticator app shows for this secret at this moment. */
const codeAt = (secret: string, timestamp: number) =>
  new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate({ timestamp });

const NOW = Date.UTC(2026, 9, 14, 10, 0, 15);

describe('TOTP verification', () => {
  const secret = newTotpSecret();

  it('accepts the current code and returns its time step', () => {
    expect(verifyTotp(secret, codeAt(secret, NOW), { now: NOW })).toBe(currentStep(NOW));
  });

  it('allows one step of clock drift either way', () => {
    expect(verifyTotp(secret, codeAt(secret, NOW - 30_000), { now: NOW })).toBe(currentStep(NOW) - 1);
    expect(verifyTotp(secret, codeAt(secret, NOW + 30_000), { now: NOW })).toBe(currentStep(NOW) + 1);
  });

  it('rejects expired and future codes outside the window', () => {
    expect(verifyTotp(secret, codeAt(secret, NOW - 90_000), { now: NOW })).toBeNull();
    expect(verifyTotp(secret, codeAt(secret, NOW + 90_000), { now: NOW })).toBeNull();
  });

  it('rejects wrong and malformed codes', () => {
    const right = codeAt(secret, NOW);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotp(secret, wrong, { now: NOW })).toBeNull();
    expect(verifyTotp(secret, '12345', { now: NOW })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now: NOW })).toBeNull();
    expect(verifyTotp(newTotpSecret(), right, { now: NOW })).toBeNull();
  });

  it('never accepts the same code (or an older one) twice', () => {
    const step = verifyTotp(secret, codeAt(secret, NOW), { now: NOW });
    expect(verifyTotp(secret, codeAt(secret, NOW), { now: NOW, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, codeAt(secret, NOW - 30_000), { now: NOW, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, codeAt(secret, NOW + 30_000), { now: NOW, lastUsedStep: step })).toBe(step! + 1);
  });
});

describe('manual setup', () => {
  it('a grouped key typed into an authenticator app produces the same codes', () => {
    const secret = newTotpSecret();
    const grouped = groupSecret(secret);
    expect(grouped).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
    // Authenticator apps ignore the spaces.
    const typed = grouped.replace(/ /g, '');
    expect(verifyTotp(secret, codeAt(typed, NOW), { now: NOW })).not.toBeNull();
  });

  it('secrets are 160-bit and unique', () => {
    const a = newTotpSecret();
    expect(a).toHaveLength(32);
    expect(new Set(Array.from({ length: 50 }, newTotpSecret)).size).toBe(50);
  });

  it('the otpauth link names the app, the phone and the time-based settings', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'Water Delivery', '98460 12345'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Water Delivery:98460 12345');
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      issuer: 'Water Delivery',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });

  it('accepts codes typed with spaces', () => {
    expect(totpCodeSchema.parse(' 123 456 ')).toBe('123456');
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
  });
});

describe('secret encryption at rest', () => {
  const key = totpKey({ NODE_ENV: 'test', TOTP_ENCRYPTION_KEY: undefined })!;

  it('round-trips, and the ciphertext reveals nothing', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', key, 'totp:user1');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(unseal(sealed, key, 'totp:user1')).toBe('JBSWY3DPEHPK3PXP');
    expect(seal('JBSWY3DPEHPK3PXP', key, 'totp:user1')).not.toBe(sealed); // fresh IV each time
  });

  it("won't decrypt for another user, with another key, or after tampering", () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', key, 'totp:user1');
    expect(() => unseal(sealed, key, 'totp:user2')).toThrow();
    expect(() => unseal(sealed, Buffer.alloc(32, 7), 'totp:user1')).toThrow();
    const [v, iv, tag, ct] = sealed.split('.');
    const flipped = ct!.slice(0, -2) + (ct!.endsWith('AA') ? 'AB' : 'AA');
    expect(() => unseal([v, iv, tag, flipped].join('.'), key, 'totp:user1')).toThrow();
  });

  it('is off in production until a key is configured', () => {
    expect(totpKey({ NODE_ENV: 'production', TOTP_ENCRYPTION_KEY: undefined })).toBeNull();
    const configured = totpKey({ NODE_ENV: 'production', TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
    expect(configured?.length).toBe(32);
  });
});

describe('recovery codes', () => {
  it('are 10 characters without look-alike letters, shown as two groups', () => {
    const codes = Array.from({ length: 200 }, newRecoveryCode);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    expect(new Set(codes).size).toBe(200);
    expect(formatRecoveryCode('7KQ2MXW9PD')).toBe('7KQ2M-XW9PD');
  });

  it('are typed forgivingly', () => {
    expect(recoveryCodeSchema.parse(' 7kq2m-xw9pd ')).toBe('7KQ2MXW9PD');
    expect(recoveryCodeSchema.safeParse('7KQ2M').success).toBe(false);
  });

  it('are stored as keyed hashes tied to one user', () => {
    const h = recoveryCodeHash('7KQ2MXW9PD', 'user1', 'pepper-1234567890');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('7KQ2MXW9PD');
    expect(recoveryCodeHash('7KQ2MXW9PD', 'user1', 'pepper-1234567890')).toBe(h);
    expect(recoveryCodeHash('7KQ2MXW9PD', 'user2', 'pepper-1234567890')).not.toBe(h);
    expect(recoveryCodeHash('7KQ2MXW9PD', 'user1', 'another-pepper-123')).not.toBe(h);
  });
});

describe('new PIN rules', () => {
  it('must be exactly 6 digits and typed the same twice', () => {
    expect(pinResetCompleteSchema.safeParse({ pin: '482913', confirmPin: '482913' }).success).toBe(true);
    for (const pin of ['48291', '4829130', '48291a', '']) {
      expect(pinResetCompleteSchema.safeParse({ pin, confirmPin: pin }).success).toBe(false);
    }
    expect(pinResetCompleteSchema.safeParse({ pin: '482913', confirmPin: '482914' }).success).toBe(false);
  });

  it('is stored as a salted, peppered scrypt hash', async () => {
    const a = await hashPin('482913', 'pepper-1234567890');
    const b = await hashPin('482913', 'pepper-1234567890');
    expect(a).not.toBe(b);
    expect(a).not.toContain('482913');
    expect(await verifyPin('482913', a, 'pepper-1234567890')).toBe(true);
    expect(await verifyPin('482914', a, 'pepper-1234567890')).toBe(false);
    expect(await verifyPin('482913', a, 'other-pepper-12345')).toBe(false);
  });
});
