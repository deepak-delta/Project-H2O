import { z } from 'zod';

const endpoint = z
  .url({ protocol: /^https$/, message: 'Invalid push endpoint' })
  .max(1000);

/** Shape of `PushSubscription.toJSON()` from the browser. */
export const pushSubscribeSchema = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type PushSubscribeInput = z.input<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint });

export interface PushConfig {
  /** False when the server has no VAPID keys (web notifications switched off). */
  enabled: boolean;
  publicKey: string | null;
  /** False when the server has no Firebase key (native-app notifications switched off). */
  nativeEnabled: boolean;
}

/** Android notification channel the native app creates and the server sends to. */
export const ANDROID_PUSH_CHANNEL = 'orders';

/** A Firebase Cloud Messaging registration token from the native app. */
const nativeToken = z.string().trim().min(20).max(4096);

export const nativePushRegisterSchema = z.object({
  token: nativeToken,
  platform: z.enum(['ANDROID', 'IOS']),
  appVersion: z.string().trim().max(40).optional(),
});
export type NativePushRegisterInput = z.input<typeof nativePushRegisterSchema>;

export const nativePushUnregisterSchema = z.object({ token: nativeToken });
