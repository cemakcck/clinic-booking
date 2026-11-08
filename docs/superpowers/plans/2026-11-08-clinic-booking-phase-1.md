# Clinic Booking System: Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of the fictional Istanbul dental clinic demo (spec §2 "Goals, phase 1"): public EN/TR site, booking with holds and a manage link, confirmation emails, the staff calendar for receptionist/dentist/admin, the call-back inbox, demo mode with guards, and the nightly reset. All of it runs locally.

**Architecture:**
- **Stack:** one Next.js 16 App Router app, with every page under `src/app/[locale]/` (public site and `/staff`) and a few `src/app/api/*` routes.
- **Domain logic:** lives in plain TypeScript modules under `src/lib/` that take a `Db` (or a transaction) and an injectable `now`. Pages and server actions are thin wrappers around them.
- **Time-entry model:** appointments, holds and staff blocks are rows of a single `entries` table. A PostgreSQL `EXCLUDE USING gist (dentist_id WITH =, during WITH &&) WHERE (active)` constraint guarantees that a dentist's active entries never overlap. App code checks first only to give friendly messages, and maps exclusion violations (SQLSTATE `23P01`) to `slot_taken`.

**Tech Stack:** Next.js 16.4.5, React 19.3, TypeScript strict, Tailwind CSS 4 (CSS-first `@theme`), next-intl 4, Zod 4, PostgreSQL 17 (Docker) + Drizzle ORM 0.45 + drizzle-kit + `postgres` (postgres-js) driver, Better Auth 1.x (Drizzle adapter, email+password), @dnd-kit/core 6, @radix-ui/react-dialog, Resend, Vitest 5 (+ Testing Library, jsdom), Playwright 1.65 + @axe-core/playwright, tsx, Node 22, npm.

**Spec:** `docs/superpowers/specs/2026-11-08-clinic-booking-design.md`. Phase 2 (reminders, simulated SMS log, dashboard) gets its own plan after this one ships.

## Global Constraints

- Repo at `~/Personal/clinic-booking`. Commits use the identity from the `~/Personal/` includeIf rule (`Cem Akçiçek <160328866+cemakcck@users.noreply.github.com>`). Never use the work account or work email. Don't push; there is no remote yet.
- Use the portfolio's versions: Next 16.4.5, React 19.3.0, Tailwind 4, next-intl ^4.14, Zod ^4.6, drizzle-orm ^0.45, drizzle-kit ^0.31, Vitest ^5.1, Playwright 1.65, `@types/node@22`. Next 16 uses `src/proxy.ts` (not middleware), and `cacheComponents` stays off.
- **No prices anywhere.** Wherever a price would appear, show "Pricing: contact the clinic for a quote" with **Call** and **Request a call back**.
- Time zone: all clinic times are Europe/Istanbul (UTC+3, no DST). Store as `timestamptz`, display via `Intl` with `timeZone: "Europe/Istanbul"`, and never rely on the process or browser TZ. Vitest sets `process.env.TZ = "America/New_York"` in setup so TZ bugs fail.
- Locales: `en` and `tr`, `localePrefix: "always"`. Every user-visible string lives in `messages/en.json` and `messages/tr.json` with identical key sets (a test enforces this). Emails are in the patient's locale.
- Palette (direction A): white `#ffffff`, soft `#eef6f4`, ink `#10302e`, mute `#5d7472`, brand `#0f5e5a`, brand-2 `#1f8a7f`, accent `#7fd1c1`, line `#d9e6e3`. Status colours: booked `#3d6fd8`, arrived `#2e9d5b`, no-show `#d0463b`, mine `#e0a412`, blocked grey hatch. Font: Plus Jakarta Sans (`next/font/google`). Radius 14px. Light mode only. WCAG AA.
- Booking constants (in `src/config/booking.ts`, the single source):
  - `SLOT_STEP_MIN=15`, `HOLD_MINUTES=5`
  - `PUBLIC_MIN_LEAD_MIN=120`, `PUBLIC_HORIZON_DAYS=60`
  - `STAFF_MIN_LEAD_MIN=-60`, `STAFF_HORIZON_DAYS=365`
  - `MANAGE_CUTOFF_HOURS=24`
  - `DEMO_FLOOR={ minSlots: 4, days: 3, probeDurationMin: 30 }`
  - `EMAIL_CAP_PER_ADDRESS_PER_DAY=5`, `EMAIL_CAP_PER_IP_PER_DAY=10`
  - `RATE={ hold: [20, 3_600_000], confirm: [10, 3_600_000], callback: [5, 3_600_000] }`
- Privacy: store only name, phone, email, locale, and the appointment. IPs are stored only as HMAC hashes. Seeded patients use `@example.com` addresses and are never emailed.
- The app must run with no `RESEND_API_KEY` (emails are logged, not sent). Secrets go in `.env.local`, and `.env.example` is committed.
- Demo mode = `DEMO_MODE=1`. Admin saving is disabled in demo, the capacity floor applies, and staff-triggered emails are logged instead of sent.
- Typecheck (`npm run typecheck`) and lint (`npm run lint`) must pass before every commit. Don't leave dev servers running in the repo folder. Kill processes by PID, never with `pkill -f`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Abandoned hold:** a visitor reaches step 4 and leaves. Five minutes later another visitor must see that slot again and be able to book it. The expired hold must neither block the slot nor trip the constraint. Tests: Task 4 `ignores expired holds`, Task 5 `placeHold succeeds over an expired hold`.
2. **Hold expires mid-form:** the patient takes 7 minutes to type their details. Confirm re-acquires the slot atomically if it's still free; otherwise it returns `hold_expired` and the UI sends them back to step 3 with a friendly message. Test: Task 5 `confirm re-acquires an expired but still-free hold`.
3. **Double-submitted confirm:** a double-click or a retried request must produce exactly one appointment, and the second call returns the same appointment. Test: Task 5 `confirm is idempotent per hold`.
4. **Visitor or server outside Istanbul:** a visitor in London, or a server running in UTC, must see the same Istanbul clock times on slots, emails and the .ics file. Tests: Vitest runs with `TZ=America/New_York` (setup), and the Task 10 e2e uses `timezoneId: "Europe/London"`.
5. **Messy patient input:** Turkish characters in names, phones as `+90 532 111 22 33`, `0532 111 2233` or `5321112233`, and CR/LF in a name. Phones normalize to E.164, names survive intact, and no header injection is possible in email subjects. Tests: Task 5 `normalizePhone`, Task 6 `subject strips CR/LF`.

---

## File map (what lives where)

```
docker-compose.yml                  Postgres 17 on :5433
drizzle.config.ts, drizzle/         migrations (0000 generated + 0001 custom SQL: btree_gist, exclusion, checks)
src/config/booking.ts               constants above
src/config/clinic.ts                clinic identity: name, fictional address/phone/email, map text
src/content/clinic-data.ts          seed content: dentists, treatments, hours, bios (EN/TR)
src/i18n/{routing,request,navigation}.ts, src/proxy.ts
src/lib/time.ts                     Istanbul date/time helpers
src/lib/slots/engine.ts             pure slot computation + effective hours + pickAnyDentist
src/lib/db/{client,schema,range}.ts Drizzle client, schema, tstzrange custom type
src/lib/booking/errors.ts           BookingError + codes
src/lib/booking/availability.ts     DB-backed availability (day slots, day strip, next free, public count)
src/lib/booking/entries.ts          insertEntry/updateEntryRange (expired-hold sweep + 23P01 mapping)
src/lib/booking/holds.ts            placeHold, confirmBooking
src/lib/booking/manage.ts           manage-token lookup, cancel/reschedule by patient
src/lib/booking/patients.ts         normalizePhone, upsertPatient
src/lib/security/{hash-ip,client-ip,rate-limit,tokens}.ts
src/lib/email/{send,templates,ics}.ts
src/lib/auth/{auth,actor,permissions}.ts
src/lib/staff/{appointments,blocks,requests,patients,settings,outside-hours}.ts
src/lib/demo/{mode,seed,reset,floor,mine}.ts
src/app/[locale]/(public)/...       public pages, book/, booking/[token]
src/app/[locale]/staff/...          login, (app)/calendar, today, requests, patients, settings/*
src/app/api/{auth/[...all],ics/[token],cron/reset}/route.ts
src/components/{site,booking,calendar,staff,ui}/...
scripts/{seed,reset-demo,create-user}.ts
tests/unit, tests/integration (real Postgres), tests/e2e
```

---

### Task 1: Scaffold, design tokens, i18n, test harnesses, Postgres container

**Files:**
- Create: the Next app (create-next-app refuses a non-empty folder, so scaffold in `~/Personal/clinic-booking-scaffold`, move the files into `~/Personal/clinic-booking`, and delete the scaffold folder), `docker-compose.yml`, `.env.example`, `src/app/globals.css` (`@theme` tokens), `src/app/[locale]/layout.tsx`, `src/app/[locale]/(public)/page.tsx` (placeholder heading), `src/app/[locale]/not-found.tsx`, `src/i18n/*`, `src/proxy.ts`, `messages/{en,tr}.json`, `vitest.config.ts`, `tests/setup.ts`, `playwright.config.ts`, `next.config.ts`, `eslint.config.mjs`
- Test: `tests/unit/tokens.test.ts`, `tests/unit/messages.test.ts`, `tests/e2e/i18n.spec.ts`

