// Produces .vercel/output (Vercel Build Output API v3):
//   static/            the PWA (apps/web/dist)
//   functions/api.func the bundled Fastify API
//   config.json        routing, caching and security headers
//
// On Vercel, set the project's Build Command to `npm run build:vercel`.
// Migrations run only for production deployments (VERCEL_ENV=production) using DIRECT_URL.
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
if (process.env.VERCEL_ENV === 'production') {
  run('npm run db:deploy -w @wd/api');
} else {
  console.log('[build] Skipping migrations (not a production deployment).');
}

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
};
writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));

console.log('[build] Vercel output ready at .vercel/output');
