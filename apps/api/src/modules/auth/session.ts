import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { AuthContext } from '../../lib/auth-context';
import type { Db } from '../../lib/db';

const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Extend the rolling expiry at most once a day to avoid a write on every request. */
const TOUCH_INTERVAL_MS = DAY_MS;

export function sessionCookieName(secure: boolean): string {
  // __Host- forces Secure, Path=/ and no Domain — the strictest cookie the browser allows.
  return secure ? '__Host-wd_session' : 'wd_session';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: string, userAgent: string | undefined) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 200) },
  });
  return { token, expiresAt };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(sessionCookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(sessionCookieName(secure), { path: '/', secure, httpOnly: true, sameSite: 'lax' });
}

export async function resolveSession(db: Db, token: string): Promise<AuthContext | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, supplierId: true, storeId: true, role: true, active: true } } },
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.active) {
    return null;
  }

  if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_DAYS * DAY_MS) },
    });
  }

  const { user } = session;
  if (user.role === 'STORE') {
    if (!user.storeId) return null;
    return {
      role: 'STORE',
      userId: user.id,
      sessionId: session.id,
      supplierId: user.supplierId,
      storeId: user.storeId,
    };
  }
  if (user.role === 'STAFF') {
    return { role: 'STAFF', userId: user.id, sessionId: session.id, supplierId: user.supplierId, storeId: null };
  }
  return {
    role: 'SUPPLIER',
    userId: user.id,
    sessionId: session.id,
    supplierId: user.supplierId,
    storeId: null,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}
