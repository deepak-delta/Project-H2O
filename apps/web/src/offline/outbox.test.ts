import { describe, expect, it } from 'vitest';
import { backoffMs, Outbox, type OutboxItem, type OutboxStorage, type Transport, type TransportResult } from './outbox';

function memoryStorage(): OutboxStorage & { data: Map<string, OutboxItem[]> } {
  const data = new Map<string, OutboxItem[]>();
  return {
    data,
    load: (u) => Promise.resolve(structuredClone(data.get(u) ?? [])),
    save: (u, items) => {
      data.set(u, structuredClone(items));
      return Promise.resolve();
    },
  };
}

let clock = 1_000_000;
const now = () => clock;

function item(id: string, minute: number, kind: OutboxItem['kind'] = 'payment') {
  return {
    id,
    userId: 'u1',
    kind,
    path: `/x/${id}`,
    body: { clientId: id },
    createdAt: `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`,
    summary: { title: id, detail: '', storeId: null },
  };
}

/** Transport that answers from a script and records what was sent. */
function scripted(responses: Record<string, TransportResult[]>) {
  const sent: string[] = [];
  const transport: Transport = (path) => {
    sent.push(path);
    const queue = responses[path];
    const next = queue?.shift();
    return Promise.resolve(next ?? { ok: true });
  };
  return { transport, sent };
}

describe('Outbox', () => {
  it('sends items oldest first and removes them once accepted', async () => {
    const storage = memoryStorage();
    const box = new Outbox(storage, { now });
    await box.add(item('b', 2));
    await box.add(item('a', 1));
    const { transport, sent } = scripted({});
    const result = await box.sync('u1', transport);
    expect(sent).toEqual(['/x/a', '/x/b']);
    expect(result).toMatchObject({ synced: 2, failed: 0, waiting: 0 });
    expect(await box.list('u1')).toEqual([]);
  });

  it('adding the same clientId twice keeps one entry', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    await box.add(item('a', 1));
    expect(await box.list('u1')).toHaveLength(1);
  });

  it('stops at a connection problem and backs off, keeping everything', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    await box.add(item('b', 2));
    const { transport, sent } = scripted({ '/x/a': [{ ok: false, status: 0, message: 'offline' }] });
    const result = await box.sync('u1', transport);
    expect(sent).toEqual(['/x/a']);
    expect(result).toMatchObject({ synced: 0, waiting: 2 });
    const [a] = await box.list('u1');
    expect(a).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'offline', nextAttemptAt: clock + backoffMs(1) });

    // Not due yet: nothing is sent unless forced (e.g. the phone just came online).
    const again = scripted({});
    await box.sync('u1', again.transport);
    expect(again.sent).toEqual([]);
    await box.sync('u1', again.transport, { force: true });
    expect(again.sent).toEqual(['/x/a', '/x/b']);
    expect(await box.list('u1')).toEqual([]);
  });

  it('marks rejected items as failed but carries on with the rest', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    await box.add(item('b', 2));
    const { transport, sent } = scripted({ '/x/a': [{ ok: false, status: 409, message: 'This order was cancelled.' }] });
    const result = await box.sync('u1', transport);
    expect(sent).toEqual(['/x/a', '/x/b']);
    expect(result).toMatchObject({ synced: 1, failed: 1, waiting: 0 });
    expect(await box.list('u1')).toEqual([expect.objectContaining({ id: 'a', status: 'FAILED', lastError: 'This order was cancelled.' })]);

    // Failed items are never retried automatically…
    const again = scripted({});
    await box.sync('u1', again.transport, { force: true });
    expect(again.sent).toEqual([]);
    // …only when the user asks.
    await box.retry('u1', 'a');
    await box.sync('u1', again.transport);
    expect(again.sent).toEqual(['/x/a']);
  });

  it('server errors and timeouts are temporary; an expired session pauses sync', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    for (const status of [500, 503, 408, 429]) {
      clock += 10 * 60 * 1000;
      const { transport } = scripted({ '/x/a': [{ ok: false, status, message: 'later' }] });
      await box.sync('u1', transport);
      expect((await box.list('u1'))[0]?.status).toBe('PENDING');
    }
    clock += 10 * 60 * 1000;
    const { transport } = scripted({ '/x/a': [{ ok: false, status: 401, message: 'Please log in' }] });
    expect(await box.sync('u1', transport)).toMatchObject({ authRequired: true, waiting: 1 });
  });

  it('a thrown transport error counts as offline', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    const result = await box.sync('u1', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(result).toMatchObject({ synced: 0, waiting: 1 });
  });

  it('each user only sees and sends their own items', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    await box.add({ ...item('z', 1), userId: 'u2' });
    const { transport, sent } = scripted({});
    await box.sync('u1', transport);
    expect(sent).toEqual(['/x/a']);
    expect(await box.list('u2')).toHaveLength(1);
  });

  it('items left mid-sync by a crash are recovered', async () => {
    const storage = memoryStorage();
    const box = new Outbox(storage, { now });
    await box.add(item('a', 1));
    storage.data.set('u1', storage.data.get('u1')!.map((i) => ({ ...i, status: 'SYNCING' as const })));
    await box.recover('u1');
    expect((await box.list('u1'))[0]?.status).toBe('PENDING');
  });

  it('a concurrent add during sync is not lost', async () => {
    const box = new Outbox(memoryStorage(), { now });
    await box.add(item('a', 1));
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (started = r));
    let calls = 0;
    // Only the first request is slow; later ones answer straight away.
    const slow: Transport = () => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ ok: true });
      return new Promise((resolve) => {
        release = () => resolve({ ok: true });
        started();
      });
    };
    const syncing = box.sync('u1', slow);
    await inFlight;
    await box.add(item('b', 2));
    release();
    await syncing;
    // 'b' was added while 'a' was in flight: it was kept and then sent in the same run.
    expect(calls).toBe(2);
    expect(await box.list('u1')).toEqual([]);
  });

  it('backoff grows and is capped', () => {
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(2)).toBe(10000);
    expect(backoffMs(20)).toBe(5 * 60 * 1000);
  });
});
