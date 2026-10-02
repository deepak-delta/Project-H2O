import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import { createDb, type Db } from '../src/lib/db';
import type { PushSender } from '../src/lib/push';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'));
} catch {
  // CI provides real environment variables.
}

export const ORIGIN = 'http://localhost:3001';

export interface TestContext {
  app: FastifyInstance;
  db: Db;
}

export async function createTestContext(
  overrides: Record<string, string> = {},
  options: { pushSender?: PushSender | null } = {},
): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: '100000', ...overrides });
  const db = createDb(url, { maxConnections: 3 });
  // Push is off in tests unless a test supplies its own (fake) sender.
  const app = await buildApp({ db, env, secureCookies: false, pushSender: options.pushSender ?? null });
  return { app, db };
}

export async function closeTestContext({ app, db }: TestContext): Promise<void> {
  await app.close();
  await db.$disconnect();
}

/** Wipes every table except Prisma's migration history. */
export async function resetDb(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** A tiny client that keeps the session cookie like a browser would. */
export class Client {
  cookie: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        host: 'localhost:3001',
        origin: ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const setCookie = res.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) {
      const [pair] = first.split(';');
      this.cookie = pair && !pair.endsWith('=') ? pair : null;
    }
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {});
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body ?? {});
  delete = (url: string) => this.request('DELETE', url);
}

let phoneCounter = 0;
/** Unique valid Indian mobile number per call. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `98${String(Date.now() % 1e6).padStart(6, '0')}${String(phoneCounter % 100).padStart(2, '0')}`;
}

export async function signupSupplier(
  app: FastifyInstance,
  overrides: Partial<{ businessName: string; ownerName: string; phone: string; pin: string }> = {},
) {
  const client = new Client(app);
  const input = {
    businessName: 'Aqua Fresh',
    ownerName: 'Ravi Kumar',
    phone: nextPhone(),
    pin: '482913',
    ...overrides,
  };
  const res = await client.post('/api/auth/signup', input);
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  return { client, input, me: res.json<{ user: { id: string; supplierId: string } }>() };
}
