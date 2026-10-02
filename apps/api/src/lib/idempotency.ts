import { Prisma } from '../generated/prisma/client';

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Runs `create` unless a record with the same client ID already exists. Offline retries and
 * double taps therefore return the original result instead of creating a duplicate.
 *
 * Two identical requests racing each other both pass `find`; the database's unique
 * (supplierId, clientId) constraint makes one of them fail, and that one returns the winner.
 */
export async function idempotent<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const existing = await find();
  if (existing) return { result: existing, replayed: true };
  try {
    return { result: await create(), replayed: false };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await find();
    if (!winner) throw err;
    return { result: winner, replayed: true };
  }
}
