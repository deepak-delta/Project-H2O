import type { Prisma } from '../../generated/prisma/client';
import type { Db, Tx } from '../../lib/db';

/**
 * Security audit trail for PIN recovery. Never pass PINs, secrets, codes or tokens in `detail`.
 * Failed-attempt events double as the counters for rate limits and lockouts.
 */
export type AuthEventType =
  | 'TOTP_SETUP_STARTED'
  | 'TOTP_ENABLED'
  | 'TOTP_REPLACED'
  | 'TOTP_SETUP_FAILED'
  | 'TOTP_CHECK_FAILED'
  | 'TOTP_DISABLED'
  | 'RECOVERY_CODES_GENERATED'
  | 'RECOVERY_CODE_USED'
  | 'RECOVERY_PIN_CHECK_FAILED'
  | 'PIN_RESET_STARTED'
  | 'PIN_RESET_FAILED'
  | 'PIN_RESET_LOCKED'
  | 'PIN_RESET_VERIFIED'
  | 'PIN_RESET_COMPLETED'
  | 'ASSISTED_CODE_ISSUED'
  | 'ASSISTED_CODE_USED';

export interface AuthEventInput {
  type: AuthEventType;
  userId?: string | null;
  phone?: string | null;
  ip?: string | null;
  method?: string | null;
  detail?: Prisma.InputJsonValue;
}

export async function recordAuthEvent(db: Db | Tx, e: AuthEventInput): Promise<void> {
  await db.authEvent.create({
    data: { type: e.type, userId: e.userId ?? null, phone: e.phone ?? null, ip: e.ip ?? null, method: e.method ?? null, detail: e.detail },
  });
}

/** How many events of these types matched since `since`, and when the oldest of them happened. */
export async function recentEvents(
  db: Db,
  where: { types: AuthEventType[]; phone?: string; ip?: string; userId?: string },
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const filter = {
    type: { in: where.types },
    createdAt: { gte: since },
    ...(where.phone ? { phone: where.phone } : {}),
    ...(where.ip ? { ip: where.ip } : {}),
    ...(where.userId ? { userId: where.userId } : {}),
  };
  const [count, oldest] = await Promise.all([
    db.authEvent.count({ where: filter }),
    db.authEvent.findFirst({ where: filter, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  return { count, oldest: oldest?.createdAt ?? null };
}