**Interfaces:**
- Produces: `routing` with locales `["en","tr"]` and `type Locale`. `Link`, `redirect` and `useRouter` from `@/i18n/navigation`. npm scripts `dev, build, start, lint, typecheck, test, test:unit, test:integration, test:e2e, db:up, db:generate, db:migrate, db:seed, demo:reset, user:create`. Vitest projects `unit` (jsdom, `tests/unit/**`) and `integration` (node, `tests/integration/**`, `fileParallelism: false`).

- [ ] **Step 1: Init the repo and commit the design first.** Run `git init` in `~/Personal/clinic-booking`, check `git config user.email` prints the noreply address, add `.gitignore` (Next defaults + `.env*` + `!.env.example` + `.superpowers/` + `test-results/` + `playwright-report/` + `.next-live/`), then commit `docs/` alone: "docs: clinic booking design and mockups".
- [ ] **Step 2: Scaffold.** Use create-next-app 16.4.5 (TS, Tailwind, ESLint, App Router, `src/`, no import alias change), then install everything in the Tech Stack line, copying the portfolio's `next.config.ts` pattern (distDir from `NEXT_DIST_DIR`, the next-intl plugin, the turbopack CSS loader; drop the libsql external and add `serverExternalPackages: ["postgres"]`). `docker-compose.yml`: service `db`, image `postgres:17-alpine`, `POSTGRES_USER=clinic`, `POSTGRES_PASSWORD=clinic`, `POSTGRES_DB=clinic`, port `5433:5432`, healthcheck `pg_isready`, named volume. `.env.example` keys: `DATABASE_URL=postgres://clinic:clinic@localhost:5433/clinic`, `TEST_DATABASE_URL=postgres://clinic:clinic@localhost:5433/clinic_test`, `BETTER_AUTH_SECRET=`, `BETTER_AUTH_URL=http://localhost:3000`, `DEMO_MODE=1`, `DEMO_PASSWORD=demo-password`, `RESEND_API_KEY=`, `EMAIL_FROM=`, `IP_HASH_SECRET=`, `CRON_SECRET=`, `SITE_URL=http://localhost:3000`. The `db:up` script is `docker compose up -d --wait`.
- [ ] **Step 3: Write the failing tests.**
  - `tokens.test.ts` reads `globals.css` and asserts it contains each palette hex from Global Constraints as `--color-*` tokens (`--color-bg`, `--color-soft`, `--color-ink`, `--color-mute`, `--color-brand`, `--color-brand-2`, `--color-accent`, `--color-line`, `--color-booked`, `--color-arrived`, `--color-noshow`, `--color-mine`).
  - `messages.test.ts` is the portfolio's key-parity + no-empty-TR test, verbatim.
  - `i18n.spec.ts`: `/` redirects to `/en`; `/tr` renders `<html lang="tr">`; the language switch on `/en` goes to `/tr` on the same path.
- [ ] **Step 4: Run them.** `npm run test:unit` and `npm run test:e2e -- i18n`. Expected: FAIL (tokens missing, routes missing).
- [ ] **Step 5: Implement.**
  - **Tokens:** add them in `@theme`.
  - **i18n:** copy the portfolio's routing/request/navigation/proxy with matcher `/((?!api|_next|_vercel|.*\\..*).*)`.
  - **Root layout `[locale]/layout.tsx`:** loads Plus Jakarta Sans, sets `lang`, wraps `NextIntlClientProvider`, white body.
  - **Placeholder home:** shows an `h1` from messages and a minimal `LanguageSwitch` (`src/components/site/LanguageSwitch.tsx`).
  - **`tests/setup.ts`:** imports jest-dom and sets `process.env.TZ = "America/New_York"`.
  - **Playwright:** webServer `npx next dev -p 3200` with env `DATABASE_URL` = the e2e DB, `DEMO_MODE=1`, `BETTER_AUTH_URL=http://localhost:3200`, test secrets. Project `demo` = `grepInvert: /@live/`. Add the second server (port 3201, `NEXT_DIST_DIR=.next-live`, `DEMO_MODE=""`, DB `clinic_e2e_live`) and the project `live` (`grep: /@live/`) now, so later tasks only add tests.
- [ ] **Step 6: Run the tests again.** Expected: PASS. Also run `npm run typecheck && npm run lint`, both clean.
- [ ] **Step 7: Commit.** Message: "chore: scaffold Next.js app with tokens, i18n and test harnesses".

---

### Task 2: Database schema, the no-overlap constraint, test DB harness

