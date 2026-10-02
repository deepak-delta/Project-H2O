import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadEnv } from './env';
import { createDb } from './lib/db';

/**
 * Vercel function entry. The Fastify app is built once per warm instance and every request is
 * handed to its underlying Node server. The request URL keeps its original /api/... path.
 */
let appPromise: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const env = loadEnv();
  // Small pool per instance: Vercel scales out with instances, Neon's pooler handles the rest.
  const db = createDb(env.DATABASE_URL, { maxConnections: 3 });
  const app = await buildApp({ db, env, secureCookies: true });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= init().catch((err: unknown) => {
    appPromise = null; // let the next request retry a failed cold start
    throw err;
  });
  const app = await appPromise;
  app.server.emit('request', req, res);
}
