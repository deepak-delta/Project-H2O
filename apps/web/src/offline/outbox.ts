/**
 * Offline outbox: actions recorded without a connection wait here and are sent later.
 *
 * Every queued request carries the clientId the server uses as its idempotency key, so a
 * request that is retried (or that reached the server before the connection dropped) is
 * recorded exactly once. Nothing is ever dropped silently: an item leaves the outbox only
 * when the server accepted it, or when the user explicitly discards a failed one.
 */

export type OutboxKind = 'quickSale' | 'deliverOrder' | 'payment' | 'canReturn' | 'cashEntry' | 'placeOrder';
export type OutboxStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface OutboxItem {
  /** The request's clientId — also the idempotency key on the server. */
  id: string;
  userId: string;
  kind: OutboxKind;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which an automatic retry is not attempted. */
  nextAttemptAt: number;
  lastError: string | null;
  summary: { title: string; detail: string; storeId: string | null };
}

export interface OutboxStorage {
  load(userId: string): Promise<OutboxItem[]>;
  save(userId: string, items: OutboxItem[]): Promise<void>;
}

export type TransportResult = { ok: true } | { ok: false; status: number; message: string };
/** status 0 = no response (offline, timeout, DNS…). */
export type Transport = (path: string, body: Record<string, unknown>) => Promise<TransportResult>;

export interface SyncResult {
  synced: number;
  failed: number;
  waiting: number;
  /** The session expired; items wait until the user logs in again. */
  authRequired: boolean;
}

export type Lock = <T>(name: string, fn: () => Promise<T>) => Promise<T | null>;

/** Serialises work per lock name inside one tab (fallback when Web Locks are unavailable). */
export function memoryLock(): Lock {
  const chains = new Map<string, Promise<unknown>>();
  return (name, fn) => {
    const prev = chains.get(name) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(name, next.catch(() => undefined));
    return next;
  };
}

const MAX_BACKOFF_MS = 5 * 60 * 1000;
export function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
}

/** Server said no for a reason retrying won't fix (validation, conflict, not found…). */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export class Outbox {
  private readonly now: () => number;
  private readonly lock: Lock;
  /** Second lock name used only to keep two syncs (e.g. two tabs) from running together. */
  private readonly trySyncLock: Lock;

  constructor(
    private readonly storage: OutboxStorage,
    options: { now?: () => number; lock?: Lock; trySyncLock?: Lock } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.lock = options.lock ?? memoryLock();
    this.trySyncLock = options.trySyncLock ?? memoryLock();
  }

  private mutate<T>(userId: string, fn: (items: OutboxItem[]) => { items: OutboxItem[]; result: T }): Promise<T> {
    return this.lock(`outbox:${userId}`, async () => {
      const current = await this.storage.load(userId);
      const { items, result } = fn(current);
      await this.storage.save(userId, items);
      return result;
    }) as Promise<T>;
  }

  list(userId: string): Promise<OutboxItem[]> {
    return this.storage.load(userId);
  }

  add(item: Omit<OutboxItem, 'status' | 'attempts' | 'nextAttemptAt' | 'lastError'>): Promise<OutboxItem> {
    return this.mutate(item.userId, (items) => {
      const existing = items.find((i) => i.id === item.id);
      if (existing) return { items, result: existing };
      const full: OutboxItem = { ...item, status: 'PENDING', attempts: 0, nextAttemptAt: 0, lastError: null };
      return { items: [...items, full], result: full };
    });
  }

  /** Put a failed item back in line (the user tapped "Try again"). */
  retry(userId: string, id: string): Promise<void> {
    return this.mutate(userId, (items) => ({
      items: items.map((i) => (i.id === id ? { ...i, status: 'PENDING' as const, nextAttemptAt: 0, lastError: null } : i)),
      result: undefined,
    }));
  }

  /** Only for items the user chose to throw away after seeing why they failed. */
  discard(userId: string, id: string): Promise<void> {
    return this.mutate(userId, (items) => ({ items: items.filter((i) => i.id !== id), result: undefined }));
  }

  /**
   * Sends waiting items oldest first. Stops at the first connection problem (the rest would
   * fail the same way) and leaves rejected items as FAILED for the user to review.
   * Returns null if another sync is already running.
   */
  async sync(userId: string, transport: Transport, options: { force?: boolean } = {}): Promise<SyncResult | null> {
    return this.trySyncLock(`sync:${userId}`, async () => {
      const result: SyncResult = { synced: 0, failed: 0, waiting: 0, authRequired: false };

      for (;;) {
        const now = this.now();
        const next = await this.mutate(userId, (items) => {
          // Strictly oldest first: if the oldest waiting item isn't due yet, everything waits,
          // so entries reach the server in the order they happened.
          const candidate = items
            .filter((i) => i.status !== 'FAILED')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          if (!candidate || (!options.force && candidate.nextAttemptAt > now)) return { items, result: null };
          const syncing = { ...candidate, status: 'SYNCING' as const };
          return { items: items.map((i) => (i.id === candidate.id ? syncing : i)), result: syncing };
        });
        if (!next) break;

        let outcome: TransportResult;
        try {
          outcome = await transport(next.path, next.body);
        } catch (err) {
          outcome = { ok: false, status: 0, message: err instanceof Error ? err.message : 'Network error' };
        }

        if (outcome.ok) {
          await this.mutate(userId, (items) => ({ items: items.filter((i) => i.id !== next.id), result: undefined }));
          result.synced += 1;
          continue;
        }

        if (isPermanent(outcome.status)) {
          await this.mutate(userId, (items) => ({
            items: items.map((i) => (i.id === next.id ? { ...i, status: 'FAILED' as const, attempts: i.attempts + 1, lastError: outcome.message } : i)),
            result: undefined,
          }));
          result.failed += 1;
          continue;
        }

        // Temporary problem: wait and try again later; don't hammer the server.
        await this.mutate(userId, (items) => ({
          items: items.map((i) =>
            i.id === next.id
              ? {
                  ...i,
                  status: 'PENDING' as const,
                  attempts: i.attempts + 1,
                  nextAttemptAt: this.now() + backoffMs(i.attempts + 1),
                  lastError: outcome.message,
                }
              : i,
          ),
          result: undefined,
        }));
        if (outcome.status === 401) result.authRequired = true;
        break;
      }

      const remaining = await this.storage.load(userId);
      result.waiting = remaining.filter((i) => i.status !== 'FAILED').length;
      return result;
    });
  }

  /** After a crash mid-sync an item can be left as SYNCING; treat it as waiting again. */
  recover(userId: string): Promise<void> {
    return this.mutate(userId, (items) => ({
      items: items.map((i) => (i.status === 'SYNCING' ? { ...i, status: 'PENDING' as const } : i)),
      result: undefined,
    }));
  }
}
