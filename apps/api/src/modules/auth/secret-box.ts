import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../env';

/**
 * AES-256-GCM encryption for authenticator secrets at rest. Each value is bound to its owner
 * with additional authenticated data, so a ciphertext copied onto another user's row won't
 * decrypt. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */

const DEV_KEY = createHash('sha256').update('water-delivery: development-only TOTP key').digest();

/** The encryption key, or null in production when none is configured (recovery is then off). */
export function totpKey(env: Pick<Env, 'TOTP_ENCRYPTION_KEY' | 'NODE_ENV'>): Buffer | null {
  if (env.TOTP_ENCRYPTION_KEY) return Buffer.from(env.TOTP_ENCRYPTION_KEY, 'base64');
  return env.NODE_ENV === 'production' ? null : DEV_KEY;
}

export function seal(plain: string, key: Buffer, boundTo: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(boundTo));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Throws if the value was tampered with, belongs to someone else, or the key is wrong. */
export function unseal(sealed: string, key: Buffer, boundTo: string): string {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(boundTo));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
