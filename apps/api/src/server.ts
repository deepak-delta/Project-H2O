import { buildApp } from './app';
import { loadEnv } from './env';
import { createDb } from './lib/db';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ db, env, secureCookies: env.NODE_ENV === 'production' });

const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => db.$disconnect()).then(() => process.exit(0));
  });
}
