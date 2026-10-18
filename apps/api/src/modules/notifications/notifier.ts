import { waitUntil } from '@vercel/functions';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../lib/db';
import type { NativePushSender, PushMessage, PushSender } from '../../lib/push';

/** Never let a slow push service hold up the response for a sale or payment. */
const SEND_BUDGET_MS = 2500;

export interface PushReport {
  /** Phones registered for these users. */
  devices: number;
  delivered: number;
  failed: number;
}

/**
 * Sends notifications after the business action has been saved. Failures are logged and
 * swallowed: a missed notification must never undo or block a delivery or payment.
 */
export class Notifier {
  constructor(
    private readonly db: Db,
    /** Browsers and installed web apps. */
    private readonly sender: PushSender | null,
    /** The native Android app. */
    private readonly nativeSender: NativePushSender | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return this.webEnabled || this.nativeEnabled;
  }

  get webEnabled(): boolean {
    return this.sender !== null;
  }

  get nativeEnabled(): boolean {
    return this.nativeSender !== null;
  }

  get publicKey(): string | null {
    return this.sender?.publicKey ?? null;
  }

  /** Every device of one user (e.g. "send me a test"). */
  async toUser(userId: string, message: PushMessage): Promise<number> {
    return this.toUsers({ id: userId, active: true }, message);
  }

  /** All active owner logins of a business, except `exceptUserId` (who did the thing). */
  async toSupplier(supplierId: string, message: PushMessage, exceptUserId?: string): Promise<number> {
    return this.toUsers({ supplierId, role: 'SUPPLIER', active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, message);
  }

  /** The store's own login, if it has one and it is active. */
  async toStore(storeId: string, message: PushMessage): Promise<number> {
    return this.toUsers({ storeId, role: 'STORE', active: true }, message);
  }

  /** "Send a test": waits for every phone's answer, so the screen can say what really happened. */
  async testUser(userId: string, message: PushMessage): Promise<PushReport> {
    return this.deliver({ id: userId, active: true }, message);
  }

  private async toUsers(where: UserFilter, message: PushMessage): Promise<number> {
    const work = this.deliver(where, message).then((r) => r.delivered);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SEND_BUDGET_MS);
    });
    const first = await Promise.race([work, late]);
    clearTimeout(timer);
    if (first !== null) return first;
    // Slow push service: answer the user now, but keep the serverless function alive until the
    // notifications have actually gone out (otherwise they're cut off when it's frozen).
    waitUntil(work.catch(() => 0));
    return 0;
  }

  private async deliver(where: UserFilter, message: PushMessage): Promise<PushReport> {
    const report: PushReport = { devices: 0, delivered: 0, failed: 0 };
    // Web and native go out side by side; a failure on one never stops the other.
    const settled = await Promise.allSettled([this.deliverWeb(where, message), this.deliverNative(where, message)]);
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        this.log.warn({ err: outcome.reason }, 'push notification failed');
        continue;
      }
      report.devices += outcome.value.length;
      report.delivered += outcome.value.filter((ok) => ok).length;
      report.failed += outcome.value.filter((ok) => !ok).length;
    }
    return report;
  }

  /** One true/false per registered browser: delivered or not. */
  private async deliverWeb(where: UserFilter, message: PushMessage): Promise<boolean[]> {
    const sender = this.sender;
    if (!sender) return [];
    const subs = await this.db.pushSubscription.findMany({ where: { user: where } });
    return Promise.all(
      subs.map(async (s) => {
        const { result, status } = await sender.send(s, message);
        if (result === 'ok') {
          await this.db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
          return true;
        }
        // Which push service and why, never the endpoint or keys.
        this.log.warn({ status, service: new URL(s.endpoint).host, removed: result === 'gone' }, 'push not delivered');
        if (result === 'gone') await this.db.pushSubscription.deleteMany({ where: { id: s.id } });
        return false;
      }),
    );
  }

  /** One true/false per phone with the native app. */
  private async deliverNative(where: UserFilter, message: PushMessage): Promise<boolean[]> {
    const sender = this.nativeSender;
    if (!sender) return [];
    const phones = await this.db.nativePushToken.findMany({ where: { user: where } });
    return Promise.all(
      phones.map(async (p) => {
        const { result, status } = await sender.send(p.token, message);
        if (result === 'ok') {
          await this.db.nativePushToken.update({ where: { id: p.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
          return true;
        }
        this.log.warn({ status, service: 'fcm', platform: p.platform, removed: result === 'gone' }, 'push not delivered');
        if (result === 'gone') await this.db.nativePushToken.deleteMany({ where: { id: p.id } });
        return false;
      }),
    );
  }
}

type UserFilter = { id?: string | { not: string }; supplierId?: string; storeId?: string; role?: 'SUPPLIER' | 'STORE'; active: true };
