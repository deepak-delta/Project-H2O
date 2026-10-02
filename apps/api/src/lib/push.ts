import webpush from 'web-push';
import type { Env } from '../env';

export interface PushMessage {
  title: string;
  body: string;
  /** Path inside the app to open when the notification is tapped. */
  url: string;
  /** Same tag replaces an older notification instead of stacking (e.g. per order). */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `gone` = the browser unsubscribed; the subscription should be deleted. */
export type PushResult = 'ok' | 'gone' | 'error';

export interface PushSender {
  readonly publicKey: string;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

/** Real sender via the browsers' push services. Null when VAPID keys aren't configured. */
export function createWebPushSender(env: Env): PushSender | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const vapidDetails = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    async send(target, message) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          { vapidDetails, TTL: 24 * 60 * 60, timeout: 5000, urgency: 'normal' },
        );
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'error';
      }
    },
  };
}