**Files:**
- Create: `src/lib/db/range.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `drizzle.config.ts`, `drizzle/0000_*.sql` (generated), `drizzle/0001_constraints.sql` (custom, via `drizzle-kit generate --custom`), `tests/integration/global-setup.ts`, `tests/integration/helpers/db.ts`, `tests/integration/helpers/fixture.ts`
- Test: `tests/integration/constraint.test.ts`

**Interfaces:**
- Produces:
  - `type Db = PostgresJsDatabase<typeof schema>`, and `type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0]`
  - `createDb(url?: string): Db`, `db(): Promise<Db>` (shared client, lazy migrate once), `migrateDb(db: Db): Promise<void>`
  - `tstzrange` custom type: `{ start: Date; end: Date }` ⇄ `'[start,end)'`; and `overlaps(col, r: {start: Date; end: Date})` returning the SQL `col && tstzrange(...,'[)')`
  - **Tables** (snake_case columns):
    - `clinic_hours(weekday int pk 0–6, open text 'HH:MM' null, close text null)`, where null means closed
    - `clinic_settings(id int pk =1, lunch_start text, lunch_end text)`
    - `closed_dates(date date pk, label_en, label_tr)`
    - `dentists(id serial, slug unique, name, title_en, title_tr, bio_en, bio_tr, sort_order int, active bool)`
    - `treatments(id serial, slug unique, name_en, name_tr, desc_en, desc_tr, duration_min int, sort_order, active)`
    - `dentist_treatments(dentist_id, treatment_id, pk both)`
    - `working_hours(dentist_id, weekday, start, end, pk dentist_id+weekday)`
    - `patients(id uuid, name, phone_e164, email null, locale, created_at)`, unique on phone_e164
    - `entries(id uuid pk default gen_random_uuid(), dentist_id fk, kind enum entry_kind('appointment','hold','block'), during tstzrange, active bool default true, expires_at timestamptz null, hold_token_hash text null, treatment_id null, patient_id null, status enum appt_status('booked','arrived','completed','no_show','cancelled') null, source enum('online','staff') null, cancelled_by enum('patient','staff') null, manage_token_hash text null unique, block_reason enum('surgery','meeting','personal','leave','other') null, block_note text null, series_id uuid null, created_by text null, created_at, updated_at)`
    - `callback_requests(id uuid, name, phone_e164, locale, treatment_id null, message null, status enum('new','contacted','closed') default 'new', ip_hash, created_at)`
    - `email_log(id uuid, kind text, to_address, locale, subject, status enum('sent','logged','suppressed','capped','failed'), trigger enum('patient','staff'), ip_hash null, appointment_id null, created_at)`
    - `rate_events(id serial, kind text, ip_hash, created_at)`
    - The Better Auth tables are added in Task 12.
  - **Test helpers:** `testDb(): Db` (from `TEST_DATABASE_URL`), `resetTables(db): Promise<void>` (TRUNCATE all app tables RESTART IDENTITY CASCADE), `seedFixture(db): Promise<Fixture>`, `T(date: string, time: string): Date` (= `atIstanbul`; it may inline its own `+03:00` parse until Task 3 lands).
  - **Fixture:**
    - Clinic hours Mon–Fri 09:00–18:00, Sat 10:00–14:00, Sun closed. Lunch 12:30–13:30.
    - Dentists `ayd` (id 1, sort 1) and `kay` (id 2, sort 2), both working Mon–Sat over the full clinic hours.
    - Treatments `checkup` 30 min (both dentists), `whitening` 60 min (ayd only), `rootcanal` 90 min (kay only).
    - Returns `{ dentists: {ayd, kay}, treatments: {checkup, whitening, rootcanal} }` (ids).
    - The fixed test "now" is `T("2026-11-10","08:00")` (a Tuesday).

- [ ] **Step 1: Write the schema, config and the custom migration.**
  - `0001_constraints.sql` contains, in order:
    1. `CREATE EXTENSION IF NOT EXISTS btree_gist;`
    2. `ALTER TABLE entries ADD CONSTRAINT entries_no_overlap EXCLUDE USING gist (dentist_id WITH =, during WITH &&) WHERE (active);`
    3. `CHECK (lower(during) < upper(during))`
    4. `CHECK (kind <> 'hold' OR (expires_at IS NOT NULL AND hold_token_hash IS NOT NULL))`
    5. `CHECK (kind <> 'appointment' OR (patient_id IS NOT NULL AND treatment_id IS NOT NULL AND status IS NOT NULL AND source IS NOT NULL))`
    6. `CHECK (kind <> 'block' OR block_reason IS NOT NULL)`
    7. `CHECK (status IS DISTINCT FROM 'cancelled' OR active = false)`
    8. Index `entries_during_gist` on `(dentist_id, during)` (the exclusion index covers this; skip it if redundant).
  - `global-setup.ts` connects to the `postgres` DB on the TEST URL's server, runs `CREATE DATABASE clinic_test` if it's missing, then runs `migrateDb`. Also do the same for `clinic_e2e` and `clinic_e2e_live` (reused by Task 7's e2e setup).
- [ ] **Step 2: Write the failing test** `constraint.test.ts`. Each test inserts raw rows with `db.insert(entries)`:
  - `rejects overlapping active entries for the same dentist`: block 10:00–11:00 then block 10:30–11:30 for `ayd`; the second insert rejects with `code === "23P01"`.
  - `allows touching ranges`: 10:00–11:00 and 11:00–12:00 both insert.
  - `allows overlap across dentists`: same range for `ayd` and `kay`.
  - `ignores inactive entries`: an inactive (cancelled) appointment 10:00–10:30, then an active block 10:00–10:30, both insert.
  - `blocks also collide with holds and appointments`: hold 14:00–14:30 then appointment 14:15–14:45 rejects 23P01.
  - `rejects a cancelled entry left active`: insert status `cancelled` + `active=true` → check violation (`23514`).
- [ ] **Step 3: Run it.** `npm run db:up && npm run test:integration -- constraint`. Expected: FAIL (no schema / migrations).
- [ ] **Step 4: Generate the migrations and implement the client.** `npm run db:generate`, then create the custom migration. The client uses `postgres(url, { max: 10 })` + `drizzle(client, { schema })`. `db()` caches the client and the migrate promise on `globalThis`, and clears the cached promise on rejection so a failed migrate is retried. (That avoids a known minor from the portfolio.)
- [ ] **Step 5: Run it again.** Expected: PASS 6/6.
- [ ] **Step 6: Commit.** Message: "feat(db): schema with database-enforced no-overlap rule".

---

### Task 3: Istanbul time helpers and the pure slot engine

**Files:**
- Create: `src/lib/time.ts`, `src/config/booking.ts`, `src/lib/slots/engine.ts`
- Test: `tests/unit/time.test.ts`, `tests/unit/slots.test.ts`

**Interfaces:**
- Produces, from `time.ts`:
  - `TZ = "Europe/Istanbul"`
  - `atIstanbul(date: string, time: string): Date`, where date is `YYYY-MM-DD` and time is `HH:MM`, built with a fixed `+03:00` offset
  - `istanbulDateOf(d: Date): string`, `istanbulTimeOf(d: Date): string`
  - `weekdayOf(date: string): number` (0=Sun)
  - `addDays(date: string, n: number): string`
  - `formatSlotTime(d: Date, locale: Locale): string` (e.g. "14:00")
  - `formatLongDate(d: Date | string, locale: Locale): string` (e.g. "Tue 10 Nov" / "10 Kas Sal")
- Produces, from `engine.ts`:
  - `type Interval = { start: Date; end: Date }`
  - `type HoursRange = { start: string; end: string }` (HH:MM)
  - `effectiveHours(clinic: HoursRange | null, dentist: HoursRange | null, lunch: HoursRange | null): { open: HoursRange; breaks: HoursRange[] } | null`. It returns the intersection of clinic and dentist hours, or null if either is null or the intersection is empty. Breaks hold the lunch clipped to the open range.
  - `computeSlots(q: { date: string; durationMin: number; hours: ReturnType<typeof effectiveHours>; closed: boolean; busy: Interval[]; now: Date; minLeadMin: number; horizonDays: number; stepMin?: number }): Date[]`
  - `pickAnyDentist(c: { dentistId: number; sortOrder: number; dayCount: number }[]): number | null`

- [ ] **Step 1: Write the failing tests.**
  - **`time.test.ts`** (runs under TZ=America/New_York):
    - `atIstanbul("2026-11-10","14:00").toISOString() === "2026-11-10T11:00:00.000Z"`
    - `istanbulDateOf(new Date("2026-11-10T22:30:00Z")) === "2026-11-11"`
    - `istanbulTimeOf` of the same instant is `"01:30"`
    - `weekdayOf("2026-11-10") === 2`
    - `addDays("2026-12-31",1) === "2027-01-01"`
    - `formatSlotTime(atIstanbul("2026-11-10","09:05"),"en") === "09:05"`
  - **`slots.test.ts`.** Use `const H = effectiveHours({start:"09:00",end:"18:00"},{start:"09:00",end:"18:00"},{start:"12:30",end:"13:30"})`, `now = atIstanbul("2026-11-09","08:00")`, and the public lead and horizon. Each bullet is one `it`:
    - `steps every 15 minutes from opening`: a 30-min slot on 2026-11-10, first starts are 09:00, 09:15, 09:30.
    - `whole treatment must fit before lunch`: 60-min: 11:30 is included, 11:45 is not, 13:30 is included.
    - `whole treatment must fit before closing`: 90-min: the last start is 16:30.
    - `busy intervals remove overlapping starts but touching is fine`: busy 10:00–10:30, 30-min: 09:30 and 10:30 are included, 09:45 and 10:00 and 10:15 are not.
    - `closed day returns nothing`: `closed: true` gives `[]`, and `hours: null` gives `[]`.
    - `respects minimum lead`: `now = atIstanbul("2026-11-10","09:10")` gives a first start of 11:15 (09:10 + 120 = 11:10, rounded up to the grid).
    - `respects horizon`: a date 61 days after `now`'s Istanbul date gives `[]`, and 60 days gives non-empty.
    - `staff lead allows the past hour`: `minLeadMin: -60`, `now` 10:20, so 09:30 is included and 09:15 is not.
    - `effectiveHours intersects clinic and dentist`: clinic 09–18, dentist 10–14 gives open 10:00–14:00 with breaks [12:30–13:30]. Dentist null gives null. A dentist 08:00–09:00 against clinic 09–18 gives null.
    - `pickAnyDentist prefers fewest bookings, then sort order`: `[{1,1,3},{2,2,1}]` gives 2, `[{1,1,2},{2,2,2}]` gives 1, `[]` gives null.
- [ ] **Step 2: Run them.** `npm run test:unit -- time slots`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** `computeSlots` generates candidate starts from `open.start`, stepping `stepMin` (default `SLOT_STEP_MIN`). It keeps a start when every one of these holds:
  - `start + duration ≤ open.end`
  - the slot touches no break or busy interval (half-open)
  - `start ≥ now + minLeadMin`
  - `date ≤ addDays(istanbulDateOf(now), horizonDays)`
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(slots): Istanbul time helpers and pure slot engine".

---

### Task 4: DB-backed availability

**Files:**
- Create: `src/lib/booking/errors.ts`, `src/lib/booking/availability.ts`
- Test: `tests/integration/availability.test.ts`

**Interfaces:**
- Consumes: Task 2 schema/fixture, Task 3 engine and time.
- Produces:
  - `type BookingErrorCode = "slot_taken"|"outside_rules"|"hold_expired"|"too_late"|"link_expired"|"rate_limited"|"block_conflict"|"capacity_floor"|"forbidden"|"demo_disabled"|"not_found"|"invalid"`
  - `class BookingError extends Error { constructor(public code: BookingErrorCode, public details?: unknown) }`
  - `type Audience = "public" | "staff"`
  - `getDaySlots(db: DbOrTx, q: { treatmentId: number; dentistId: number | "any"; date: string; now: Date; audience: Audience; ignoreEntryId?: string }): Promise<{ start: Date; dentistIds: number[] }[]>`. Dentist candidates are active dentists who perform the treatment, filtered to `dentistId` if it's numeric. Busy = active entries overlapping the day, excluding holds with `expires_at <= now` and excluding `ignoreEntryId` (used when rescheduling an entry onto itself). Closed = the date is in `closed_dates`.
  - `getDayStrip(db, q: { treatmentId: number; dentistId: number | "any"; from: string; days: number; now: Date; audience: Audience }): Promise<{ date: string; available: boolean }[]>`
  - `nextFreeSlot(db, now: Date): Promise<{ start: Date; dentistId: number; treatmentId: number } | null>`, the earliest public slot for the shortest active treatment, searching up to 14 days
  - `countPublicSlots(db, date: string, now: Date): Promise<number>`, the number of (dentist, start) pairs for a `DEMO_FLOOR.probeDurationMin`-minute treatment, counted against every active dentist regardless of treatment links
  - `assertBookable(db, q: { treatmentId: number; dentistId: number; start: Date; now: Date; audience: Audience; ignoreEntryId?: string }): Promise<void>`, which throws `BookingError("outside_rules")` unless `start` is in `getDaySlots` for that dentist. Holds and moves use it for friendly errors; the constraint remains the guarantee.

- [ ] **Step 1: Write the failing tests** (the fixture, now = Tue 2026-11-10 08:00):
  - `lists slots for one dentist`: checkup/ayd on 2026-11-10 starts at 10:00 (because of the 120-min lead) and contains no 12:30.
  - `any merges dentists`: checkup/any 10:00 has `dentistIds` `[1,2]`.
  - `only dentists who perform the treatment`: whitening/any gives only `[1]`.
  - `existing appointment and block remove starts`: insert a block for ayd 10:00–11:00. The checkup/ayd list lacks 10:00/10:30, has 11:00, and kay still has 10:00.
  - `ignores expired holds`: insert a hold ayd 10:00–10:30 with `expires_at` = now − 1 min. 10:00 is offered for ayd. *(Review Focus 1)*
  - `active holds count`: the same hold with `expires_at` = now + 5 min, so 10:00 is not offered.
  - `closed date returns nothing`: insert closed_dates 2026-11-11. The day list is empty and the strip marks it unavailable.
  - `Sunday unavailable in strip`: `getDayStrip(from "2026-11-10", 7)` marks 2026-11-15 unavailable and the others available.
  - `nextFreeSlot finds the earliest`: `{start: T("2026-11-10","10:00"), dentistId: 1}`.
  - `assertBookable rejects an off-grid time`: 10:05 → `outside_rules`.
- [ ] **Step 2: Run them.** `npm run test:integration -- availability`. Expected: FAIL.
- [ ] **Step 3: Implement** `availability.ts` and `errors.ts`. Load the day's data in at most 4 queries: dentists+links, hours, closed, and entries overlapping `[atIstanbul(date,"00:00"), +1 day)`.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(booking): database-backed availability".

---

### Task 5: Holds, confirming a booking, patients, tokens, rate limits

**Files:**
- Create: `src/lib/booking/entries.ts`, `src/lib/booking/holds.ts`, `src/lib/booking/patients.ts`, `src/lib/security/{tokens,hash-ip,client-ip,rate-limit}.ts` (hash-ip and client-ip are copied from the portfolio)
- Test: `tests/unit/patients.test.ts`, `tests/unit/tokens.test.ts`, `tests/integration/holds.test.ts`

**Interfaces:**
- Consumes: Task 4 `assertBookable`, `BookingError`, `getDaySlots`.
- Produces:
  - **Tokens:** `newToken(): string` (32 random bytes, base64url) and `hashToken(t: string): string` (sha256 hex).
  - **Phones and patients:** `normalizePhone(raw: string): string | null`. It returns E.164 for Turkish inputs: `+90…`, `0…` or bare 10-digit `5…`. Other `+` international numbers are kept as digits, and junk gives null. `upsertPatient(tx, p: { name: string; phone: string; email?: string | null; locale: Locale }): Promise<string>` upserts by `phone_e164`, updating name, email and locale, and returns the id.
  - **Rate limits:** `checkAndRecordRate(db, kind: keyof typeof RATE, ipHash: string, now: Date): Promise<void>` throws `rate_limited`.
  - **Entry helpers:**
    - `insertEntry(tx, row: NewEntry, now: Date): Promise<string>` first deletes holds for the same dentist that overlap the row's range and have `expires_at <= now`, then inserts. It maps `23P01` to `BookingError("slot_taken")`.
    - `updateEntryRange(tx, id: string, dentistId: number, range: Interval, now: Date): Promise<void>` does the same sweep and mapping for an update.
    - `withSlotTaken<T>(fn: () => Promise<T>): Promise<T>`, the mapping helper both of them use.
  - **Holds:** `placeHold(db, q: { treatmentId: number; dentistId: number | "any"; start: Date; now: Date; ipHash: string }): Promise<{ holdId: string; holdToken: string; dentistId: number; expiresAt: Date }>`. For "any", it gets the candidates at `start` from `getDaySlots` and uses `pickAnyDentist` with that day's appointment counts. If that dentist's insert races to `slot_taken`, it tries the next candidate. Expiry is `now + HOLD_MINUTES`.
  - **Confirming:** `confirmBooking(db, q: { holdId: string; holdToken: string; patient: { name: string; phone: string; email: string; locale: Locale }; now: Date; ipHash: string; demoOwner?: string }): Promise<ConfirmedBooking>`, where `type ConfirmedBooking = { appointmentId: string; manageToken: string; start: Date; end: Date; dentistId: number; treatmentId: number; created: boolean }`. Inside one transaction it:
    1. Loads the entry by id and checks the hold token hash.
    2. If it's already an appointment (a double submit), returns it with `created: false` and a **new** manage token. Since only the hash is stored, rotate it: update `manage_token_hash` and return the new token. The UI shows the latest one.
    3. If it's an expired hold, re-validates with `assertBookable` (public), then refreshes it. A `slot_taken` or `outside_rules` here becomes `hold_expired`.
    4. Otherwise updates the row in place: `kind='appointment'`, `expires_at=null`, `status='booked'`, `source='online'`, `patient_id`, `manage_token_hash`.

- [ ] **Step 1: Write the failing unit tests.**
  - `normalizePhone` *(Review Focus 5)*:
    - `"+90 532 111 22 33"`, `"0532 111 2233"`, `"5321112233"` and `"(0532) 111-22-33"` all give `"+905321112233"`
    - `"+44 20 7946 0958"` gives `"+442079460958"`
    - `"abc"` and `"123"` give null
  - `tokens`: `newToken()` length ≥ 43 and two calls differ; `hashToken("a")` is a stable 64-hex string.
- [ ] **Step 2: Write the failing integration tests** (`holds.test.ts`, the fixture, now Tue 08:00):
  - `placeHold reserves the slot`: a hold on checkup/ayd at 10:00 means `getDaySlots` for ayd lacks 10:00.
  - `placeHold succeeds over an expired hold` *(Review Focus 1)*: hold A at 10:00 with now. Then at now+6min, hold B at 10:00 succeeds, and exactly one hold row exists for that range.
  - `concurrent holds on one slot: exactly one wins`: 20 parallel `placeHold` for ayd 10:00 (with separate connections, via `Promise.allSettled`) give 1 fulfilled and 19 rejected with `slot_taken`.
  - `any assigns the least busy dentist`: an appointment for ayd at 15:00, then hold checkup/any at 10:00, gives `dentistId` 2.
  - `confirm turns the hold into an appointment`: the row has kind `appointment`, status `booked`, source `online`; the patient was created with normalized phone; `manage_token_hash = hashToken(result.manageToken)`.
  - `confirm is idempotent per hold` *(Review Focus 3)*: confirming twice with the same hold gives the same appointmentId, `created` true then false, and one appointment row.
  - `confirm re-acquires an expired but still-free hold` *(Review Focus 2)*: hold, then confirm at now+7min, succeeds.
  - `confirm on an expired hold whose slot was taken fails with hold_expired`: hold A, then at +6min hold B on the same slot (sweeping A), then confirm A gives `hold_expired`.
  - `wrong hold token is rejected`: gives `not_found`.
  - `rate limit`: the 21st `placeHold` from the same ipHash within an hour gives `rate_limited`.
  - `same phone reuses the patient`: two bookings with `"0532 111 2233"` and `"+905321112233"` give one patients row.
- [ ] **Step 3: Run them.** `npm run test:unit -- patients tokens && npm run test:integration -- holds`. Expected: FAIL.
- [ ] **Step 4: Implement** the modules above. Each `placeHold` call in the concurrency test must use its own transaction. The shared `postgres` pool with `max: 10` makes them truly concurrent.
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Commit.** Message: "feat(booking): holds, confirmation, patients and rate limits".

---

### Task 6: Email (send, log, caps, templates) and the .ics file

**Files:**
- Create: `src/lib/email/send.ts`, `src/lib/email/templates.ts`, `src/lib/email/ics.ts`, `src/config/clinic.ts`
- Test: `tests/unit/ics.test.ts`, `tests/unit/email-templates.test.ts`, `tests/integration/email.test.ts`

**Interfaces:**
- Produces:
  - `clinic = { name: string; shortName: string; address: string; phoneDisplay: string; phoneE164: string; email: string; mapText: string }`. The phone is a fictional `+90 216 555 …` number, and the email is `hello@<slug>.example`. **Pick the invented name here:** search the web for "<name> diş kliniği İstanbul", reject any match, and record the result in the README in Task 18.
  - `buildIcs(e: { uid: string; start: Date; end: Date; summary: string; location: string; description: string; now: Date }): string`. Output is RFC 5545 with CRLF line endings, UTC `DTSTART:20261110T110000Z`, and escaped `,;\` and newlines.
  - `type EmailKind = "booking_confirmation" | "booking_rescheduled" | "booking_cancelled"`
  - `renderEmail(kind: EmailKind, locale: Locale, d: { patientName: string; treatmentName: string; dentistName: string; start: Date; manageUrl?: string }): { subject: string; html: string; text: string }`. Times use `formatLongDate`/`formatSlotTime` in Istanbul time. The subject has CR/LF stripped. The HTML escapes user input.
  - `sendEmail(db: DbOrTx, m: { kind: EmailKind; to: string | null; locale: Locale; subject: string; html: string; text: string; trigger: "patient" | "staff"; ipHash?: string; appointmentId?: string; attachments?: { filename: string; content: string }[]; now: Date }, deps?: { resend?: { send(args: unknown): Promise<unknown> } }): Promise<"sent" | "logged" | "suppressed" | "capped" | "failed">`. Decision order:
    1. No `to`, or it ends with `@example.com` or `.example`: `suppressed`.
    2. `isDemo()` and `trigger === "staff"`: `logged`.
    3. More than `EMAIL_CAP_PER_ADDRESS_PER_DAY` rows with status `sent` or `logged` to that address in the last 24 h, or more than `EMAIL_CAP_PER_IP_PER_DAY` from that ipHash: `capped`.
    4. No `RESEND_API_KEY`: `logged`, with a console line.
    5. Otherwise send. If it throws: `failed`.

    It always inserts an `email_log` row and never throws. `isDemo()` comes from Task 7's `src/lib/demo/mode.ts`; create that one-liner (`process.env.DEMO_MODE === "1"`) here.

- [ ] **Step 1: Write the failing tests.**
  - `ics`: the output contains `BEGIN:VCALENDAR\r\n`, `DTSTART:20261110T110000Z`, `DTEND:20261110T120000Z`, `SUMMARY:` with an escaped comma (`Check-up\, cleaning`), and every line is ≤ 75 octets (folded).
  - `email-templates`:
    - `en confirmation names treatment, dentist and Istanbul time`: the text contains "14:00" for `atIstanbul("2026-11-10","14:00")` while TZ is New York.
    - `tr confirmation is Turkish`: the subject contains "Randevu".
    - `subject strips CR/LF` *(Review Focus 5)*: patientName `"Ali\r\nBcc: x@y.z"` gives a subject with no `\r` or `\n`.
    - `html escapes names`: `"<b>Ayşe</b>"` appears escaped, and "Ayşe" is preserved.
    - `never mentions a price`: neither locale's output matches `/₺|TL|price|fiyat/i`.
  - `email` (integration):
    - `example.com is suppressed`: logs `suppressed` and doesn't call the fake resend.
    - `staff trigger in demo is logged`: with `DEMO_MODE=1`, gives `logged`.
    - `no API key logs`
    - `cap per address`: the 6th to the same address in 24 h gives `capped`.
    - `sends via resend when configured`: the fake resend is called once with the attachments, and the result is `sent`.
    - `resend throwing gives failed`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Templates are plain TS string builders, and copy comes from `messages/*.json` under `email.*` via `createTranslator` from next-intl.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(email): templates, ics, logged sending with caps".

---

### Task 7: Clinic content, seed, demo reset, cron route

**Files:**
- Create: `src/content/clinic-data.ts`, `src/lib/demo/{mode,seed,reset}.ts` (mode already exists from Task 6), `scripts/seed.ts`, `scripts/reset-demo.ts`, `src/app/api/cron/reset/route.ts`, `vercel.json`, `tests/e2e/global-setup.ts`
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5 (`insertEntry`, `upsertPatient`, `countPublicSlots`).
- Produces:
  - **`clinicData`:**
    - 4 dentists with name, slug, `title`/`bio` in EN and TR, sort order, treatment slugs and weekly hours. They're named Dr. Elif Aydın, Dr. Murat Kaya, Dr. Selin Demir, Dr. Can Öztürk. One dentist doesn't work Saturdays, and one works 10:00–16:00.
    - 7 treatments, each with slug and duration: checkup 30, filling 45, whitening 60, implant-consult 45, aligner-consult 45, rootcanal 90, child-checkup 30. Each has name/desc in EN and TR.
    - Clinic hours Mon–Fri 09:00–18:00 and Sat 10:00–14:00, closed Sun, lunch 12:30–13:30.
    - 30 fake patient names (a Turkish and international mix), each with an `@example.com` email.
  - **Seeding:** `seedClinic(db: Db, opts: { now: Date; rng?: () => number }): Promise<void>` inserts config and users-free data. Demo staff users come in Task 12 via `seedStaffUsers` (it's called from `resetDemo` once it exists). Bookings:
    - Cover from the Monday of `now`'s week through the end of next week.
    - Fill about 70% of each dentist's slots with random treatments (deterministic with a seeded rng, mulberry32).
    - Past entries get statuses arrived/completed/no_show (about 8% no-show), and about 5% are cancelled.
    - Add one surgery block (Wed 14:00–16:00, dentist 2) and one leave day (next Thu, dentist 3).
    - Add 2 callback requests.
    - **Guarantee:** after seeding, `countPublicSlots(d) ≥ 8` for today, if today still has any open hours after the lead time, and for each of the next 3 open days. To achieve it, stop filling a day once its count reaches that floor plus a margin.
  - **Reset:** `resetDemo(db: Db, now: Date): Promise<void>` truncates every app table (and the auth sessions once they exist) in one transaction, then seeds.
  - **Cron:** `GET /api/cron/reset` requires `Authorization: Bearer ${CRON_SECRET}`. It returns 401 otherwise, and 403 when `DEMO_MODE` isn't `1`. On success it runs `resetDemo(await db(), new Date())` and returns `{ ok: true }`. `vercel.json` has the cron `{"path":"/api/cron/reset","schedule":"0 0 * * *"}` (00:00 UTC = 03:00 Istanbul).
  - **Scripts:** `npm run db:seed` and `npm run demo:reset` run `tsx scripts/*.ts` (they load `.env.local` via `node --env-file`).
  - **E2E global setup:** Playwright's `globalSetup` runs `migrateDb` + `resetDemo(now)` on `clinic_e2e` and `clinic_e2e_live` before the servers are used.

- [ ] **Step 1: Write the failing test** `seed.test.ts` (now = Tue 2026-11-10 08:00):
  - `seeds 4 dentists and 7 treatments`.
  - `calendar is busy but bookable`: for 2026-11-10 through 2026-11-13, `countPublicSlots ≥ 8`, and the appointments count for the day is ≥ 20.
  - `seed is deterministic`: two resets with the same rng seed give identical `(dentist_id, lower(during))` lists.
  - `all seeded emails are example.com`.
  - `no seeded prices`: there is no column or field containing "price" in `clinicData` (`JSON.stringify` doesn't match `/price|fiyat|₺/i`).
  - `reset wipes visitor data`: insert an extra patient, then `resetDemo`, and that patient is gone.
  - `cron route auth`: call the exported `GET` with no header to get 401; with the right bearer but `DEMO_MODE=""` to get 403; with both to get 200 and reseeded data.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS. Also run `npm run db:up && npm run demo:reset` against the dev DB, which exits 0.
- [ ] **Step 5: Commit.** Message: "feat(demo): clinic content, deterministic seed, nightly reset".

---

### Task 8: Public site shell and pages

**Files:**
- Create: `src/components/site/{DemoBanner,Nav,MobileMenu,Footer,PricingNote,NextFreeSlot,TreatmentCard,DentistCard,Avatar,HeroArt}.tsx`, the `src/app/[locale]/(public)/` pages `page.tsx`, `treatments/page.tsx`, `treatments/[slug]/page.tsx`, `dentists/page.tsx`, `international/page.tsx`, `contact/page.tsx` (form placeholder area filled in Task 9), and `src/lib/public/queries.ts`
- Test: `tests/e2e/public.spec.ts`

**Interfaces:**
- Consumes: Task 4 `nextFreeSlot`, Task 6 `clinic`, Task 7 seeded data.
- Produces:
  - `listTreatments(db, locale)`, `getTreatment(db, slug, locale)`, `listDentists(db, locale)`
  - `<DemoBanner role="patient" | "receptionist" | "dentist" | "admin" | null />`. It renders only when `isDemo()`, contains "Demo, not a real clinic" plus the three role pills (Patient links to `/{locale}`; the other two are forms posting to Task 12's `demoSignIn` action, so render them as disabled links until Task 12) and "Data resets nightly at 03:00".
  - `<PricingNote treatmentSlug?: string />` shows "Pricing: contact the clinic for a quote", a `tel:` link and a "Request a call back" link to `/{locale}/contact?treatment=slug#callback`.
- Pages are dynamic where they show live slots (home). Treatments and dentists pages read the DB but may use `revalidate = 300`.
- **Visuals:** dentist photos are `<Avatar>` (initials on a mint/teal circle) and the hero art is an inline SVG illustration (no external images). This is my call: it avoids licensing and network dependencies.

- [ ] **Step 1: Write the failing e2e tests** `public.spec.ts`:
  - `home shows the demo banner, hero, next free slot and booking CTA`: the text "Demo, not a real clinic" is present, the "Next free slot" card has a time matching `/\d{2}:\d{2}/`, and "Book appointment" links to `/en/book`.
  - `treatments list durations and never prices`: 7 treatment cards; the page text doesn't match `/₺|\bTL\b|price:|fiyat:/i` (the PricingNote wording "Pricing: contact the clinic" is allowed, so assert on currency and the regex `/\d+\s?(₺|TL)/` instead).
  - `treatment detail shows PricingNote with call and call-back`.
  - `dentists page lists 4 dentists`.
  - `international page exists in en and tr`.
  - `mobile menu works at 390px`.
  - `axe: no serious violations on home, treatments, dentists` (using `@axe-core/playwright`, impacts `serious` and `critical`).
  - `tr home is Turkish`: the h1 differs from en and `html[lang=tr]`.
- [ ] **Step 2: Run them.** `npm run test:e2e -- public`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages to match mockup screen 1 (direction A), minus prices. The home page's reviews/trust row is labelled "(demo)". The contact page shows the fictional address, hours and a static map-like illustration. Every string lives in messages under `public.*`.
- [ ] **Step 4: Run them again.** Expected: PASS. Also run typecheck and lint.
- [ ] **Step 5: Commit.** Message: "feat(site): public clinic website".

---

### Task 9: Call-back requests

**Files:**
- Create: `src/lib/public/callback.ts`, `src/app/[locale]/(public)/contact/actions.ts`, `src/components/site/CallbackForm.tsx`
- Test: `tests/integration/callback.test.ts`, `tests/e2e/callback.spec.ts`

**Interfaces:**
- Produces:
  - `callbackSchema` (Zod): name 2–80 chars, phone (passes `normalizePhone`), locale, treatmentSlug optional, message ≤ 1000, honeypot `website` must be empty.
  - `createCallbackRequest(db, input: unknown, ctx: { ipHash: string; now: Date }): Promise<{ ok: true } | { ok: false; fieldErrors: Record<string, string> }>`. A filled honeypot gives `{ok:true}` but stores nothing. It enforces `RATE.callback`, where `rate_limited` becomes a form-level error.
  - The server action `submitCallback(prev, formData)` is used with `useActionState`. The form is prefilled with the treatment from `?treatment=`.

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - `stores a request with normalized phone and status new`
    - `honeypot stores nothing but reports ok`
    - `invalid phone gives a field error`
    - `6th request in an hour is rate limited`
  - E2E: from the treatment page, "Request a call back" lands on contact with the treatment preselected. Submitting shows the success message (EN), and the TR version shows Turkish text.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(site): call-back requests".

---

### Task 10: Booking flow UI, confirmation page, .ics route, the "mine" cookie

**Files:**
- Create: `src/app/[locale]/(public)/book/page.tsx` (server shell reading search params), `src/app/[locale]/(public)/book/actions.ts`, `src/components/booking/{Wizard,StepTreatment,StepDentist,StepTime,StepDetails,Summary,DayStrip,SlotGrid}.tsx`, `src/app/[locale]/(public)/book/done/page.tsx`, `src/app/api/ics/[token]/route.ts`, `src/lib/demo/mine.ts`, `src/lib/booking/notify.ts`
- Test: `tests/unit/mine.test.ts`, `tests/e2e/booking.spec.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 6.
- Produces:
  - **Wizard state** lives in the URL: `?treatment=slug&dentist=id|any&date=YYYY-MM-DD`, plus the hold kept in component state. Server actions, all of which return `{ ok: false, code: BookingErrorCode }` on failure:
    - `loadDay({treatment, dentist, date})` returns `{ strip, slots: { start: string /*ISO*/; label: string }[] }`
    - `holdSlot({treatment, dentist, start})` returns `{ holdId, holdToken, dentistId, expiresAt }`
    - `confirm({holdId, holdToken, name, phone, email, privacy, website})` returns `{ redirectTo: "/{locale}/book/done?t=<manageToken>" }`
  - **Hold handling:** step 4 shows a countdown from `expiresAt`. A `hold_expired` or `slot_taken` result sends the patient back to step 3 with the message `booking.errors.slotGone`.
  - **Notifications:** `notifyPatient(db, kind: EmailKind, appointmentId: string, ctx: { trigger: "patient" | "staff"; ipHash?: string; manageToken?: string; now: Date }): Promise<void>` loads the data, renders, attaches the .ics on confirmation and reschedule, and calls `sendEmail`. It's called after `confirm` succeeds and `created` is true.
  - **"Mine" cookie** (`demo_mine`, JSON array of the last ≤5 appointment ids, httpOnly, path `/`, 7 days):
    - `parseMine(raw?: string): string[]`, safe against garbage
    - `withMine(list: string[], id: string): string[]` puts the new id first, dedupes and caps at 5
    - `confirm` sets it
  - **Confirmation page** (`/book/done?t=`): looks up by manage token and shows the summary, "Add to calendar" (`/api/ics/<token>`), "We emailed you", and a manage link `/{locale}/booking/<token>`. In demo mode it also shows a callout: "Now see it from the clinic's side → Try it as Receptionist".
  - **`GET /api/ics/[token]`** returns `text/calendar` with `Content-Disposition: attachment; filename="appointment.ics"`, or 404 for an unknown token.

- [ ] **Step 1: Write the failing tests.**
  - `mine.test.ts`: garbage gives `[]`; `withMine` dedupes, caps at 5 and puts the newest first.
  - `booking.spec.ts`:
    - `books end to end and lands on confirmation` (with `test.use({ timezoneId: "Europe/London" })`, *Review Focus 4*): pick Check-up, then Anyone, then the first enabled day, then read the first slot label `L`, then fill name "Ayşe Yılmaz", phone "0532 111 2233", email `e2e+<random>@example.com`, then submit. The confirmation shows `L` (the same Istanbul time despite the London browser), and the ics link responds 200 with `text/calendar`.
    - `taken slot disappears for the next visitor`: a second browser context loads the same day and doesn't list `L` for that dentist when a specific dentist was chosen.
    - `required fields and privacy checkbox are validated`.
    - `booking flow never shows a price` (regex as in Task 8).
    - `tr booking flow is Turkish`.
    - `axe on each step`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** to match mockup screen 2: slot strip, Morning/Afternoon groups, and a summary panel with the PricingNote in place of a price. The Morning group holds starts before 12:00. Step 4 shows the privacy note (spec §3): "This is a demo. Your details are only used for this booking and are wiped every night".
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(booking): four-step booking flow with confirmation and ics".

---

### Task 11: Manage-booking page (cancel and reschedule by patient)

**Files:**
- Create: `src/lib/booking/manage.ts`, `src/app/[locale]/(public)/booking/[token]/page.tsx`, `src/app/[locale]/(public)/booking/[token]/actions.ts`
- Test: `tests/integration/manage.test.ts`, `tests/e2e/manage.spec.ts`

**Interfaces:**
- Consumes: Task 5 `updateEntryRange`, Task 4 `assertBookable`, Task 10 `notifyPatient`.
- Produces:
  - `getByManageToken(db, token: string, now: Date): Promise<ManageView | null>`. It returns null for an unknown token or when the appointment ended before `now` (link expired). `type ManageView = { appointmentId; start; end; treatmentId; treatmentName; dentistId; dentistName; status; canChange: boolean }`, where `canChange` = status booked && start − now ≥ `MANAGE_CUTOFF_HOURS`.
  - `cancelByPatient(db, token, now): Promise<void>` sets status `cancelled`, active false, `cancelled_by` patient. It throws `too_late` or `link_expired`.
  - `rescheduleByPatient(db, token, newStart: Date, now): Promise<void>` calls `assertBookable` (public, `ignoreEntryId`) and then `updateEntryRange`. It throws `too_late`, `slot_taken` or `outside_rules`.
  - **The page:** shows the view. With `canChange` it offers Cancel (with a confirm step) and Reschedule (reusing `DayStrip`/`SlotGrid` from Task 10). Otherwise: "Please call the clinic" + the phone number. A cancelled appointment shows a cancelled state. Both actions email the patient (`trigger: "patient"`).

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - `cancel frees the slot`: after cancelling, the slot is offered again.
    - `cannot change within 24h`: start = now + 23h gives `too_late`, and `canChange` is false.
    - `reschedule moves the same row`: the id is unchanged, the range is new, the old slot is free.
    - `reschedule onto a taken slot gives slot_taken`.
    - `reschedule may overlap its own old range`: shifting by 15 minutes succeeds (because of `ignoreEntryId`).
    - `link expires after the appointment`: `getByManageToken` at end + 1 min gives null.
  - E2E: book (with a helper that reuses the Task 10 flow), open the manage link, reschedule to another slot (the page shows the new time), then cancel (the page shows the cancelled state). An unknown token shows the "link not valid" page.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(booking): manage-booking link with cancel and reschedule".

---

### Task 12: Staff auth, roles, permissions, demo one-click sign-in

**Files:**
- Create:
  - auth: `src/lib/auth/auth.ts`, `src/lib/auth/actor.ts`, `src/lib/auth/permissions.ts`, `src/app/api/auth/[...all]/route.ts`
  - staff pages: `src/app/[locale]/staff/login/page.tsx`, `src/app/[locale]/staff/login/actions.ts`, `src/app/[locale]/staff/(app)/layout.tsx`, `src/app/[locale]/staff/(app)/page.tsx` (role redirect)
  - components and scripts: `src/components/staff/Sidebar.tsx`, `scripts/create-user.ts`
  - demo: `src/lib/demo/staff-users.ts`
  - schema: the auth tables in `schema.ts` plus a migration
- Test: `tests/unit/permissions.test.ts`, `tests/integration/auth.test.ts`, `tests/e2e/staff-auth.spec.ts`

**Interfaces:**
- Produces:
  - `auth` = `betterAuth({ database: drizzleAdapter(db, { provider: "pg" }), emailAndPassword: { enabled: true, disableSignUp: true }, user: { additionalFields: { role: { type: "string" }, dentistId: { type: "number", required: false } } }, plugins: [nextCookies()] })`. Generate the tables with `npx @better-auth/cli generate` into `schema.ts`, then `db:generate`.
  - `type Role = "receptionist" | "dentist" | "admin"`, `type Actor = { userId: string; name: string; role: Role; dentistId: number | null }`
  - `getActor(): Promise<Actor | null>`, `requireActor(): Promise<Actor>` (redirects to `/{locale}/staff/login`)
  - `type Action = "calendar.viewAll" | "appointment.manage" | "appointment.status" | "block.manage" | "requests.view" | "patients.view" | "settings.view" | "settings.edit"`
  - `can(actor: Actor, action: Action, target?: { dentistId?: number }): boolean`, implementing spec §7.1 exactly:
    - **Receptionist:** everything except `settings.view` and `settings.edit`.
    - **Admin:** everything.
    - **Dentist:** `calendar.viewAll` yes. `appointment.manage`, `appointment.status` and `block.manage` only when `target.dentistId === actor.dentistId`. `patients.view` yes (the query filters to their own patients). `requests.view` no, `settings.*` no.
  - `seedStaffUsers(db): Promise<{ receptionist: string; dentist: string; admin: string }>` creates three users via `auth.api` (or the adapter with a hashed `DEMO_PASSWORD`):
    - `zeynep@staff.example` (receptionist)
    - `elif@staff.example` (dentist, linked to dentist slug `elif-aydin`)
    - `admin@staff.example` (admin)

    Call it from `resetDemo`, which also truncates the auth tables.
  - `demoSignIn(role: "receptionist" | "dentist" | "admin", next?: string)`, a server action that works only when `isDemo()` (otherwise `forbidden`). It signs in with `auth.api.signInEmail({ body: { email, password: DEMO_PASSWORD }, headers })` and redirects to `next`, or to the role's home.
  - **Role homes:** receptionist and admin go to `/staff/calendar`; dentist goes to `/staff/today`.
  - **Magic-moment redirect:** when the `demo_mine` cookie has ids, the Receptionist pill uses `next=/{locale}/staff/calendar?date=<Istanbul date of newest mine appointment>`.
  - `create-user` CLI: `npm run user:create -- --email x --name y --role dentist --dentist elif-aydin --password …`
  - **Staff layout:** sidebar as in mockup screen 3, with links filtered by `can`, "Signed in as", sign out, and `robots: noindex`. The DemoBanner shows the current role.
  - **Live-mode e2e logins:** the live e2e DB is seeded the same way, so `@live` tests sign in with the form, using `DEMO_PASSWORD` from the Playwright env.

- [ ] **Step 1: Write the failing tests.**
  - `permissions.test.ts`: a table-driven test covering every (role × action), plus dentist own versus other target. `dentist cannot manage another dentist's block` is false; `dentist can set status on own appointment` is true; `receptionist cannot edit settings` is false.
  - `auth.test.ts`: `seedStaffUsers` creates 3 users with the right roles, and the dentist user has the right `dentistId`.
  - `staff-auth.spec.ts`:
    - `/en/staff/calendar` redirects to login when signed out.
    - The demo banner Receptionist pill lands on the calendar with "Signed in as Zeynep".
    - The Dentist pill lands on `/en/staff/today`.
    - A wrong password on the login form shows an error.
    - The sidebar for a dentist has no "Requests" or "Settings".
    - Sign out works.
    - `@live`: the role pills are absent, and the form login with the admin credentials works.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, then enable the DemoBanner pills from Task 8.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): auth, roles, permissions and demo sign-in".

