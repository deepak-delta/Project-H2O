# Water Delivery

Mobile-first PWA for water-can delivery businesses: orders, deliveries, reusable-can tracking,
store credit, payments and cash flow. Product rules live in [CLAUDE.md](CLAUDE.md).

## Layout

```
apps/web         React + Vite PWA (Tailwind, TanStack Query, React Router)
apps/api         Fastify API + Prisma 7 (PostgreSQL)
packages/shared  Zod schemas, enums, money/phone helpers shared by both
scripts/         dev runner and Vercel build
```

## Local development

Requires Node 22.12+ (24 recommended) and a PostgreSQL database.

```bash
cp .env.example .env        # then fill in the database URLs
npm install
npm run db:migrate          # apply migrations to DATABASE_URL
npm run dev                 # API on :3001, app on http://localhost:5173
```

Face ID / fingerprint login works on `localhost` and on any HTTPS domain. The WebAuthn relying
party is the domain the app is served from, so no extra configuration is needed.

## Checks

```bash
npm run lint
npm run typecheck
npm test                    # API tests use TEST_DATABASE_URL and wipe it — never point it at real data
npm run build
npm run e2e                 # Playwright: builds the app, starts it, runs the browser tests
```

End-to-end tests run the production build (with its service worker) against a local database
named `wd_e2e` (override with `E2E_DATABASE_URL`; it must be local because it is wiped on every
run). They cover the supplier and store journeys at 360/375/390/430px, Face ID / fingerprint
login (Chromium's virtual authenticator), real offline mode, accessibility (axe, WCAG 2.1 AA)
and the production Content-Security-Policy.

## Deploying to Vercel

1. Create a Postgres database (Neon or Supabase). Use the **pooled** connection string for
   `DATABASE_URL` and a session-level one for `DIRECT_URL` (migrations).
   - Supabase: `DATABASE_URL` = transaction pooler (port 6543). For `DIRECT_URL` use the
     **session pooler** (same host, port 5432). The `db.<project>.supabase.co` host is IPv6-only and
     unreachable from many networks.
2. Import the repo in Vercel. `vercel.json` already sets the build command (`npm run build:vercel`),
   which writes `.vercel/output` (static PWA + one API function).
3. Set the environment variables: `DATABASE_URL`, `DIRECT_URL`, `PIN_PEPPER`, `RP_NAME`,
   `NODE_ENV=production`.
   - Generate `PIN_PEPPER` once with `openssl rand -base64 32`. **Never change it afterwards.**
     Every stored PIN depends on it, so rotating it would lock everyone out.
4. Production deployments run `prisma migrate deploy` automatically. Preview deployments don't,
   so give previews their own Neon branch (Neon's Vercel integration does this).
