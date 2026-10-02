import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import { MONEY_AND_STOCK_KEYS } from '../services/queryKeys';
import { Outbox, type OutboxItem, type OutboxKind, type Transport } from './outbox';
import { browserLock, outboxStorage } from './storage';

export const outbox = new Outbox(outboxStorage, { lock: browserLock('wait'), trySyncLock: browserLock('try') });

interface OutboxState {
  userId: string | null;
  items: OutboxItem[];
  syncing: boolean;
  authRequired: boolean;
}

export const useOutbox = create<OutboxState>(() => ({ userId: null, items: [], syncing: false, authRequired: false }));

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('wd-outbox');

export async function refreshOutbox(): Promise<void> {
  const { userId } = useOutbox.getState();
  if (!userId) return;
  const items = await outbox.list(userId);
  if (useOutbox.getState().userId === userId) useOutbox.setState({ items });
}

/** Re-read the outbox here and tell other open tabs to do the same. */
async function changed(): Promise<void> {
  await refreshOutbox();
  channel?.postMessage('changed');
}

if (channel) channel.onmessage = () => void refreshOutbox();

const transport: Transport = async (path, body) => {
  try {
    await api.post(path, body);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, status: err.status, message: err.message };
    return { ok: false, status: 0, message: 'Network error' };
  }
};

let onSynced: (() => void) | null = null;

export async function syncNow(options: { force?: boolean } = {}): Promise<void> {
  const { userId } = useOutbox.getState();
  if (!userId || !navigator.onLine) return;
  useOutbox.setState({ syncing: true });
  try {
    const result = await outbox.sync(userId, transport, options);
    if (result) {
      useOutbox.setState({ authRequired: result.authRequired });
      if (result.synced > 0) onSynced?.();
    }
  } finally {
    useOutbox.setState({ syncing: false });
    await changed();
  }
}

export async function retryItem(id: string): Promise<void> {
  const { userId } = useOutbox.getState();
  if (!userId) return;
  await outbox.retry(userId, id);
  await changed();
  await syncNow();
}

export async function discardItem(id: string): Promise<void> {
  const { userId } = useOutbox.getState();
  if (!userId) return;
  await outbox.discard(userId, id);
  await changed();
}

const SYNC_INTERVAL_MS = 30 * 1000;

/** Runs while someone is signed in: syncs at start, when the network returns, and periodically. */
export function useSyncEngine(userId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    useOutbox.setState({ userId, items: [], authRequired: false });
    onSynced = () => {
      for (const key of MONEY_AND_STOCK_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    };
    void outbox
      .recover(userId)
      .then(refreshOutbox)
      .then(() => syncNow({ force: true }));

    const onOnline = () => void syncNow({ force: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    const timer = window.setInterval(() => {
      if (useOutbox.getState().items.some((i) => i.status === 'PENDING')) void syncNow();
    }, SYNC_INTERVAL_MS);

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      onSynced = null;
      useOutbox.setState({ userId: null, items: [] });
    };
  }, [userId, queryClient]);
}

export type SubmitResult<T> = { queued: false; data: T } | { queued: true; item: OutboxItem };

interface SubmitArgs {
  userId: string;
  kind: OutboxKind;
  path: string;
  body: Record<string, unknown> & { clientId: string };
  summary: OutboxItem['summary'];
}

/**
 * Sends now when there is a connection; otherwise (or if the connection drops mid-request)
 * keeps the entry on the phone to sync later. Safe either way: the server de-duplicates by
 * clientId, so an entry that did reach the server is not recorded twice.
 */
export async function submitOrQueue<T>({ userId, kind, path, body, summary }: SubmitArgs): Promise<SubmitResult<T>> {
  const stamped = { ...body, occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : new Date().toISOString() };
  if (navigator.onLine) {
    try {
      return { queued: false, data: await api.post<T>(path, stamped) };
    } catch (err) {
      if (!(err instanceof ApiError && err.isNetwork)) throw err;
    }
  }
  const item = await outbox.add({ id: body.clientId, userId, kind, path, body: stamped, createdAt: stamped.occurredAt, summary });
  await changed();
  return { queued: true, item };
}

/** Waiting entries for one store (shown on its page so balances aren't misread). */
export function usePendingForStore(storeId: string): OutboxItem[] {
  return useOutbox((s) => s.items).filter((i) => i.summary.storeId === storeId);
}
