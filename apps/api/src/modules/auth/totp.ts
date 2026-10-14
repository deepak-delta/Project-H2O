import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

/**
 * Authenticator-app codes (RFC 6238): SHA-1, 6 digits, 30-second steps, which is what Google
 * Authenticator, Microsoft Authenticator and Authy all use by default.
 */
export const TOTP_SETTINGS = { algorithm: 'SHA1', digits: 6, period: 30 } as const;

/** Accept the previous and next 30-second code too, for phones whose clock is slightly off. */
const DRIFT_STEPS = 1;

/** A fresh 160-bit secret from the OS's secure random generator, base32-encoded. */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to type into an authenticator app. */
export function groupSecret(base32: string): string {
  return base32.match(/.{1,4}/g)?.join(' ') ?? base32;
}

export function otpauthUri(secret: string, issuer: string, accountName: string): string {
  return new TOTP({ issuer, label: accountName, ...TOTP_SETTINGS, secret: Secret.fromBase32(secret) }).toString();
}

export async function qrDataUrl(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_SETTINGS.period);
}

/**
 * Checks a 6-digit code. Returns the time step it belongs to, or null when it's wrong, too old
 * or too new, or already used (step not after `lastUsedStep`), so a code works only once.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { lastUsedStep?: number | null; now?: number } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = options.now ?? Date.now();
  const totp = new TOTP({ ...TOTP_SETTINGS, secret: Secret.fromBase32(secret) });
  const delta = totp.validate({ token: code, timestamp: now, window: DRIFT_STEPS });
  if (delta === null) return null;
  const step = currentStep(now) + delta;
  if (options.lastUsedStep !== null && options.lastUsedStep !== undefined && step <= options.lastUsedStep) return null;
  return step;
}
