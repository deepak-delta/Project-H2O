import type { PushConfig } from '@wd/shared';
import { isInstalled, isIos } from '../../pwa/platform';
import { api } from '../../services/api';

/**
 * What this device can do:
 *  - unsupported: no push in this browser (or the app's offline worker isn't running)
 *  - needs-install: iPhone/iPad — web push only works once added to the Home Screen
 *  - server-off: the server has no push keys configured
 *  - blocked: the user said no in the browser's permission prompt
 *  - off / on
 */
export type PushState = 'unsupported' | 'needs-install' | 'server-off' | 'blocked' | 'off' | 'on';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // No worker in local development (only the production build installs one).
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * What a tap on "Turn on" needs, looked up while the screen loads. Safari only lets subscribe()
 * prompt while it still counts as part of the tap, so no network wait may sit between the two.
 */
let prepared: { reg: ServiceWorkerRegistration; publicKey: string } | null = null;

export async function getPushState(): Promise<PushState> {
  prepared = null;
  if (isIos() && !isInstalled()) return 'needs-install';
  if (!supported()) return 'unsupported';
  const config = await api.get<PushConfig>('/push/config');
  if (!config.enabled || !config.publicKey) return 'server-off';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  if (!reg) return 'unsupported';
  prepared = { reg, publicKey: config.publicKey };
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Asks permission and registers this device. Call straight from the tap, after getPushState():
 * subscribe() itself shows the permission prompt (Safari and Chrome alike).
 */
export async function enablePush(): Promise<PushState> {
  if (!prepared) return getPushState();
  const { reg, publicKey } = prepared;
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      if (Notification.permission === 'denied') return 'blocked';
      if (Notification.permission === 'default') return 'off';
    }
    throw err;
  }
  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

let syncing: Promise<void> | null = null;

/**
 * Run when the app opens. If notifications are on for this phone, make sure the server still
 * has it, for the person logged in now, and with the server's current keys. The server drops
 * subscriptions the push service rejects, and a phone can be shared; without this the screen
 * says "On" while nothing arrives.
 */
export function syncPush(): Promise<void> {
  syncing ??= resync()
    .catch(() => undefined)
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function resync(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  if (isIos() && !isInstalled()) return;
  const reg = await registration();
  let sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return;
  const config = await api.get<PushConfig>('/push/config');
  if (!config.enabled || !config.publicKey) return;
  const key = keyToBytes(config.publicKey);
  const current = sub.options.applicationServerKey;
  if (!current || !sameBytes(new Uint8Array(current), key)) {
    // Made with old server keys: it can never work again. Permission is already granted, so a
    // fresh subscription needs no prompt.
    await sub.unsubscribe().catch(() => undefined);
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await api.post('/push/subscribe', sub.toJSON());
}

/** Stops notifications on this device (also used on logout so a shared phone goes quiet). */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
