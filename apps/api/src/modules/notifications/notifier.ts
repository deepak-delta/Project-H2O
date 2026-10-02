import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../lib/db';
import type { PushMessage, PushSender } from '../../lib/push';

/** Never let a slow push service hold up the response for a sale or payment. */
const SEND_BUDGET_MS = 2500;

/**
 * Sends notifications after the business action has been saved. Failures are logged and
 * swallowed: a missed notification must never undo or block a delivery or payment.
 */
export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly sender: PushSender | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return this.sender !== null;
  }

  get publicKey(): string | null {
    return this.sender?.publicKey ?? null;
  }

  /** Every device of one user (e.g. "send me a test"). */
  async toUser(userId: string, message: PushMessage): Promise<number> {
    return this.toUsers({ id: userId, active: true }, message);
  }

  /** All active supplier-side users of a business. */
  async toSupplier(supplierId: string, message: PushMessage): Promise<number> {
    return this.toUsers({ supplierId, role: 'SUPPLIER', active: true }, message);
  }

  /** The store's own login, if it has one and it is active. */
  async toStore(storeId: string, message: PushMessage): Promise<number> {
    return this.toUsers({ storeId, role: 'STORE', active: true }, message);
  }

  private async toUsers(
    where: { id?: string; supplierId?: string; storeId?: string; role?: 'SUPPLIER' | 'STORE'; active: true },
    message: PushMessage,
  ): Promise<number> {
    const sender = this.sender;
    if (!sender) return 0;
    try {
      const subs = await this.db.pushSubscription.findMany({ where: { user: where } });
      if (subs.length === 0) return 0;

      const work = Promise.all(
        subs.map(async (s) => {
          const result = await sender.send(s, message);
          if (result === 'gone') await this.db.pushSubscription.deleteMany({ where: { id: s.id } });
          else if (result === 'ok') await this.db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
          return result === 'ok' ? 1 : 0;
        }),
      ).then((r) => r.reduce<number>((a, b) => a + b, 0));

      const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(0), SEND_BUDGET_MS));
      return await Promise.race([work, timeout]);
    } catch (err) {
      this.log.warn({ err }, 'push notification failed');
      return 0;
    }
  }
}
