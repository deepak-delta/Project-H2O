import { createSign } from 'node:crypto';
import { ANDROID_PUSH_CHANNEL } from '@wd/shared';
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

/** Sends to phones running the native app (Firebase Cloud Messaging registration tokens). */
export interface NativePushSender {
  send(token: string, message: PushMessage): Promise<PushOutcome>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** The Firebase service-account key, given as base64 (or raw JSON) in FCM_SERVICE_ACCOUNT_JSON. */
export function parseServiceAccount(value: string): ServiceAccount {
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  const parsed = JSON.parse(text) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON must be a Firebase service-account key (project_id, client_email, private_key)');
  }
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
}

const base64Url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Google access tokens last an hour; renew a little early. */
const ACCESS_TOKEN_REUSE_MS = 55 * 60 * 1000;

export interface FcmOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Real sender via the FCM HTTP v1 API. Signs its own OAuth token with the service-account key
 * (no Firebase SDK). Null when no key is configured: native push is then simply off.
 */
export function createFcmSender(env: Env, options: FcmOptions = {}): NativePushSender | null {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  const account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && now() < cached.until) return cached.token;
    const iat = Math.floor(now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({ iss: account.client_email, scope: FCM_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
    const res = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${base64Url(signature)}` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
    const { access_token: token } = (await res.json()) as { access_token: string };
    cached = { token, until: now() + ACCESS_TOKEN_REUSE_MS };
    return token;
  }

  return {
    async send(token, message) {
      let res: Response;
      try {
        res = await http(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: fcmMessage(token, message) }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        return { result: 'error' };
      }
      if (res.ok) return { result: 'ok' };
      if (res.status === 401) cached = null;
      const code = await fcmErrorCode(res);
      // UNREGISTERED: app uninstalled or token replaced. SENDER_ID_MISMATCH: made by another Firebase project.
      const gone = res.status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH';
      return { result: gone ? 'gone' : 'error', status: res.status };
    },
  };
}

function fcmMessage(token: string, message: PushMessage) {
  return {
    token,
    notification: { title: message.title, body: message.body },
    // The app opens `url` when the notification is tapped.
    data: { url: message.url, ...(message.tag ? { tag: message.tag } : {}) },
    android: {
      // Deliver at once even when the phone is idle (same as web push "high" urgency).
      priority: 'HIGH',
      ttl: '86400s',
      notification: { channel_id: ANDROID_PUSH_CHANNEL, ...(message.tag ? { tag: message.tag } : {}) },
    },
  };
}

async function fcmErrorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { details?: { errorCode?: string }[] } } | null;
  return body?.error?.details?.find((d) => d.errorCode)?.errorCode;
}
