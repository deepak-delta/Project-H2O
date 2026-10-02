import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import { createDb } from '../src/lib/db';
import { lockUntilFor } from '../src/modules/auth/throttle';
import { Client, closeTestContext, createTestContext, resetDb, signupSupplier, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => closeTestContext(ctx));
beforeEach(async () => resetDb(ctx.db));

describe('signup', () => {
  it('creates a supplier business and starts a session', async () => {
    const { client, me } = await signupSupplier(ctx.app, { phone: '98765 43210' });
    expect(me.user).toMatchObject({ role: 'SUPPLIER', phone: '+919876543210' });

    const res = await client.get('/api/auth/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      business: { businessName: 'Aqua Fresh', currency: 'INR', timezone: 'Asia/Kolkata' },
      hasPasskey: false,
    });
  });

  it('never stores the PIN in plain text', async () => {
    const { me } = await signupSupplier(ctx.app, { pin: '135790' });
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: me.user.id } });
    expect(user.pinHash).not.toContain('135790');
    expect(user.pinHash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a duplicate phone with a friendly message', async () => {
    await signupSupplier(ctx.app, { phone: '9000000001' });
    const res = await new Client(ctx.app).post('/api/auth/signup', {
      businessName: 'Other',
      ownerName: 'Other Owner',
      phone: '+91 90000 00001',
      pin: '111222',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/already registered/);
  });

  it('validates input with field errors', async () => {
    const res = await new Client(ctx.app).post('/api/auth/signup', {
      businessName: '',
      ownerName: 'A',
      phone: '123',
      pin: '12ab',
    });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fields)).toEqual(
      expect.arrayContaining(['businessName', 'ownerName', 'phone', 'pin']),
    );
  });
});

