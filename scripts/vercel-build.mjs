// Produces .vercel/output (Vercel Build Output API v3):
//   static/            the PWA (apps/web/dist)
//   functions/api.func the bundled Fastify API
//   config.json        routing, caching and security headers
//
// On Vercel, set the project's Build Command to `npm run build:vercel`.
// Migrations run (using DIRECT_URL) for production deployments, and for preview deployments
// only when the Preview environment is the QA one (APP_ENV=qa, its own database). Without
// APP_ENV=qa a preview never touches a database schema.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { securityHeaders } from './security-headers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.vercel/output');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });

// 1. Database client + migrations
run('npm run db:generate -w @wd/api');
const isQa = process.env.VERCEL_ENV === 'preview' && process.env.APP_ENV === 'qa';
if (process.env.VERCEL_ENV === 'production' || isQa) {
  console.log(`[build] Migrating the ${isQa ? 'QA' : 'production'} database.`);
  run('npm run db:deploy -w @wd/api');
} else {
  console.log('[build] Skipping migrations (not production, and not the QA preview).');
}
// The web app shows a "QA" badge when built for the QA environment.
if (isQa) process.env.VITE_APP_ENV = 'qa';
// Vercel Web Analytics and Speed Insights: only in builds that Vercel serves (their scripts
// live at /_vercel/… on the deployment itself, not on local or test servers).
process.env.VITE_VERCEL_INSIGHTS = '1';

// 2. Static PWA
run('npm run build -w @wd/web');
cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

// 3. API function — one self-contained ESM bundle
const funcDir = path.join(out, 'functions/api.func');
mkdirSync(funcDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps/api/src/vercel.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  keepNames: true,
  sourcemap: false,
  legalComments: 'none',
  // pg optionally requires a native addon we don't use.
  external: ['pg-native'],
  // Some CommonJS deps call require(); give the ESM bundle a real one.
  banner: {
    js: "import { createRequire as __wdCreateRequire } from 'node:module'; const require = __wdCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 30,
      // Run next to the database (Supabase ap-south-1, Mumbai). Every API request makes several
      // database round trips; from Vercel's default region (Washington, iad1) each one crossed
      // the world. Override with FUNCTION_REGION if the database moves.
      regions: [process.env.FUNCTION_REGION ?? 'bom1'],
    },
    null,
    2,
  ),
);
writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));

// 4. Routing + headers (see security-headers.mjs)
const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: securityHeaders, continue: true },
    // Hashed build assets never change.
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    // The service worker and app shell must always be revalidated so updates are picked up.
    {
      src: '^/(sw\\.js|workbox-[^/]+\\.js|index\\.html|manifest\\.webmanifest|registerSW\\.js)?$',
      headers: { 'Cache-Control': 'no-cache' },
      continue: true,
    },
    { src: '^/api(/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    // SPA fallback for client-side routes.
    { src: '^/(.*)$', dest: '/index.html' },
  ],
  // 00:30 UTC = 6:00 AM IST: today's regular deliveries become orders (needs CRON_SECRET).
  crons: [{ path: '/api/cron/schedules', schedule: '30 0 * * *' }],
};
writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));

console.log('[build] Vercel output ready at .vercel/output');
