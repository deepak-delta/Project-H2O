import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Capacitor plugin on the phone is a proxy that answers every property, including `then`,
 * which throws "not implemented". This fake does the same, so code that resolves a promise
 * with the plugin itself fails here as it did on the phone.
 */
const calls: string[] = [];
const listeners = new Map<string, (data: unknown) => void>();
let permission = 'prompt';
const methods: Record<string, (...args: never[]) => Promise<unknown>> = {
  checkPermissions: () => Promise.resolve({ receive: permission }),
  requestPermissions: () => {
    permission = 'granted';
    return Promise.resolve({ receive: permission });
  },
  createChannel: () => Promise.resolve(),
  register: () => {
    queueMicrotask(() => listeners.get('registration')?.({ value: 'fcm-token-from-firebase' }));
    return Promise.resolve();
  },
  unregister: () => Promise.resolve(),
  addListener: ((event: string, cb: (data: unknown) => void) => {
    listeners.set(event, cb);
    return Promise.resolve({ remove: () => Promise.resolve(listeners.delete(event)) });
  }),
};
const plugin = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === 'then') throw new Error('"PushNotifications.then()" is not implemented on android');
      calls.push(prop);
      return methods[prop];
    },
  },
);

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: () => Promise.resolve({ build: '3' }) } }));
const posts: { path: string; body: unknown }[] = [];
vi.mock('../../services/api', () => ({
  api: {
    get: () => Promise.resolve({ enabled: false, publicKey: null, nativeEnabled: true }),
    post: (path: string, body: unknown) => {
      posts.push({ path, body });
      return Promise.resolve();
    },
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal('window', {
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
});

const { disableNativePush, enableNativePush, nativePushState, syncNativePush } = await import('./native-push');

beforeEach(() => {
  calls.length = 0;
  posts.length = 0;
  permission = 'prompt';
  storage.clear();
});

describe('native push (Android app)', () => {
  it('turns on: asks permission, creates the channel and registers the Firebase token', async () => {
    expect(await nativePushState()).toBe('off');
    expect(await enableNativePush()).toBe('on');
    expect(calls).toEqual(expect.arrayContaining(['requestPermissions', 'createChannel', 'register']));
    expect(posts).toEqual([
      { path: '/push/native/register', body: { token: 'fcm-token-from-firebase', platform: 'ANDROID', appVersion: '3' } },
    ]);
    expect(await nativePushState()).toBe('on');
  });

  it('re-registers on app open only while turned on', async () => {
    await syncNativePush();
    expect(posts).toEqual([]);
    await enableNativePush();
    posts.length = 0;
    await syncNativePush();
    expect(posts.map((p) => p.path)).toEqual(['/push/native/register']);
  });

  it('turns off: the server forgets this phone', async () => {
    await enableNativePush();
    posts.length = 0;
    await disableNativePush();
    expect(posts).toEqual([{ path: '/push/native/unregister', body: { token: 'fcm-token-from-firebase' } }]);
    expect(await nativePushState()).toBe('off');
  });

  it('blocked in phone settings', async () => {
    permission = 'denied';
    expect(await nativePushState()).toBe('blocked');
  });
});