---

### Task 13: Staff mutations (domain), capacity floor, outside-hours flag

**Files:**
- Create: `src/lib/staff/appointments.ts`, `src/lib/staff/blocks.ts`, `src/lib/demo/floor.ts`, `src/lib/staff/outside-hours.ts`
- Test: `tests/unit/floor.test.ts`, `tests/integration/staff-appointments.test.ts`, `tests/integration/blocks.test.ts`

**Interfaces:**
- Consumes: Task 12 `Actor` and `can`, Task 5 `insertEntry`, `updateEntryRange` and `upsertPatient`, Task 4 `assertBookable` and `countPublicSlots`, Task 10 `notifyPatient`.
- Every function below throws `forbidden` when `can` fails. Each runs in one transaction. When `isDemo()` is true, `moveAppointment`, `createStaffAppointment` and `createBlock`/`updateBlock` wrap their change in `withCapacityFloor`.
- Produces:
  - **Capacity floor:**
    - `assertFloor(before: Record<string, number>, after: Record<string, number>, min = DEMO_FLOOR.minSlots): void`, which throws `capacity_floor` if any date has `after < Math.min(min, before)`
    - `snapshotCapacity(tx, now): Promise<Record<string, number>>` covers today plus the next `DEMO_FLOOR.days − 1` open days
    - `withCapacityFloor<T>(tx, now, fn: () => Promise<T>): Promise<T>`
  - **Appointments:**
    - `moveAppointment(db, actor, q: { appointmentId: string; newStart: Date; newDentistId?: number; now: Date }): Promise<void>`. A dentist may only move their own appointments and not to another dentist (`forbidden`). The target dentist must perform the treatment (`outside_rules`). Validates with `assertBookable` (staff, `ignoreEntryId`) and saves with `updateEntryRange` (a race gives `slot_taken`). Then `notifyPatient("booking_rescheduled", trigger "staff")`.
    - `cancelByStaff(db, actor, q: { appointmentId: string; now: Date }): Promise<void>` sets `cancelled_by` staff and notifies with trigger staff.
    - `setStatus(db, actor, q: { appointmentId: string; status: "booked" | "arrived" | "completed" | "no_show" }): Promise<void>` (cancel goes through `cancelByStaff`).
    - `createStaffAppointment(db, actor, q: { treatmentId: number; dentistId: number; start: Date; patient: { name: string; phone: string; email?: string | null; locale: Locale }; now: Date }): Promise<{ appointmentId: string }>` uses source staff and status booked. When there is an email it creates a manage token and notifies (trigger staff; in demo that's logged).
  - **Blocks:**
    - `createBlock(db, actor, q: { dentistId: number; start: Date; end: Date; reason: BlockReason; note?: string; repeatWeekly?: { count?: number; until?: string }; now: Date }): Promise<{ seriesId: string | null; entryIds: string[] }>`. It expands occurrences (count ≤ 52, until ≤ 1 year). It first checks every occurrence for **appointments** overlapping it; if any exist, it throws `BookingError("block_conflict", { conflicts: { appointmentId; start: string; patientName: string; occurrenceStart: string }[] })` and inserts nothing. Expired holds are swept automatically; active holds and other blocks conflicting give `slot_taken`. All occurrences go in one transaction.
    - `updateBlock(db, actor, q: { entryId: string; start: Date; end: Date; reason: BlockReason; note?: string; now: Date }): Promise<void>` changes only that occurrence and applies the same conflict rule.
    - `deleteBlock(db, actor, q: { entryId: string; wholeSeries?: boolean }): Promise<void>`
  - **Outside hours:** `findOutsideHours(db, from: string, to: string): Promise<string[]>` returns appointment ids (active, booked) whose range is no longer inside their dentist's effective hours, or that fall on a closed date.

- [ ] **Step 1: Write the failing tests.**
  - `floor.test.ts`: `assertFloor({a:10},{a:4})` passes; `{a:10}→{a:3}` throws; `{a:2}→{a:2}` passes (the day was already below the floor and didn't get worse); `{a:2}→{a:1}` throws.
  - `staff-appointments.test.ts`:
    - `receptionist moves to another dentist who performs the treatment`
    - `move to a dentist who doesn't perform it gives outside_rules`
    - `dentist cannot move another dentist's appointment gives forbidden`
    - `dentist cannot move own appointment to another dentist gives forbidden`
    - `drag race: a move and a booking on the same slot, exactly one wins` (`Promise.allSettled` of `moveAppointment` and `placeHold` into the same free slot)
    - `walk-in in the past hour is allowed for staff`
    - `staff cancel in demo logs the email instead of sending` (the `email_log` status is `logged`)
    - `capacity floor refuses a move in demo that drains a day`: set up a day with exactly 4 public slots, and a move into one of them gives `capacity_floor`. With `DEMO_MODE=""` the same move succeeds.
    - `findOutsideHours flags an appointment after hours shrink`
  - `blocks.test.ts`:
    - `dentist blocks own time`
    - `dentist cannot block another dentist gives forbidden`
    - `block over an appointment gives block_conflict listing it, nothing inserted` (the conflicts include the patient name)
    - `weekly series of 4 inserts 4 entries sharing a seriesId`
    - `series where week 3 conflicts inserts none and lists that occurrence`
    - `delete whole series`
    - `block vs booking race: exactly one wins`
    - `multi-day leave block (Thu 00:00–Sat 00:00) removes those days from the strip`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): appointment and block mutations with demo capacity floor".

---

### Task 14: Receptionist calendar UI (day and week, drag, keyboard, dialogs)

**Files:**
- Create:
  - page and actions: `src/app/[locale]/staff/(app)/calendar/page.tsx`, `src/app/[locale]/staff/(app)/calendar/actions.ts`
  - components: `src/components/calendar/{CalendarShell,Toolbar,DayGrid,WeekGrid,EntryBlock,NowLine,AppointmentDialog,NewAppointmentDialog,BlockDialog,Counters,Legend}.tsx`
  - helpers: `src/lib/staff/calendar-data.ts`, `src/lib/calendar/geometry.ts`
- Test: `tests/unit/geometry.test.ts`, `tests/e2e/calendar.spec.ts`

**Interfaces:**
- Consumes: Task 13 mutations, Task 12 `requireActor` and `can`, Task 10 `parseMine`, Task 13 `findOutsideHours`.
- Produces:
  - **Calendar data:** `getCalendarDay(db, actor, date: string, now: Date): Promise<{ dentists: { id; name }[]; entries: CalEntry[]; counters: { appointments; arrived; noShows; freeSlotsToday }; outsideHours: string[] }>`. `CalEntry = { id; dentistId; kind; start: string; end: string; status?; patientName?; patientPhone?; treatmentName?; blockReason?; editable: boolean }`. `editable` comes from `can`. A dentist sees other dentists' entries with `editable: false`, and blocks show their reason but not the note. `getCalendarWeek(db, actor, dentistId, weekStart)` returns the same shape for 7 days of one dentist.
  - **Geometry:** `minutesToY(minFromOpen: number, pxPerMin: number): number`, `yToSnappedMinutes(y: number, pxPerMin: number, step = 15): number`, `dayBounds(clinicHours): { open: "09:00"; close: "18:00" }` (the union of the week's hours, for the grid). Use 52px per hour, matching the mockup.
  - **URL:** `/staff/calendar?view=day|week&date=YYYY-MM-DD&dentist=id`, defaulting to the Istanbul date of today. Entries whose ids are in `demo_mine` get the amber "mine" style and are labelled "★ Your booking".
  - **Drag:** `@dnd-kit/core` with each dentist column as a droppable and editable appointments as draggables. On drop it computes the snapped start and calls the `move` action. On an error it reverts and shows a toast with the localized `BookingErrorCode` message.
  - **Keyboard path:** every entry is a `<button>` that opens `AppointmentDialog` (a Radix Dialog). The dialog has status buttons, Cancel (with a confirm step) and a **Reschedule** form (date input, dentist select limited to those performing the treatment, and a time select filled from `getDaySlots` staff with `ignoreEntryId`).
  - **Dialogs:** `NewAppointmentDialog` (walk-in / new: treatment, dentist, time select, name, phone required, email optional) and `BlockDialog` (dentist — fixed to self for dentists —, start date/time, end date/time, reason, note, repeat weekly count or until). A `block_conflict` result renders the conflicts list with "Move these first" and links that open each appointment.
  - **Server actions** (all `requireActor`, returning `{ ok: true } | { ok: false; code; details? }`): `move`, `cancel`, `setStatusAction`, `createAppointment`, `createBlockAction`, `updateBlockAction`, `deleteBlockAction`, `loadStaffSlots`.
  - **Visuals:** mockup screen 3. The current-time line is red; the outside-hours appointments get a ⚠ badge and a counter "Needs attention: N".

- [ ] **Step 1: Write the failing tests.**
  - `geometry.test.ts`, with the snap rule `Math.floor(min / step) * step` and `pxPerMin = 52/60`:
    - `minutesToY(60, 52/60) === 52`
    - `yToSnappedMinutes(52, 52/60) === 60`
    - `yToSnappedMinutes(58, 52/60) === 60` (66.9 min floors to 60)
    - `yToSnappedMinutes(65, 52/60) === 75` (65px is exactly 75 min)
  - `calendar.spec.ts`:
    - `magic moment`: book as a patient (helper), click the Receptionist pill, and the calendar opens on the booking date with an entry containing "★ Your booking" and the patient name.
    - `day view shows a column per dentist and counters`.
    - `drag moves an appointment` (use `page.mouse` on a seeded future booked entry, dropped 2 hours later in the same column; it then shows at the new time, and a reload keeps it).
    - `drag onto an occupied time snaps back with a message`.
    - `keyboard reschedule`: Tab to an entry, press Enter, choose a new time in the dialog's select, Save, and the entry moves.
    - `mark arrived` changes the colour/status label.
    - `walk-in`: create one for now (phone only) and it appears.
    - `block time` for a dentist appears hatched.
    - `week view for one dentist`.
    - `axe on the calendar page` (serious/critical none).
    - `tr calendar labels are Turkish`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): receptionist calendar with drag, keyboard reschedule and dialogs".

---

### Task 15: Dentist views (today on the phone, own calendar management)

**Files:**
- Create: `src/app/[locale]/staff/(app)/today/page.tsx`, `src/components/staff/TodayList.tsx`, plus small changes to `CalendarShell` so a dentist defaults to `view=week&dentist=<own>`
- Test: `tests/e2e/dentist.spec.ts`

**Interfaces:**
- Consumes: Task 14 calendar (the same page, actions and dialogs, with permissions already enforced in Task 13).
- Produces: `getTodayForDentist(db, actor, now): Promise<{ items: { id; start; end; patientName; treatmentName; status }[]; nextId: string | null }>` in `src/lib/staff/calendar-data.ts`. `nextId` is the first booked or arrived item whose end is after now. The page renders mockup screen 4 (phone-first): greeting, date and count; the list with the next item highlighted; status buttons per item (arrived/completed/no-show); a "Block time" button (opens `BlockDialog` fixed to self); and "Open my calendar".

- [ ] **Step 1: Write the failing e2e tests** `dentist.spec.ts` (viewport 390×844 where noted):
  - `dentist lands on today with the next patient highlighted` (390px).
  - `dentist marks own patient arrived`.
  - `dentist blocks surgery time on own calendar` (a free future slot shows as a hatched "Surgery" entry).
  - `dentist block over a booked patient is refused with the conflict list` (the dialog shows "Move these first" and the patient name).
  - `dentist repeats a block weekly for 3 weeks` (the week view shows it on 3 consecutive weeks).
  - `dentist deletes own block`.
  - `dentist moves own appointment via the dialog`.
  - `dentist creates a follow-up appointment for own calendar`.
  - `other dentists' entries are visible but not editable` (no dialog actions, or the entries aren't draggable).
  - `axe on today`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): dentist today view and own calendar management".

---

### Task 16: Requests inbox and patients list

**Files:**
- Create: `src/lib/staff/requests.ts`, `src/lib/staff/patients.ts`, the pages `src/app/[locale]/staff/(app)/requests/page.tsx` + `actions.ts` and `src/app/[locale]/staff/(app)/patients/page.tsx`
- Test: `tests/integration/staff-lists.test.ts`, `tests/e2e/staff-lists.spec.ts`

**Interfaces:**
- Produces:
  - `listRequests(db, actor, filter: "new" | "contacted" | "closed" | "all"): Promise<Row[]>` (newest first), `setRequestStatus(db, actor, id, status): Promise<void>` (`requests.view` required)
  - `searchPatients(db, actor, q: string): Promise<{ id; name; phone; email; upcoming: number; past: number }[]>`. It matches name (case-insensitive, Turkish-aware via `ILIKE` on `lower()`, so the input "ayşe" finds "Ayşe") or phone digits (a normalized prefix). A dentist only gets patients with at least one appointment with them.
  - `getPatientAppointments(db, actor, patientId)`
  - The sidebar count "Requests N" shows the new requests.

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - `requests filter and status change`
    - `dentist cannot list requests` (`forbidden`)
    - `patient search by Turkish name and by phone fragment "532111"`
    - `dentist sees only own patients`
  - E2E: the receptionist marks a seeded request contacted, it moves to the Contacted filter, and the sidebar count decreases. A patient search shows their appointments.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): requests inbox and patients list".

