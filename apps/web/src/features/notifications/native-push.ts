import type { PluginListenerHandle } from '@capacitor/core';
import { ANDROID_PUSH_CHANNEL, type PushConfig } from '@wd/shared';
import { nativePlatform } from '../../native/platform';
import { api } from '../../services/api';
import { deviceStorage } from '../../utils/storage';
import type { PushState } from './push';

/**
 * Notifications in the native Android app, through Firebase Cloud Messaging. Same states and
 * functions as web push (push.ts routes here inside the app), so the screens don't change.
 */

/** This phone's FCM token while notifications are on; absent when turned off. */
const TOKEN_KEY = 'nativePushToken';
const REGISTER_TIMEOUT_MS = 15_000;

/**
 * Returns the module, never the plugin itself: a Capacitor plugin is a proxy that answers every
 * property, so resolving a promise with it calls its `.then()` and fails on the phone.
 */
const pushModule = () => import('@capacitor/push-notifications');

export async function nativePushState(): Promise<PushState> {
  const config = await api.get<PushConfig>('/push/config');
  if (!config.nativeEnabled) return 'server-off';
  const { PushNotifications } = await pushModule();
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === 'denied') return 'blocked';
  return receive === 'granted' && deviceStorage.get(TOKEN_KEY) ? 'on' : 'off';
}

/** Asks permission (Android 13+ shows the system prompt) and registers this phone. */
export async function enableNativePush(): Promise<PushState> {
  const { PushNotifications: push } = await pushModule();
  const { receive } = await push.requestPermissions();
  if (receive === 'denied') return 'blocked';
  if (receive !== 'granted') return 'off';
  await push.createChannel({
    id: ANDROID_PUSH_CHANNEL,
    name: 'Orders & payments',
    description: 'New orders, deliveries, payments and reminders',
    importance: 5,
    visibility: 1,
    vibration: true,
  });
  await register(await currentToken());
  return 'on';
}

/** On app open: Firebase may have issued a new token; make sure the server has this one. */
export async function syncNativePush(): Promise<void> {
  if (!deviceStorage.get(TOKEN_KEY)) return;
  const { PushNotifications } = await pushModule();
  const { receive } = await PushNotifications.checkPermissions();
  if (receive !== 'granted') return;
  await register(await currentToken());
}

/** Turn off (and on logout, so a shared phone goes quiet). */
export async function disableNativePush(): Promise<void> {
  const token = deviceStorage.get(TOKEN_KEY);
  deviceStorage.remove(TOKEN_KEY);
  if (token) await api.post('/push/native/unregister', { token }).catch(() => undefined);
  // Firebase forgets the token too; turning on again gets a fresh one.
  const { PushNotifications } = await pushModule();
  await PushNotifications.unregister().catch(() => undefined);
}

async function register(token: string): Promise<void> {
  const { App } = await import('@capacitor/app');
  const { build } = await App.getInfo();
  await api.post('/push/native/register', {
    token,
    platform: nativePlatform() === 'ios' ? 'IOS' : 'ANDROID',
    appVersion: build,
  });
  deviceStorage.set(TOKEN_KEY, token);
}

/** register() answers through events; wrap them into one promise. */
async function currentToken(): Promise<string> {
  const { PushNotifications: push } = await pushModule();
  const handles: Promise<PluginListenerHandle>[] = [];
  const cleanup = () => handles.forEach((h) => void h.then((l) => l.remove()));
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Notifications could not be set up. Check the internet and try again.')), REGISTER_TIMEOUT_MS);
      handles.push(
        push.addListener('registration', ({ value }) => {
          window.clearTimeout(timer);
          resolve(value);
        }),
        push.addListener('registrationError', () => {
          window.clearTimeout(timer);
          reject(new Error('Notifications could not be set up on this phone. Please try again.'));
        }),
      );
      push.register().catch(reject);
    });
  } finally {
    cleanup();
  }
}
