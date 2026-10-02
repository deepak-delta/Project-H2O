import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env on its own; use Node's built-in loader for local work.
// On Vercel the variables come from the project environment.
const rootEnv = path.resolve(import.meta.dirname, '../../.env');
try {
  process.loadEnvFile(rootEnv);
} catch {
  // No .env file — rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection on Neon.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