describe('PIN login', () => {
  it('logs in with the right PIN and out again', async () => {
    const { input } = await signupSupplier(ctx.app);
    const client = new Client(ctx.app);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);

    const login = await client.post('/api/auth/login', { phone: input.phone, pin: input.pin });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toMatch(/HttpOnly/);
    expect(login.headers['set-cookie']).toMatch(/SameSite=Lax/);
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);

    const sessionCookie = client.cookie;
    expect((await client.post('/api/auth/logout')).statusCode).toBe(204);
    // The old cookie is revoked server-side, not just cleared in the browser.
    client.cookie = sessionCookie;
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('uses one generic message for unknown phone and wrong PIN', async () => {
    const { input } = await signupSupplier(ctx.app);
    const wrongPin = await new Client(ctx.app).post('/api/auth/login', { phone: input.phone, pin: '000000' });
    const unknown = await new Client(ctx.app).post('/api/auth/login', { phone: '9123456789', pin: '000000' });
    expect(wrongPin.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongPin.json().error.message).toBe(unknown.json().error.message);
  });

  it('locks the account after 5 wrong PINs, even for the right PIN', async () => {
    const { input } = await signupSupplier(ctx.app);
    const client = new Client(ctx.app);
    for (let i = 0; i < 5; i++) {
      expect((await client.post('/api/auth/login', { phone: input.phone, pin: '000000' })).statusCode).toBe(401);
    }
    const res = await client.post('/api/auth/login', { phone: input.phone, pin: input.pin });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.message).toMatch(/Try again in \d+ minutes?/);
  });

  it('lockout doubles and is capped at 24 hours', () => {
    const now = 0;
    expect(lockUntilFor(4, now)).toBeNull();
    expect(lockUntilFor(5, now)?.getTime()).toBe(15 * 60 * 1000);
    expect(lockUntilFor(6, now)?.getTime()).toBe(30 * 60 * 1000);
    expect(lockUntilFor(50, now)?.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('changing the PIN signs out other devices', async () => {
    const { client: phoneA, input } = await signupSupplier(ctx.app);
    const phoneB = new Client(ctx.app);
    await phoneB.post('/api/auth/login', { phone: input.phone, pin: input.pin });

    const change = await phoneA.post('/api/auth/pin', { currentPin: input.pin, newPin: '246810' });
    expect(change.statusCode).toBe(204);
    expect((await phoneA.get('/api/auth/me')).statusCode).toBe(200);
    expect((await phoneB.get('/api/auth/me')).statusCode).toBe(401);

    const relogin = await new Client(ctx.app).post('/api/auth/login', { phone: input.phone, pin: '246810' });
    expect(relogin.statusCode).toBe(200);
  });
});

describe('request security', () => {
  it('blocks state-changing requests from another origin (CSRF)', async () => {
    const { client } = await signupSupplier(ctx.app);
    const res = await client.request('POST', '/api/auth/logout', {}, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });

  it('blocks state-changing requests with no origin at all', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: 'localhost:3001' },
      payload: { phone: '9876543210', pin: '123456' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('marks API responses as non-cacheable', async () => {
    const res = await new Client(ctx.app).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns friendly JSON for unknown routes and bad JSON', async () => {
    const missing = await new Client(ctx.app).get('/api/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');

    const bad = await new Client(ctx.app).request('POST', '/api/auth/login', undefined, {
      'content-type': 'application/json',
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
  });
});

describe('passkeys', () => {
  it('issues registration options only to a logged-in user', async () => {
    expect((await new Client(ctx.app).post('/api/auth/passkeys/register/options')).statusCode).toBe(401);

    const { client } = await signupSupplier(ctx.app);
    const res = await client.post('/api/auth/passkeys/register/options');
    expect(res.statusCode).toBe(200);
    const options = res.json();
    expect(options.rp).toMatchObject({ id: 'localhost', name: 'Water Delivery' });
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'platform',
      userVerification: 'required',
    });
  });

  it('rejects an expired or unknown challenge', async () => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: 'not-a-real-challenge', origin: 'http://localhost:3001' }),
    ).toString('base64url');
    const res = await new Client(ctx.app).post('/api/auth/passkeys/login/verify', {
      response: {
        id: 'abc',
        rawId: 'abc',
        type: 'public-key',
        response: { clientDataJSON, authenticatorData: 'x', signature: 'x' },
        clientExtensionResults: {},
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/expired/);
  });
});

describe('rate limiting', () => {
  it('caps requests per IP with a friendly 429', async () => {
    const limited = await createTestContext({ RATE_LIMIT_PER_MINUTE: '10' });
    try {
      const client = new Client(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await client.get('/api/health')).statusCode);
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      const blocked = await client.get('/api/health');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/wait a minute/) });
      expect(blocked.headers['retry-after']).toBeDefined();
    } finally {
      await closeTestContext(limited);
    }
  });
});

describe('session check', () => {
  it('answers 200 with null when signed out, and the user when signed in', async () => {
    const anon = await new Client(ctx.app).get('/api/auth/session');
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({ me: null });
    const { client } = await signupSupplier(ctx.app);
    const res = await client.get('/api/auth/session');
    expect(res.json().me).toMatchObject({ user: { role: 'SUPPLIER' } });
  });
});

describe('production cookie', () => {
  it('is __Host- prefixed, Secure, HttpOnly, SameSite=Lax and site-wide', async () => {
    const url = process.env.TEST_DATABASE_URL ?? '';
    const env = loadEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, LOG_LEVEL: 'silent' });
    const db = createDb(url, { maxConnections: 2 });
    const app = await buildApp({ db, env, secureCookies: true });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        headers: { host: 'localhost:3001', origin: 'http://localhost:3001' },
        payload: { businessName: 'Secure Co', ownerName: 'Asha', phone: '9123400001', pin: '135790' },
      });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^__Host-wd_session=/);
      expect(cookie).toMatch(/; Secure/);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Lax/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).not.toMatch(/Domain=/);
    } finally {
      await app.close();
      await db.$disconnect();
    }
  });
});
