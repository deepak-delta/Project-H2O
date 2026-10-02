import { execSync } from 'node:child_process';
import path from 'node:path';

/** Applies migrations to the dedicated test database before any suite runs. */
export default function setup(): void {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'));
  } catch {
    // CI provides real environment variables.
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run API tests');
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — tests wipe the database');
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
