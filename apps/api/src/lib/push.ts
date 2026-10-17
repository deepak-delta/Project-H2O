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

/**
 * `gone` = the subscription can never work again (unsubscribed, expired, or made with other
 * server keys): delete it; the app re-registers the phone the next time it opens.
 */
export type PushResult = 'ok' | 'gone' | 'error';

export interface PushOutcome {
  result: PushResult;
  /** HTTP status from the push service, for logs (never the endpoint or keys). */
  status?: number;
}

export interface PushSender {
  readonly publicKey: string;
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
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
          // "high": Android delivers it at once, even when the phone is idle (normal waits for Doze).
          { vapidDetails, TTL: 24 * 60 * 60, timeout: 8000, urgency: 'high' },
        );
        return { result: 'ok' };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: unsubscribed or expired. 403: made with different server keys.
        return { result: status === 404 || status === 410 || status === 403 ? 'gone' : 'error', status };
      }
    },
  };
}