---

### Task 17: Admin settings (view-only in demo)

**Files:**
- Create: `src/lib/staff/settings.ts`, the pages `src/app/[locale]/staff/(app)/settings/{page,dentists/page,dentists/[id]/page,treatments/page,treatments/[id]/page,hours/page}.tsx` + `actions.ts`, `src/components/staff/DemoDisabledNote.tsx`
- Test: `tests/integration/settings.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Produces, all requiring `settings.edit` (`forbidden`) and throwing `demo_disabled` when `isDemo()`:
  - `saveDentist(db, actor, input: { id?: number; slug; name; titleEn; titleTr; bioEn; bioTr; sortOrder; active; treatmentIds: number[]; hours: { weekday: number; start: string; end: string }[] }): Promise<number>`
  - `saveTreatment(db, actor, input: { id?; slug; nameEn; nameTr; descEn; descTr; durationMin: 15..240 step 15; sortOrder; active }): Promise<number>`
  - `saveClinicHours(db, actor, input: { days: { weekday; open: string | null; close: string | null }[]; lunchStart; lunchEnd }): Promise<void>`
  - `addClosedDate(db, actor, { date, labelEn, labelTr })`, `removeClosedDate(db, actor, date)`
- Saving never touches entries. Appointments now outside hours appear via `findOutsideHours` (Task 13 + the Task 14 badge).
- The pages render for `settings.view` (admin only). In demo mode every form is rendered with inputs **enabled** and **Save disabled**, plus the `DemoDisabledNote` ("Disabled in the demo, so the next visitor finds the clinic as you did"). The actions also refuse server-side.

- [ ] **Step 1: Write the failing tests.**
  - Integration (toggle `process.env.DEMO_MODE` per test):
    - `admin saves a treatment when not demo`
    - `demo refuses with demo_disabled`
    - `receptionist forbidden`
    - `shrinking dentist hours flags existing appointments` (`findOutsideHours` returns them; the entries are untouched)
    - `duration must be a multiple of 15`
  - E2E (demo server): the admin one-click lands on settings, Save is disabled and the note is visible.
  - E2E `@live` (live server): the admin signs in, changes a treatment's English name, and the public treatments page shows the new name. The admin adds a closed date, and the booking strip disables it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The admin one-click lives on the staff login page (not in the banner).
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: "feat(staff): admin settings, view-only in demo".

---

### Task 18: Quality pass, CI, README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `docs/architecture.md` (optional; the Mermaid diagram can live in the README)
- Modify: anything the sweeps below turn up
- Test: `tests/e2e/a11y.spec.ts`, `tests/e2e/demo-guards.spec.ts`

**Interfaces:**
- **CI:** on push and pull_request, Ubuntu, Node 22. Service `postgres:17-alpine` on 5433 with the same credentials. Steps: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (unit + integration), `npx playwright install --with-deps chromium`, `npm run test:e2e`. Set `CI=1`.
- **README sections:** what it is (and that it's fictional), a screenshot (`docs/screenshot.png` taken with Playwright from the calendar page), how it works (a Mermaid diagram: browser → Next.js server actions → domain modules → Postgres; the cron route → reset), **"Why double booking is impossible"** (the exclusion constraint SQL, holds, the 23P01 mapping, the concurrency tests), running locally (`npm run db:up`, `cp .env.example .env.local`, `npm run db:migrate`, `npm run demo:reset`, `npm run dev`), the env table, the demo accounts, tests, "Clinic name check" (the search done in Task 6, with the date), and "Before deploying" (Neon, CRON_SECRET, IP_HASH_SECRET, BETTER_AUTH_SECRET, RESEND, run behind a proxy that sets X-Forwarded-For).

- [ ] **Step 1: Write the failing tests.**
  - `a11y.spec.ts`: axe (serious/critical) on every public page in en and tr, plus login, calendar, today, requests, patients, settings.
  - `demo-guards.spec.ts`: as receptionist, try to block whole days for every dentist for today through the next 2 days in a loop until refused. Assert a refusal with the capacity-floor message appears, and that a fresh patient context can still book a slot on each of those days.
- [ ] **Step 2: Run them.** Fix whatever fails (contrast token tweaks get noted in the README and the spec's §4 note).
- [ ] **Step 3: Lighthouse.** Run `npx lighthouse http://localhost:3000/en --preset=desktop` against `npm run build && npm start`. Expected: ≥ 90 on all four scores. Fix and re-run if not.
- [ ] **Step 4: Write the README and CI workflow,** take the screenshot, and run the whole suite: `npm run lint && npm run typecheck && npm test && npm run test:e2e`. Expected: everything is green.
- [ ] **Step 5: Commit.** Message: "chore: accessibility sweep, CI workflow and README".
