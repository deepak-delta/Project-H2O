import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { memoryLock, type Lock, type OutboxItem, type OutboxStorage } from './outbox';

/**
 * IndexedDB holds two things on the phone: the outbox (entries waiting to sync) and a copy of
 * recently viewed data so the app still opens and shows it offline. If IndexedDB is not
 * available (some private-browsing modes) everything falls back to memory for this session.
 */
let idb: UseStore | null = null;
try {
  idb = typeof indexedDB === 'undefined' ? null : createStore('wd-offline', 'kv');
} catch {
  idb = null;
}

const memory = new Map<string, unknown>();

async function read<T>(key: string): Promise<T | undefined> {
  if (idb) {
    try {
      return await get<T>(key, idb);
    } catch {
      // fall through to memory
    }
  }
  return memory.get(key) as T | undefined;
}

async function write(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  if (idb) {
    try {
      await set(key, value, idb);
    } catch {
      // memory copy kept
    }
  }
}

async function remove(key: string): Promise<void> {
  memory.delete(key);
  if (idb) await del(key, idb).catch(() => undefined);
}

export const outboxStorage: OutboxStorage = {
  load: async (userId) => (await read<OutboxItem[]>(`outbox:${userId}`)) ?? [],
  save: (userId, items) => write(`outbox:${userId}`, items),
};

/** Web Locks coordinate tabs; `try` returns null instead of waiting if the lock is taken. */
export function browserLock(mode: 'wait' | 'try'): Lock {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return memoryLock();
  return (name, fn) =>
    navigator.locks.request(name, mode === 'try' ? { ifAvailable: true } : {}, async (lock) => (lock ? fn() : null));
}

const CACHE_KEY = 'query-cache';

/** Saves the query cache at most once a second (it changes on every fetch). */
export function createQueryPersister(): Persister {
  let timer: number | undefined;
  return {
    persistClient: (client: PersistedClient) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void write(CACHE_KEY, client), 1000);
    },
    restoreClient: () => read<PersistedClient>(CACHE_KEY),
    removeClient: () => {
      window.clearTimeout(timer);
      return remove(CACHE_KEY);
    },
  };
}

export const queryPersister = createQueryPersister();
