import { execSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../playwright.config';

/** Fresh schema and empty tables for every run. Refuses to touch anything but a local DB. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(E2E_DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('E2E_DATABASE_URL must be a local database — it is wiped on every run.');
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../apps/api'),
    env: { ...process.env, DIRECT_URL: E2E_DATABASE_URL, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) await client.query(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await client.end();
}
