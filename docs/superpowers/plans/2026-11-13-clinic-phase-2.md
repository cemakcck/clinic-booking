# Clinic Booking System: Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 24-hour reminders (email + simulated SMS, exactly once), a staff reminders log with a demo-only "Send my reminders now", a dashboard with period comparison over 26 weeks of generated demo history, and four phase 1 leftovers.

**Architecture:**
- Same shape as phase 1: domain logic in `src/lib/**` taking a `Db`/transaction and an injected `now`; pages and server actions are thin wrappers; permissions through `can()` in `src/lib/auth/permissions.ts`.
- Reminders: one pure-ish pass `runReminders(db, now, opts)` finds due appointments, **claims** each (appointment, channel, start) by inserting into a `reminders` table with a unique key (`ON CONFLICT DO NOTHING`), then sends/logs. The claim is the exactly-once guarantee. A protected cron route runs the pass; a GitHub Actions schedule calls it every 15 minutes.
- Dashboard: read-only aggregate queries over `entries` (appointments are ordinary rows, real or generated), scoped to the actor's own dentist for dentists.

**Tech Stack:** unchanged from phase 1 (Next.js 16.4.5, React 19.3, TS strict, Tailwind 4, next-intl 4, Zod 4, Postgres 17 + Drizzle 0.45 + drizzle-kit, Better Auth, Resend, Vitest 5, Playwright 1.65 + axe). No new runtime dependencies; charts are hand-written SVG/HTML.

**Spec:** `docs/superpowers/specs/2026-11-13-clinic-phase-2-design.md` (on top of `docs/superpowers/specs/2026-11-08-clinic-booking-design.md`).

## Global Constraints

- Repo `~/Personal/clinic-booking`, work on branch `feat/phase-2` (create from `main`). Commit identity comes from the `~/Personal/` includeIf (`Cem Akçiçek <160328866+cemakcck@users.noreply.github.com>`). Never push. Commit messages end with (after a blank line):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01G1gUztbjonzCYopjxcu6K3`
- **Never use or kill anything on ports 3000 or 3100.** Run any dev/e2e server you start on another port; kill only processes you started, by PID (never `pkill -f`). Don't stop or modify the owner's `clinic-booking-db-1` container; it is the test DB on host port 5433 and tests may use it.
- Every user-visible string in `messages/en.json` and `messages/tr.json` with identical keys (a test enforces it). Emails and SMS text in the **patient's** locale (`contactLocale ?? patient.locale`); staff UI in the staff member's locale.
- Time: Europe/Istanbul via `src/lib/time.ts` helpers only; Vitest runs with `TZ=America/New_York`.
- Demo anti-abuse (spec §3): an email only ever goes to an address a visitor typed into their own booking; per-address and per-IP daily caps (`EMAIL_CAP_PER_ADDRESS_PER_DAY=5`, `EMAIL_CAP_PER_IP_PER_DAY=10`) apply; `@example.com` is never emailed. All email goes through `sendEmail()` in `src/lib/email/send.ts`.
- Reminder constants live in `src/config/booking.ts`: `REMINDER_LEAD_HOURS = 24`, `RATE.reminders = [5, 3_600_000]`.
- Staff pages: keyboard-usable, axe-clean, AA contrast, the existing staff look (palette and components from phase 1).
- `npm run lint`, `npm run typecheck`, `npm test` green before every commit; e2e green at the end of tasks that touch UI.

## Review Focus

1. **The cron runs late** (GitHub delays a schedule by 20 min, or a run is skipped): an appointment already inside its 24 h window is still reminded on the next pass, as long as it hasn't started. Test: Task 3 `a pass that runs hours late still sends`.
2. **The visitor's own booking changed under them:** a staff member cancelled it, or moved it, before the visitor presses "Send my reminders now". Cancelled → skipped; moved → reminder for the new time. Test: Task 5 `send-now skips cancelled and uses the moved time`.
3. **Empty denominators on the dashboard:** a dentist with no working hours in the period, or a period with no started appointments. Show "—", never `NaN`, `Infinity` or a 0% that means "no data". Test: Task 6 `empty period yields nulls, not NaN`.
4. **Mixed languages:** a Turkish patient's reminder seen by an English-speaking receptionist. The SMS text stays Turkish (as sent); the log's labels are English. Test: Task 5 `log keeps the patient's SMS language`.
5. **Scheduled pass and the demo button at the same moment** on the same appointment: one reminder per channel, never two emails. Test: Task 3 `parallel passes claim once` and Task 5 `send-now racing the scheduled pass sends once`.

