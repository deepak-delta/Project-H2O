import type { Db } from '../../lib/db';
import { rateLimited } from '../../lib/errors';

/**
 * Brute-force protection for 6-digit PINs. Serverless instances share nothing in memory,
 * so attempts are counted in Postgres.
 *  - Per account: 5 wrong PINs lock it, doubling from 15 minutes up to 24 hours.
 *  - Per IP: more than 30 failures in 15 minutes blocks further attempts from that IP.
 */
const IP_WINDOW_MS = 15 * 60 * 1000;
const MAX_IP_FAILURES = 30;
export const MAX_PIN_FAILURES = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

export async function assertIpAllowed(db: Db, ip: string): Promise<void> {
  const failures = await db.loginAttempt.count({
    where: { ip, success: false, createdAt: { gte: new Date(Date.now() - IP_WINDOW_MS) } },
  });
  if (failures >= MAX_IP_FAILURES) throw rateLimited();
}

export async function recordAttempt(
  db: Db,
  ip: string,
  phone: string | null,
  success: boolean,
): Promise<void> {
  await db.loginAttempt.create({ data: { ip, phone, success } });
  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await db.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}

/** Returns when the account should unlock after `failures` consecutive wrong PINs, or null. */
export function lockUntilFor(failures: number, now = Date.now()): Date | null {
  if (failures < MAX_PIN_FAILURES) return null;
  const exponent = Math.min(failures - MAX_PIN_FAILURES, 10);
  return new Date(now + Math.min(BASE_LOCK_MS * 2 ** exponent, MAX_LOCK_MS));
}
