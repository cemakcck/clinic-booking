# Deploying

The app is prepared for **Vercel** (Next.js hosting and the nightly cron) with **Supabase** Postgres. It is not deployed yet. Any host that runs Next.js 16 with a Postgres 17 database works the same way.

## 1. Database (Supabase)

1. Create a Supabase project. Only its Postgres database is used (no Supabase Auth, Storage or client SDK).
2. Copy two connection strings from *Connect*:
   - the **transaction pooler** (port `6543`) for the app on Vercel. Serverless functions open many short connections, and the pooler is built for that. The client turns prepared statements off automatically on port 6543 ([`src/lib/db/client.ts`](../src/lib/db/client.ts)). The advisory locks it takes are transaction-scoped, which a transaction pooler supports.
   - the **session pooler** (port `5432`) for one-off commands from your machine.
3. From your machine, with the session-pooler URL:

   ```bash
   DATABASE_URL='postgres://…:5432/postgres' npm run db:migrate
   DATABASE_URL='postgres://…:5432/postgres' DEMO_MODE=1 DEMO_PASSWORD='…' npm run demo:reset
   ```

   The migrations create the `btree_gist` extension the exclusion constraint needs. The production build prerenders public pages from the database, so it must be migrated and seeded **before** the first Vercel build.

## 2. Vercel

Import the repository and set these environment variables (Production):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URL (port 6543) |
| `BETTER_AUTH_SECRET` | A fresh random value, e.g. `openssl rand -base64 32`. Never the `.env.example` placeholder: a production deploy refuses to start with it |
| `BETTER_AUTH_URL`, `SITE_URL` | The public URL, e.g. `https://clinic.cemakcicek.com`. Otherwise manage links in emails point at localhost |
| `DEMO_MODE` | `1` for the public demo |
| `DEMO_PASSWORD` | Password of the seeded staff accounts (the same one used for `demo:reset`) |
| `CRON_SECRET` | A random value. Vercel sends it as a bearer token to the cron route |
| `IP_HASH_SECRET` | A random value. Without it, IP hashes use a public default key |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional. Without them, emails are logged. `EMAIL_FROM` must be on a domain verified in Resend |

`vercel.json` schedules `GET /api/cron/reset` at 00:00 UTC (03:00 Istanbul). The route returns 401 without the `CRON_SECRET` bearer token and 403 unless `DEMO_MODE=1`, so it can never wipe a non-demo database.

## 3. Checks after the first deploy

- Book an appointment, then press "Try it as Receptionist": the calendar should open on that day with the booking highlighted.
- The staff login page should show the one-click demo buttons.
- Rate limits key on the client IP from `X-Forwarded-For`. Vercel sets it; behind another proxy, make sure it does too, or every visitor shares one bucket.