---

## File map

```
drizzle/0005_phase2.sql                    scheduled_at, reminders table + enum, email_trigger 'system', lower(to_address) index
src/lib/db/schema.ts                       entries.scheduledAt, reminders, reminderChannel, emailTrigger += 'system'
src/config/booking.ts                      REMINDER_LEAD_HOURS, RATE.reminders
src/lib/email/templates.ts                 EmailKind += "appointment_reminder"
src/lib/reminders/sms.ts                   smsText(): the simulated SMS line
src/lib/reminders/run.ts                   runReminders(): the pass (scheduled and send-now)
src/lib/reminders/log.ts                   listReminders(): the staff log query (masked)
src/app/api/cron/reminders/route.ts        protected trigger
.github/workflows/reminders.yml            every-15-minutes caller
src/app/[locale]/staff/(app)/reminders/{page.tsx,actions.ts}
src/components/staff/RemindersLog.tsx
src/lib/dashboard/periods.ts               periodBounds(): current + comparison windows
src/lib/dashboard/metrics.ts               dashboardData(): numbers, utilisation, heatmap
src/app/[locale]/staff/(app)/dashboard/page.tsx
src/components/staff/dashboard/{Tiles,UtilisationBars,Heatmap,PeriodPicker}.tsx
src/lib/demo/seed.ts                       26 weeks of history + past SMS log rows
```

---

### Task 1: Schema: scheduled time, reminders table, email index

**Files:**
- Create: `drizzle/0005_phase2.sql` (+ drizzle meta via `npm run db:generate`, then hand-edit for the backfill and the expression index)
- Modify: `src/lib/db/schema.ts`, `src/lib/booking/holds.ts` (`confirmBooking`), `src/lib/staff/appointments.ts` (staff-created appointment insert, ~line 206), `src/lib/booking/entries.ts` (`moveEntry` update, ~line 114), `src/lib/demo/reset.ts` and `tests/integration/helpers/db.ts` (add `reminders` to both TRUNCATE lists), `src/config/booking.ts`
- Test: `tests/integration/scheduled-at.test.ts`, `tests/integration/reminders-schema.test.ts`

