# QA environment

A separate test copy of the app: Vercel **preview** deployments connected to their own **QA database**, so testers can create businesses, orders and payments freely without touching real data.

| | Production | QA |
|---|---|---|
| Code | `deployment` branch | `qa` branch (any preview, see below) |
| Address | https://project-h2-o-ten.vercel.app | the `qa` branch's preview link |
| Database | Supabase project (live) | Supabase project **water-delivery-qa** |
| Vercel variables | Environment: **Production** | Environment: **Preview** |
| Migrations | run on every production build | run on every preview build, only when `APP_ENV=qa` |
| In the app | normal | a **"QA · test data"** tab at the top, "QA ·" in the window title |

Production is never touched: preview builds only migrate a database when `APP_ENV=qa` is set, and that variable exists only in the Preview environment.

## One-time setup (about 15 minutes)

### 1. Create the QA database (Supabase)

1. supabase.com → **New project** (the free plan allows two projects).
   - Name: `water-delivery-qa`
   - Region: **South Asia (Mumbai)**, same as production
   - Database password: a new one (not the production password); keep it in your password manager.
2. When it's ready: **Connect** (top of the project page) → **Connection string**. Copy two of them, with your password filled in (same setup as production):
   - **Transaction pooler** (host `…pooler.supabase.com`, port **6543**) → this is `DATABASE_URL`
   - **Session pooler** (same host, port **5432**) → this is `DIRECT_URL`

   Use the pooler ones, not "Direct connection": Vercel can't reach Supabase's direct address.

### 2. Make QA secrets (on this Mac)

Run each command once and keep the output for step 3. Use new values for QA, never production's.

```bash
openssl rand -base64 32
```
→ `PIN_PEPPER`

```bash
openssl rand -base64 32
```
→ `TOTP_ENCRYPTION_KEY`

```bash
npx web-push generate-vapid-keys
```
→ `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (optional: only needed to test notifications)

### 3. Add the Preview variables (Vercel)

vercel.com → project **project-h2-o** → **Settings → Environment Variables**. Add each one with **Environment: Preview only** (untick Production and Development):

| Name | Value |
|---|---|
| `APP_ENV` | `qa` |
| `DATABASE_URL` | QA transaction pooler string (port 6543) |
| `DIRECT_URL` | QA session pooler string (port 5432) |
| `NODE_ENV` | `production` |
| `PIN_PEPPER` | from step 2 |
| `TOTP_ENCRYPTION_KEY` | from step 2 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | from step 2 (optional) |

Not needed for QA: `CRON_SECRET` (the morning regular-delivery job only runs on production; in QA they are made when someone opens the app after 6 AM) and `FCM_SERVICE_ACCOUNT_JSON` (the Android app always points at production).

### 4. Let testers open preview links

Preview links currently ask for a **Vercel login** (Settings → **Deployment Protection** → Vercel Authentication). Choose one:

- **Simplest:** turn Vercel Authentication **off** (or set it to production only). The QA app still needs its own phone + PIN login, and holds only test data.
- **Keep it on:** for each preview, use **Share** on the deployment page to create a link that lets anyone in without a Vercel account.

### 5. Create the `qa` branch and deploy

```bash
git push origin HEAD:qa
```

Vercel builds a preview for it, runs the migrations on the QA database, and gives the branch a fixed link (Vercel → Deployments → the `qa` deployment → **Domains**, ending in `-git-qa-…vercel.app`). Share that link with testers; it always shows the latest `qa` code.

Check: open the link and you should see **"QA · test data"** at the top. Sign up as a new business; that business exists only in QA.

## Everyday flow

1. Push the change to `qa` → testers check it on the QA link.
2. When it's good, push the same commit to `deployment` → production.

Every other preview (e.g. `feature/push-notifications`) also uses the QA database and shows the QA tab.

## Looking at QA data

The admin dashboard can read QA instead of production:

```bash
DIRECT_URL="<QA session pooler string>" npm run admin
```

The read-only integrity check works the same way:

```bash
psql "<QA session pooler string>" -X -q -f apps/api/scripts/integrity-check.sql
```

## Resetting QA

To start QA from empty: in Supabase delete the `water-delivery-qa` project and create it again (step 1), update the two connection strings in Vercel's Preview variables (step 3), then redeploy the `qa` branch. Production is a separate project and is not affected.
