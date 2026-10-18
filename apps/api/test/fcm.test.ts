import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { createFcmSender, parseServiceAccount, type NativePushSender, type PushMessage } from '../src/lib/push';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'water-test',
  client_email: 'push@water-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const keyBase64 = Buffer.from(JSON.stringify(account)).toString('base64');
const message: PushMessage = { title: 'Delivered: 10 cans', body: 'You owe ₹300', url: '/orders/abc', tag: 'order-abc' };

const bodyText = (init: RequestInit) =>
  init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === 'string' ? init.body : '';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake Google: hands out access tokens and answers FCM sends with whatever the test queues. */
function fakeGoogle(fcmReplies: (() => Response)[] = []) {
  const calls: Call[] = [];
  let issued = 0;
  const fetchImpl = ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      issued += 1;
      return Promise.resolve(Response.json({ access_token: `access-${issued}`, expires_in: 3599 }));
    }
    const reply = fcmReplies.shift();
    try {
      return Promise.resolve(reply ? reply() : Response.json({ name: 'projects/water-test/messages/1' }));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }) as typeof fetch;
  return { calls, fetchImpl, sends: () => calls.filter((c) => c.url.includes('fcm.googleapis.com')) };
}

function sender(fetchImpl: typeof fetch, now: () => number = Date.now): NativePushSender {
  const env = loadEnv({ DATABASE_URL: 'postgres://unused', FCM_SERVICE_ACCOUNT_JSON: keyBase64 });
  const s = createFcmSender(env, { fetch: fetchImpl, now });
  if (!s) throw new Error('expected a sender');
  return s;
}

const fcmError = (status: number, errorCode: string) =>
  () => Response.json({ error: { code: status, status: 'X', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] } }, { status });

describe('FCM sender', () => {
  it('is off without a key, and rejects a key that is not a service account', () => {
    expect(createFcmSender(loadEnv({ DATABASE_URL: 'postgres://unused' }))).toBeNull();
    expect(createFcmSender(loadEnv({ DATABASE_URL: 'postgres://unused', FCM_SERVICE_ACCOUNT_JSON: '' }))).toBeNull();
    expect(() => parseServiceAccount(Buffer.from('{"project_id":"x"}').toString('base64'))).toThrow(/service-account/);
    expect(parseServiceAccount(JSON.stringify(account)).project_id).toBe('water-test');
  });

  it('signs a valid Google token request and sends a high-priority Android notification', async () => {
    const google = fakeGoogle();
    expect(await sender(google.fetchImpl).send('device-token', message)).toEqual({ result: 'ok' });

    const tokenCall = google.calls[0]!;
    const assertion = new URLSearchParams(bodyText(tokenCall.init)).get('assertion')!;
    const [header, claims, signature] = assertion.split('.') as [string, string, string];
    const valid = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const [send] = google.sends();
    expect(send!.url).toBe('https://fcm.googleapis.com/v1/projects/water-test/messages:send');
    expect(new Headers(send!.init.headers).get('authorization')).toBe('Bearer access-1');
    expect(JSON.parse(bodyText(send!.init))).toEqual({
      message: {
        token: 'device-token',
        notification: { title: message.title, body: message.body },
        data: { url: '/orders/abc', tag: 'order-abc' },
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'orders', tag: 'order-abc' } },
      },
    });
  });

  it('reuses the access token for 55 minutes, then gets a new one', async () => {
    let clock = 1_000_000;
    const google = fakeGoogle();
    const s = sender(google.fetchImpl, () => clock);
    await s.send('a', message);
    clock += 54 * 60 * 1000;
    await s.send('b', message);
    clock += 2 * 60 * 1000;
    await s.send('c', message);
    expect(google.sends().map((c) => new Headers(c.init.headers).get('authorization'))).toEqual([
      'Bearer access-1',
      'Bearer access-1',
      'Bearer access-2',
    ]);
  });

  it('a rejected access token is renewed on the next send', async () => {
    const google = fakeGoogle([() => new Response('{}', { status: 401 })]);
    const s = sender(google.fetchImpl);
    expect(await s.send('a', message)).toEqual({ result: 'error', status: 401 });
    await s.send('a', message);
    expect(new Headers(google.sends()[1]!.init.headers).get('authorization')).toBe('Bearer access-2');
  });

  it('tells apart uninstalled apps (gone) from temporary failures (error)', async () => {
    const google = fakeGoogle([
      fcmError(404, 'UNREGISTERED'),
      fcmError(400, 'UNREGISTERED'),
      fcmError(403, 'SENDER_ID_MISMATCH'),
      fcmError(400, 'INVALID_ARGUMENT'),
      fcmError(503, 'UNAVAILABLE'),
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const s = sender(google.fetchImpl);
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await s.send('t', message)).result);
    expect(results).toEqual(['gone', 'gone', 'gone', 'error', 'error', 'error']);
  });

  it('a Google outage is an error, not a crash', async () => {
    const down = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch;
    expect(await sender(down).send('t', message)).toEqual({ result: 'error' });
  });
});