**Interfaces:**
- Produces:
  - `entries.scheduledAt: timestamptz NOT NULL DEFAULT now()`; migration backfills `scheduled_at = created_at`. Meaning (spec §4.1): the last time the appointment's start was set.
  - `reminderChannel = pgEnum("reminder_channel", ["email", "sms"])`
  - `reminders` table: `id uuid pk default random`, `entryId uuid not null → entries.id (on delete cascade)`, `channel reminderChannel not null`, `startsAt timestamptz not null` (the appointment start this reminder is for), `status text not null` (`"pending" | EmailStatus | "simulated"`), `toAddress text` (E.164 phone for SMS, normalised email for email; null if none), `locale text not null`, `body text not null` (SMS text, or the email subject), `source text not null` (`"schedule" | "send_now"`), `createdAt timestamptz not null default now()`; `UNIQUE (entry_id, channel, starts_at)`; index on `created_at`.
  - `emailTrigger` enum gains `"system"`.
  - Index `email_log_to_address_lower_idx ON email_log (lower(to_address))` (phase 1 leftover #3).
  - `REMINDER_LEAD_HOURS = 24`; `RATE.reminders = [5, 3_600_000]`.

- [ ] **Step 1: Write failing tests**
  - `scheduled-at.test.ts`: `confirmBooking sets scheduledAt to now`; `a staff-created appointment sets scheduledAt to now`; `moveEntry (reschedule) updates scheduledAt to now`; `a status change (arrived) leaves scheduledAt unchanged`. Use the phase 1 fixture (`seedFixture`, `NOW_ISO`) and distinct `now` values per step so the assertion is exact (`toEqual(new Date(...))`).
  - `reminders-schema.test.ts`: `a second reminder for the same entry, channel and start is rejected` (`pgCode(e) === "23505"`); `the same entry and channel at a new start is allowed`; `email_log has an index on lower(to_address)` (query `pg_indexes`).
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/scheduled-at.test.ts tests/integration/reminders-schema.test.ts` → FAIL (column/table missing).
- [ ] **Step 3: Implement** schema + migration (`ALTER TYPE email_trigger ADD VALUE 'system'` must run outside a transaction block if drizzle wraps it — check the migrator; split into its own statement-breakpoint), set `scheduledAt: now` in the three write paths, add `reminders` to both TRUNCATE lists, add the constants.
- [ ] **Step 4: Run** `npm run db:migrate` against the test DB setup the integration global-setup uses, then the tests → PASS; then `npm test`.
- [ ] **Step 5: Commit** `feat(db): scheduled time on appointments, reminders table, email address index`

---

### Task 2: Reminder content (email template + SMS line)

**Files:**
- Modify: `src/lib/email/templates.ts` (new kind `"appointment_reminder"`), `messages/en.json`, `messages/tr.json` if templates read from them (follow the existing template pattern)
- Create: `src/lib/reminders/sms.ts`
- Test: `tests/unit/email-templates.test.ts` (extend), `tests/unit/sms.test.ts`

**Interfaces:**
- Consumes: `renderEmail(kind, locale, data)` and its data shape (`patientName, treatmentName, dentistName, start`), `AppointmentView` from `src/lib/booking/notify.ts`, `clinic` from `src/config/clinic.ts`.
- Produces:
  - `renderEmail("appointment_reminder", locale, { patientName, treatmentName, dentistName, start })` → `{ subject, html, text }`.
  - `smsText(locale: Locale, a: { dentistName: string; start: Date }, now: Date): string`.

**Ruling (plan vs spec §4.3):** the spec asks for the manage link in the reminder, but phase 1 stores only the **hash** of the manage token, so the link cannot be rebuilt, and issuing a new token would silently kill the link in the confirmation email. The reminder instead says: "To change or cancel, use the link in your confirmation email, or call us at {phone}" (TR equivalent), and inside 24 h the manage page already tells them to call. Cost if wrong: one extra token column later.

- [ ] **Step 1: Failing tests**
  - `email-templates.test.ts`: `reminder subject (EN) is "Reminder: your appointment tomorrow at 14:00"` and TR `"Hatırlatma: yarın 14:00 randevunuz"` when `start` is tomorrow 14:00 Istanbul relative to the test clock; when not tomorrow, the date is spelled with `formatLongDate`. Body contains dentist, treatment, clinic address and phone, and **no** `/booking/` URL. Subject has no CR/LF.
  - `sms.test.ts`: `EN tomorrow` → `"Nova Dental: reminder, your appointment with {dentist} is tomorrow at 14:00. To change it call {phone}."`; `TR tomorrow` → `"Nova Dental: yarın 14:00'te {dentist} ile randevunuz var. Değişiklik için: {phone}"`; a non-tomorrow start uses the short date (`"on 18 Nov"` / `"18 Kasım"`); **every** output ≤ 160 characters for the longest dentist name in `clinic-data.ts`; times are Istanbul regardless of `TZ`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/sms.test.ts tests/unit/email-templates.test.ts` → FAIL.
- [ ] **Step 3: Implement** both (`{dentist}` is the dentist's display name; `{phone}` is `clinic.phone` as displayed on the site).
- [ ] **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(reminders): reminder email and SMS text, EN and TR`

---

### Task 3: The reminder pass

**Files:**
- Create: `src/lib/reminders/run.ts`
- Modify: `src/lib/email/send.ts` (accept trigger `"system"`; `decide()` treats only `"staff"` as staff-triggered)
- Test: `tests/integration/reminders-run.test.ts`

**Interfaces:**
- Consumes: Task 1 schema, Task 2 `renderEmail`/`smsText`, `loadAppointment` (`src/lib/booking/notify.ts`), `sendEmail`, `appointmentIcs`.
- Produces:
  ```ts
  export type ReminderSource = "schedule" | "send_now";
  export type ReminderRunResult = { considered: number; sms: number; emails: Record<EmailStatus, number>; skipped: number };
  export async function runReminders(
    db: Db,
    now: Date,
    opts?: { onlyEntryIds?: string[]; ipHash?: string; deps?: EmailDeps },
  ): Promise<ReminderRunResult>;
  ```
  - Without `onlyEntryIds` (source `"schedule"`): due = `kind='appointment' AND active AND status='booked' AND lower(during) > now AND lower(during) <= now + 24h AND scheduled_at <= lower(during) - 24h`.
  - With `onlyEntryIds` (source `"send_now"`, spec §4.5): due = those ids that are `kind='appointment' AND active AND status='booked' AND lower(during) > now`; window and booked-late rules **ignored**.
  - Per due appointment and channel: `INSERT … ON CONFLICT (entry_id, channel, starts_at) DO NOTHING RETURNING id` with `status='pending'`; only a returned row proceeds. SMS → update to `status='simulated'`, `body=smsText(...)`, `toAddress=phone`. Email → if the booking has an email, call `sendEmail` (kind `appointment_reminder`, trigger `"system"` for schedule / `"patient"` with `opts.ipHash` for send_now, `.ics` attached, `appointmentId`), then update the row with the returned status and `body=subject`; with no email address, record `status='suppressed'`. Failed sends are not retried (spec §4.2).
  - Never throws for one bad appointment; logs and continues.

- [ ] **Step 1: Failing tests** (fixed `now`, phase 1 fixture; `deps.resend` stub where a send is expected; `RESEND_API_KEY` unset unless stubbed):
  - `sends one SMS and one email for an appointment 23h ahead booked 3 days ago`
  - `skips an appointment 25h ahead` and `skips one starting now or in the past`
  - `skips one booked 20h before its start (booked late)`
  - `skips cancelled, arrived, no-show and holds/blocks`
  - `a second pass sends nothing more`
  - `parallel passes claim once`: `Promise.all` of 5 passes → exactly one `reminders` row per channel and one `email_log` row.
  - `moved after its reminder: the new start gets a new reminder` (and the old row stays)
  - `moved to within 24h of its start: no reminder (scheduledAt reset)`
  - `a pass that runs hours late still sends` (appointment 2h ahead, scheduled long ago, no reminder yet)
  - `seeded @example.com patient: SMS simulated, email suppressed, nothing sent`
  - `no email on the booking: SMS only, email row suppressed`
  - `send_now ignores window and booked-late but not status or past starts`
  - `send_now passes the visitor ipHash so the per-IP cap applies` (pre-fill `email_log` to the cap → email row `capped`)
  - `in demo mode a scheduled reminder to a visitor-typed address is sent, not logged` (DEMO_MODE=1, trigger system)
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/reminders-run.test.ts` → FAIL.
- [ ] **Step 3: Implement** `runReminders` and the `send.ts` trigger change.
- [ ] **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(reminders): exactly-once reminder pass`

---

### Task 4: Cron route and GitHub Actions schedule

**Files:**
- Create: `src/app/api/cron/reminders/route.ts`, `.github/workflows/reminders.yml`
- Modify: `docs/DEPLOY.md` (repository secrets `REMINDERS_URL`, `CRON_SECRET`; GitHub may delay schedules and disables them after 60 days without repo activity), `.env.example` (comment only)
- Test: `tests/integration/cron-reminders.test.ts`

**Interfaces:**
- Consumes: `runReminders` (Task 3).
- Produces: `GET /api/cron/reminders` — `401` unless `Authorization: Bearer ${CRON_SECRET}` (same check as `/api/cron/reset`); otherwise runs `runReminders(await db(), new Date())` and returns `200 { ok: true, ...ReminderRunResult }`. Works with and without demo mode (unlike reset).
- Workflow: `on: schedule: - cron: "*/15 * * * *"` plus `workflow_dispatch`; one job: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$REMINDERS_URL"`; skips (exits 0 with a notice) when `REMINDERS_URL` is unset so the public repo's forks don't fail.

- [ ] **Step 1: Failing tests:** `401 without or with a wrong bearer`; `200 runs the pass and returns counts` (call the exported `GET` with a `Request`; a due appointment in the test DB gets its SMS row). If the route reads the shared `db()` rather than an injectable one, follow how phase 1 tests exercise route handlers or point it at the test DB the same way.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx actionlint` if available, otherwise check the YAML parses (`node -e "require('yaml')"` is not a dep — use `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/reminders.yml`).
- [ ] **Step 5: Commit** `feat(reminders): cron route and 15-minute GitHub Actions schedule`

---

### Task 5: Reminders log and "Send my reminders now"

**Files:**
- Create: `src/lib/reminders/log.ts`, `src/app/[locale]/staff/(app)/reminders/page.tsx`, `src/app/[locale]/staff/(app)/reminders/actions.ts`, `src/components/staff/RemindersLog.tsx`
- Modify: `src/lib/auth/permissions.ts` (`"reminders.view"`: receptionist ✓, admin ✓, dentist ✗), `src/app/[locale]/staff/(app)/layout.tsx` (nav item after Requests), `messages/{en,tr}.json` (`staff.reminders.*`, `nav.reminders`)
- Test: `tests/unit/permissions.test.ts` (extend), `tests/integration/reminders-log.test.ts`, `tests/e2e/reminders.spec.ts`

**Interfaces:**
- Consumes: `reminders` table, `runReminders` (Task 3), `parseMine`/`MINE_COOKIE` (`src/lib/demo/mine.ts`), `maskPhone`/`maskEmail` (`src/lib/demo/mask.ts`), `checkAndRecordRate(db, "reminders", ipHash, now)`, `isDemo()`, the phase 1 client-IP hash helper.
- Produces:
  ```ts
  export type ReminderRow = { id: string; createdAt: Date; channel: "email" | "sms"; status: string; patientName: string;
    contact: string | null; body: string; appointment: { id: string; start: Date; dentistName: string } };
  export const REMINDER_LOG_LIMIT = 100;
  export async function listReminders(db: DbOrTx, actor: Actor,
    q: { from: string; to: string; channel: "all" | "email" | "sms"; mine: string[] }): Promise<ReminderRow[]>;
  ```
  `from`/`to` are Istanbul dates (inclusive; default last 7 days ending today); newest first; capped at `REMINDER_LOG_LIMIT` (the page says "showing the latest 100" when capped). Throws/denies unless `can(actor, "reminders.view")`. In demo mode, `contact` is masked unless the appointment id is in `mine` (phase 1 masking rule); `status='pending'` rows are excluded.
  - Server action `sendMyRemindersNow(locale)`: demo mode only (otherwise 404-equivalent error); requires `reminders.view`; reads `MINE_COOKIE`; rate-limited `RATE.reminders` per IP hash; with an empty list returns `{ ok: false, reason: "no_bookings" }`; else `runReminders(db, now, { onlyEntryIds: mine, ipHash })` and returns the counts. The page then re-renders.
- UI (spec §5): filters (date range, channel) as GET params; table columns time, channel, patient, contact, appointment (date, time, dentist; links to the calendar day), outcome (translated status label), message text for SMS. Demo mode: the button "Send my reminders now" / "Hatırlatmalarımı şimdi gönder" at the top; `no_bookings` shows "Book an appointment first, then come back" with a link to `/book`; `rate_limited` shows the phase 1 rate-limit message.

- [ ] **Step 1: Failing tests**
  - permissions: `reminders.view is allowed for receptionist and admin, not dentist`.
  - integration: `lists newest first within the date range and channel filter`; `dentist is denied`; `masks other visitors' contacts in demo mode but not mine`; `log keeps the patient's SMS language` (TR row stays TR); `pending rows are hidden`; `send-now skips cancelled and uses the moved time`; `send-now racing the scheduled pass sends once` (`Promise.all([runReminders(db, now), runReminders(db, now, { onlyEntryIds: [id] })])` → one row per channel); `send-now outside demo mode is refused`; `send-now with no bookings returns no_bookings`; `send-now is rate limited after 5 per hour`.
  - e2e `reminders.spec.ts` (independent of time of day): book the first available slot as a patient with a real-looking address (e.g. `e2e-reminder@nova-test.dev`, demo mode on, `RESEND_API_KEY` unset → email `logged`), switch to Receptionist via the demo role switch, open Reminders, press "Send my reminders now" → a row with channel SMS containing "Nova Dental" and a row with channel Email for that appointment appear; the contact is unmasked for this visitor; axe passes on the page; same flow headline check in TR.
- [ ] **Step 2: Run** the unit + integration tests → FAIL.
- [ ] **Step 3: Implement** the query, permission, action, page, nav, messages.
- [ ] **Step 4: Run** unit, integration → PASS; `npx playwright test tests/e2e/reminders.spec.ts` → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(staff): reminders log with demo send-now`

---

### Task 6: Dashboard data

**Files:**
- Create: `src/lib/dashboard/periods.ts`, `src/lib/dashboard/metrics.ts`
- Modify: `src/lib/auth/permissions.ts` (`"dashboard.view"`: receptionist ✓, admin ✓, dentist `"own"`-style: allowed, but data scoped — model it as `true` for all three and scope inside `dashboardData`)
- Test: `tests/unit/periods.test.ts`, `tests/integration/dashboard.test.ts`

**Interfaces:**
- Consumes: `entries`, `working_hours`, `clinic_hours`, `clinic_settings` (lunch), `closed_dates`, blocks (entries `kind='block'`), the slot engine's `effectiveHours` (`src/lib/slots/engine.ts`) for per-day working intervals; `src/lib/time.ts`.
- Produces:
  ```ts
  export type Period = "week" | "4w" | "3m";
  export type Window = { start: Date; end: Date };
  export function periodBounds(period: Period, now: Date): {
    current: Window;          // week: Monday 00:00 Istanbul → now; 4w: now-28d → now; 3m: now-91d → now
    previous: Window;         // week: last Monday 00:00 → now-7d; 4w/3m: the equal window before current
    utilisation: Window;      // week: Monday 00:00 → next Monday 00:00 (whole week); 4w/3m: = current
  };
  export type Headline = { appointments: number; cancellations: number; noShowRate: number | null; online: number; staff: number };
  export type DashboardData = {
    period: Period; scope: { dentistId: number | null };
    current: Headline; previous: Headline | null;   // null when the previous window has no appointments at all
    utilisation: { dentistId: number; name: string; bookedMin: number; workingMin: number; ratio: number | null }[];
    heatmap: { weekday: number; hour: number; count: number }[];  // Istanbul weekday 1–7 (Mon=1), clinic opening hours only
  };
  export async function dashboardData(db: DbOrTx, actor: Actor, period: Period, now: Date): Promise<DashboardData>;
  ```
  Definitions exactly as spec §6.3: appointments = start in window, not cancelled; cancellations counted separately; `noShowRate = no_show / (completed + arrived + no_show)` over appointments in the window that have started (`lower(during) <= now`), `null` when the denominator is 0; online/staff by `source`; utilisation booked minutes of non-cancelled appointments ÷ working minutes (working hours ∩ clinic hours, minus lunch, closed dates and blocks), `ratio=null` when `workingMin=0`; heatmap counts non-cancelled appointment starts in the current window. A dentist actor gets `scope.dentistId = actor.dentistId` and every number filtered to it (utilisation has one row).

- [ ] **Step 1: Failing tests**
  - `periods.test.ts`: Wednesday 2026-11-18 10:30 Istanbul → week current `Mon 16 00:00 → now`, previous `Mon 9 00:00 → Wed 11 10:30`, utilisation `Mon 16 → Mon 23`; on a Monday 08:00 the week windows are 8 h long; 4w/3m are exact 28/91-day spans; results identical under `TZ=America/New_York`.
  - `dashboard.test.ts` on a hand-made dataset (insert entries directly, fixed `now`): `counts appointments and cancellations in the window`; `no-show rate ignores upcoming appointments`; `online vs staff split`; `utilisation subtracts lunch, closed dates and blocks`; `heatmap buckets by Istanbul weekday and hour`; `a dentist sees only their own numbers` (and the result contains no other dentist id or name); `previous is null when the previous window is empty`; `empty period yields nulls, not NaN` (a dentist with no hours: `ratio === null`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (SQL aggregates for counts/heatmap; working minutes computed per day in TS from the hours tables — a 91-day window × 4 dentists is small). **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(dashboard): period windows and metrics`

---

### Task 7: Dashboard page

**Files:**
- Create: `src/app/[locale]/staff/(app)/dashboard/page.tsx`, `src/components/staff/dashboard/{Tiles,UtilisationBars,Heatmap,PeriodPicker}.tsx`
- Modify: staff layout nav (Dashboard first for all roles), `messages/{en,tr}.json` (`staff.dashboard.*`, `nav.dashboard`)
- Test: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: `dashboardData`, `periodBounds` (Task 6).
- Produces: `/[locale]/staff/dashboard?period=week|4w|3m` (default `week`; unknown values fall back to `week`).
  - Tiles: Appointments, No-show rate, Online share, Cancellations; each with the comparison "↑ 12% vs last week" / "vs previous 4 weeks" / "vs previous 3 months" (TR equivalents), no arrow when `previous` is null or the base is 0; "—" for null values. Direction is shown by arrow **and** text, not colour alone.
  - Utilisation: one horizontal bar per dentist with the percentage written next to it; the week view is labelled "Includes appointments already booked for the rest of the week".
  - Heatmap: weekday × hour grid with the count printed in each cell (no colour-only encoding), plus a visually hidden table with the same numbers.
  - Period picker: links (not JS-only) with `aria-current` on the active one.
- [ ] **Step 1: Failing e2e** `dashboard.spec.ts`: receptionist sees four tiles, utilisation rows for every active dentist and a heatmap; switching to "Last 4 weeks" changes the URL and the comparison label; the dentist role sees one utilisation row (their own name) and no other dentist's name anywhere on the page; axe passes; TR headings render. (Uses the seeded demo data from Task 8 if it has landed; otherwise assert structure, not values. Run Task 8 before re-running this spec at the end.)
- [ ] **Step 2: Run** `npx playwright test tests/e2e/dashboard.spec.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(staff): dashboard page`

---

### Task 8: 26 weeks of demo history

**Files:**
- Modify: `src/lib/demo/seed.ts`, `src/content/clinic-data.ts` (more `@example.com` patients if needed for believable variety: at least 60)
- Test: `tests/integration/seed.test.ts` (extend)

**Interfaces:**
- Consumes: the existing deterministic seed loop and `FILL_PROBABILITY`, `NO_SHOW_RATE`, `CANCELLED_RATE`, `mulberry32`.
- Produces: `seedClinic` also generates appointments for the 182 days before this week's Monday (same per-day logic; past ones get `completed`/`arrived`/`no_show` as today; lower `FILL_PROBABILITY` on the oldest weeks is fine for a gentle growth trend), sets `scheduledAt` on every seeded appointment to `start − (2…20 days)` (deterministic), and inserts past SMS reminder rows for seeded non-cancelled appointments that started in the last 14 days (`status='simulated'`, `source='schedule'`, `createdAt = start − 24h`, `body = smsText(...)`). No email rows for seeded patients. Inserts stay chunked (existing `CHUNK=200`).
  **Ruling:** past reminder rows only for the last 14 days (the log defaults to 7) to keep the nightly reset quick; cost if wrong: an older filter shows an empty log.
- [ ] **Step 1: Failing tests:** `history spans 26 weeks before this week`; `no-show rate over history is between 5% and 11%`; `both sources appear in every week`; `seeded appointments are scheduled at least 2 days ahead`; `past SMS reminder rows exist for the last 14 days and none for older`; `no email_log rows after seeding`; `seeding twice with the same now is identical` (compare counts and a hash of `(dentist, start, status)`); `dashboardData has a previous period for week, 4w and 3m`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; time `npm run demo:reset` against the dev DB and note it in the commit body (target: under 10 s); `npm test`; re-run `tests/e2e/dashboard.spec.ts`.
- [ ] **Step 5: Commit** `feat(demo): 26 weeks of believable history and past reminder log`

---

### Task 9: Phase 1 leftovers

**Files:**
- Modify: `src/lib/booking/holds.ts` (`confirmBooking`), `src/lib/staff/settings.ts` (+ the dentists settings pages/forms if they hide inactive dentists), `src/config/clinic.ts` (only if the map text is wrong)
- Test: `tests/integration/holds.test.ts`, `tests/integration/settings.test.ts`, `tests/unit/clinic-config.test.ts` (extend)

**Interfaces:** none new.
- [ ] **Step 1: Failing tests**
  - `confirm refuses a hold whose dentist was deactivated after the hold was placed` → `BookingError` with the code the wizard already maps to "slot no longer available" (reuse an existing code; don't add UI).
  - `admin can open and save an inactive dentist who still has future appointments`, and `can reactivate them` (`getDentist` returns them; `saveDentist` with `active: true` succeeds).
  - `contact map text names the same street and district as the clinic address` (compare against `clinic.address`).
- [ ] **Step 2: Run** → FAIL (the map test may already pass; then it stays as a pin and the config is unchanged). **Step 3: Implement.** **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Commit** `fix: phase 1 leftovers (deactivated dentist holds, editing inactive dentists)`

---

### Task 10: Docs and final verification

**Files:**
- Modify: `README.md` (features: reminders, log, send-now, dashboard; screenshots of the dashboard and reminders log added to `docs/screenshots/`; test counts), `docs/DEPLOY.md` (reminders schedule from Task 4 is already there; check)
- [ ] **Step 1:** Capture two screenshots (EN, receptionist) against a dev server on a free non-3000 port with demo data; keep each under 200 KB.
- [ ] **Step 2:** `npm run lint && npm run typecheck && npm test && npm run test:e2e` → all green (first e2e run on a cold `.next` may time out on compile; rerun once and report).
- [ ] **Step 3: Commit** `docs: README for reminders and dashboard`
