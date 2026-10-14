import { createHmac, randomBytes } from 'node:crypto';

/**
 * One-time recovery (and support) codes: 10 characters from a 32-letter alphabet with no
 * look-alikes (0/O, 1/I), i.e. 50 random bits, shown as "7KQ2M-XW9PD". Only a keyed hash
 * is stored, so the database alone can't reveal or test codes.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCode(): string {
  // 256 is a multiple of 32, so masking each byte keeps every letter equally likely.
  return Array.from(randomBytes(10), (b) => ALPHABET[b & 31]).join('');
}

export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** `code` must already be normalised (upper case, no spaces or dashes). */
export function recoveryCodeHash(code: string, userId: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`recovery-code:${userId}:${code}`).digest('hex');
}
