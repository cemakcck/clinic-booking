# Clinic Booking System: Design

**Date:** 2026-11-08 · **Status:** draft for owner approval
**Visual reference:** `docs/design-reference/mockups-v1.html`. Open it in a browser and use **direction A, "Calm clinical"** (the default when the page loads). The mockup predates two owner decisions that this document overrides: **no prices anywhere** (§6.2) and **dentists manage their own calendar** (§7.3). Direction B in that file is rejected.

---

## 1. Intent: why this exists

This is the first showcase project for Cem Akçiçek's portfolio (`~/Personal/portfolio`). The portfolio links to it from a short project page, and its "Visit the app" button opens this app on its own subdomain. The app has two audiences, and both should leave impressed within about 60 seconds:

1. **A clinic owner (a potential freelance client).** They should think "I want exactly this for my clinic." What sells it is a real, working product they can click through, not screenshots.
2. **A recruiter or hiring manager.** They should think "this person can build a real full-stack system properly": data integrity, roles, background jobs, tests, clean architecture.

**The magic moment:** a visitor books an appointment as a patient, clicks "Try it as Receptionist", and sees their own booking, highlighted, in the clinic's calendar. Everything should be built so that this moment works perfectly.

The app is a demo of a **fictional dental clinic in Istanbul** (Kadıköy). Dental clinics fit because Istanbul has a large dental-tourism market, so a Turkish + English site is a real need, and it is the kind of client Cem could realistically win.

## 2. Goals, non-goals, anti-goals

**Goals, phase 1 (complete and demo-able on its own)**
- Public clinic website (EN + TR): home, treatments, dentists, international patients, contact.
- Online booking: treatment → dentist (or "anyone available") → time → details → confirmation.
- Confirmation email with an "Add to calendar" (.ics) file and a private manage-booking link (cancel or reschedule).
- Staff area: receptionist calendar (day and week views, one column per dentist, drag to reschedule, statuses, walk-ins, blocking time), dentist view (own day and own calendar management, §7.3), admin settings (dentists, working hours, treatments).
- Call-back requests from the public site land in a staff "Requests" inbox.
- Demo mode: banner + one-click "Try it as Patient / Receptionist / Dentist", demo guards (§10), and the nightly demo reset (moved into phase 1 by owner decision).

**Goals, phase 2**
- Reminder email 24 hours before each appointment. SMS/WhatsApp reminders are **simulated**: written to a reminders log visible to staff, never actually sent.
- Dashboard (bookings this week, no-show rate, online vs. staff-created bookings, chair utilisation, busiest hours).

**Non-goals**
- **Prices on the website. Never.** The owner was explicit: real clinics don't publish prices. Pricing is "contact the clinic" (§6.2).
- Payments or deposits, insurance, invoicing.
- Multiple clinics / SaaS sign-up.
- Patient accounts or patient logins (patients use the manage-booking link).
- Medical records, treatment notes, X-rays or any health data beyond "which treatment the appointment is for".
- Real SMS/WhatsApp sending.
- Native mobile apps (the web app must work well on phones).
- Deployment, hosting and the subdomain. Like the portfolio, it is built and finished **locally first**; deployment is a later step. The design must not block it (target: Postgres on Neon, app on Vercel or similar).

**Anti-goals: failure even if it technically works**
- **A double booking is ever possible**, by any path (two patients at once, receptionist drag, dentist block, walk-in).
- Looks like a template or an admin-theme starter. It should look like a real clinic's product that a freelancer delivered.
- Someone mistakes it for a real clinic: the demo banner is always visible, the clinic name is clearly invented, and the contact details are obviously fictional.
- Demo features can be abused to email or spam strangers.
- A visitor gets stuck: an empty calendar, no free slots, a confusing role switch, or a broken flow because some other visitor changed the data.

## 3. Constraints

- **Stack (owner-approved):** Next.js (App Router) + TypeScript (strict) + Tailwind CSS, **PostgreSQL + Drizzle ORM**. Postgres was chosen specifically for its database-level rule against overlapping time ranges (§8). Use the same major versions the portfolio uses (Next 16, React 19, Tailwind 4, next-intl 4, Zod 4, Vitest, Playwright) unless there is a reason not to.
- **Location and identity:** `~/Personal/clinic-booking`, a new git repo. The existing git `includeIf` rule for `~/Personal/` makes commits use `Cem Akçiçek <160328866+cemakcck@users.noreply.github.com>`. The GitHub repo will be `cemakcck/clinic-booking` (public eventually). Never use the work account or work email.
- **Built from scratch.** Nothing from Cem's employer (NDA), no copied templates.
- **Local development:** Docker is installed (29.x), so local Postgres can run in Docker Compose. The test suite must be runnable with one command and no manual database setup beyond Docker (or an embedded Postgres; builder's choice, but the overlap rule must be tested against real Postgres semantics).
- **Secrets** stay server-side in `.env.local` (git-ignored), with `.env.example` committed. The app must run locally with **no email API key** (emails are then written to the console/log instead of being sent).
- **Time:** everything is Europe/Istanbul (UTC+3, no daylight saving). Store timestamps as `timestamptz`, display in Istanbul time, and never depend on the server's or browser's timezone.
- **Languages:** English and Turkish for everything public, including emails and the simulated SMS text. The staff area is also EN + TR. URL scheme like the portfolio (`/en/...`, `/tr/...`).
- **Privacy (KVKK-minded):** store only name, phone, email, and the appointment. A short privacy note on the booking form says it's a demo and data is wiped nightly.

## 4. Visual design (decided)

Direction **A, "Calm clinical"**, from the mockup:

- Background white `#ffffff`, soft panel `#eef6f4`, ink `#10302e`, muted text `#5d7472`, brand teal `#0f5e5a`, secondary teal `#1f8a7f`, mint accent `#7fd1c1`, lines `#d9e6e3`.
- Typeface: Plus Jakarta Sans for headings and body.
- Rounded corners (about 14px), soft panels, generous whitespace, clear buttons.
- Calendar status colours, as in the mockup: booked blue, arrived green, no-show red, "just booked by you" amber highlight, blocked time grey hatching.
- Light mode only. Responsive down to phone width. WCAG AA contrast (adjust token shades slightly if a pairing fails, and note it).
  - *Note (Task 18 sweep):* the decorative "404" numeral on the not-found page used mint accent `#7fd1c1` on soft `#eef6f4` (1.6:1); it now uses secondary teal `#1f8a7f` (3.8:1, AA for large text). No palette token changed.
- The demo banner sits above everything, dark ink background, with the role pills and "Data resets nightly".
- The clinic photo in the mockup is a placeholder. Use licence-free imagery (e.g. Unsplash) or tasteful illustration, with no real clinic's photos.

## 5. The clinic (fictional content)

- **Name:** "Nova Dental" is a placeholder. Choose an invented name and check it isn't a real Istanbul clinic (builder's call; record the check in the README).
- **Location:** Kadıköy, Istanbul. Use a fictional address, phone and email, clearly fake (e.g. a 555 phone number).
- **Dentists:** 4, each with a name, specialty, short bio (EN + TR), photo/illustration, and which treatments they perform.
- **Treatments:** about 6–8 (e.g. check-up & cleaning 30 min, filling 45, whitening 60, implant consultation 45, aligner consultation 45, root canal 90, child check-up 30), each with a duration, a description (EN + TR), and which dentists can do it. **No prices.**
- **Hours:** for example Mon–Fri 09:00–18:00 and Sat 10:00–14:00, closed Sunday, lunch 12:30–13:30. Each dentist has their own weekly hours inside the clinic's.

## 6. Public website

### 6.1 Pages
Home (hero, "Next free slot" card computed live, treatments, dentists, trust/reviews marked as demo, CTA), Treatments (list + detail), Our dentists, International patients (English-speaking staff, how booking from abroad works), Contact (fictional map/address, hours, call-back form), Book.

### 6.2 Pricing: "contact the clinic"
Wherever a price would appear (treatment cards, treatment pages, booking summary), show "Pricing: contact the clinic for a quote" with two actions: call (the fictional phone number) and **"Request a call back"**. That form asks for name, phone, preferred language, treatment of interest and an optional message. Each request lands in the staff **Requests** inbox, where staff mark it as new, contacted or closed. The booking flow never shows a price.

### 6.3 Booking flow (4 steps, as in the mockup)
1. **Treatment.**
2. **Dentist:** only those who perform it, or "Anyone available".
3. **Time:** a 7-day strip (navigable up to the booking horizon) and that day's free start times, grouped Morning/Afternoon. **Only free times are shown.** (The struck-through taken times in the mockup were for illustration.) Days with nothing free are disabled. Picking a time places a **5-minute hold** (§8).
4. **Your details:** name, phone, email, language, a privacy checkbox. Submit → confirmation page: summary, "Add to calendar" (.ics), "You'll get an email", and the manage link.

Bot protection: a honeypot field plus rate limiting per IP (the same approach as the portfolio). A captcha is out of scope for now.

### 6.4 Manage-booking link
- The confirmation email and page contain a link with a long random token, stored hashed.
- On that page the patient sees their appointment and can **cancel** or **reschedule** (the same time picker), up to **24 hours before** the start. After that, the page says to call the clinic.
- The link stops working once the appointment has passed.

## 7. Staff area

Staff sign in at `/{locale}/staff`. Real accounts with passwords exist (use an established auth library rather than hand-rolling, e.g. Better Auth or Auth.js; builder's choice). In demo mode, the login page and the demo banner offer one-click role buttons that sign in as a seeded user for that role.

### 7.1 Roles and permissions

| Can… | Receptionist | Dentist | Admin |
|---|---|---|---|
| See the full clinic calendar (all dentists) | ✓ | ✓ (read-only for other dentists) | ✓ |
| Create, move or cancel any appointment, add walk-ins | ✓ | own only: see §7.3 | ✓ |
| Mark arrived / no-show / completed | ✓ | own patients | ✓ |
| Block time for a dentist | ✓ (any dentist) | own calendar | ✓ |
| Requests inbox (call-backs) | ✓ | – | ✓ |
| Patients list (search by name/phone, see past/future appointments) | ✓ | own patients | ✓ |
| Edit dentists, working hours, treatments, clinic hours | – | – | ✓ |
| Dashboard (phase 2) | ✓ | own numbers | ✓ |
| Reminders log (phase 2) | ✓ | – | ✓ |

**Staff accounts (Claude's call):** accounts are created by the seed and by a CLI script (`create-user`, with role and, for dentists, the linked dentist profile). Every dentist login is linked to exactly one dentist profile. There is no in-app user management, invite flow or password-reset email in this project. Cost if wrong: a later add-on screen.

The demo offers Patient, Receptionist and Dentist. Admin is a fourth seeded account, reachable from the staff login (its one-click button can sit there).

### 7.2 Receptionist calendar
As in the mockup: day view with one column per dentist, and a week view (a dentist selector, or all dentists condensed; builder's call). Toolbar: previous/today/next, Day/Week, "Block time", "+ Walk-in" / new appointment. Counters: appointments, arrived, no-shows, free slots left today. Current-time line. **Drag** an appointment to a new time or another dentist's column (only dentists who perform that treatment). If the database refuses the move (overlap, outside hours), it snaps back with a clear message. Click an appointment for details: patient, phone, treatment, status buttons, reschedule, cancel. There must be a keyboard-accessible way to reschedule, not only dragging.

### 7.3 Dentist: manages their own calendar (owner requirement)
A dentist is **not read-only**. On their own calendar they can:
- **Add unavailable time:** a block with a reason (Surgery, Meeting, Personal, Leave, Other + optional note), from a few minutes to several days. Optionally repeating weekly, for a set number of weeks or until a date.
- **Edit or remove** their own blocks.
- **Change the status** of their own patients' appointments (arrived, completed, no-show).
- **Move their own appointments** to another free time on their own calendar (not to another dentist).
- **Create appointments** on their own calendar (e.g. a follow-up) and **cancel** their own appointments. *(Claude's call: resolves the permission table's "own only"; cost if wrong: two buttons to remove.)*

**Blocking time that already has appointments:** the block is refused and the conflicting appointments are listed with a "move these first" message. The dentist (or reception) moves or cancels them first. *(Claude's call: this keeps the rule simple and the "no overlaps, ever" guarantee intact; cost if wrong: one extra step for the dentist.)*

The dentist's phone view (mockup screen 4) is their default landing page: today's patient list with the next patient highlighted, plus a "Block time" button and a link to their full calendar.

### 7.4 Admin settings
CRUD for dentists (profile, treatments they perform, weekly hours, active/inactive), treatments (name, description EN+TR, duration, active), clinic hours and closed dates (public holidays). Changing hours never deletes existing appointments; appointments that now fall outside hours are flagged for reception.

## 8. Booking rules and data integrity (the core)

- **Slot grid:** start times every 15 minutes. A start time is offered only if the **whole treatment** fits inside that dentist's working hours, outside lunch/blocks/closed days, and doesn't overlap any appointment or active hold.
- **Booking window:** from 2 hours ahead up to 60 days ahead (public). Staff may book any free time, including the past hour for walk-ins.
- **Holds:** picking a time creates a hold for 5 minutes. Holds occupy the time exactly like an appointment, so two patients can't both reach step 4 with the same slot. Confirming turns the hold into the appointment; expiry frees it.
- **"Anyone available":** choose among the dentists who perform the treatment and are free at that time, preferring the one with the fewest appointments that day (tie: stable order).
- **The non-negotiable rule:** for any dentist, **no two active time entries overlap**: appointments, holds and blocks. This must be enforced **by PostgreSQL itself** (an exclusion constraint on dentist + time range using `btree_gist`), not just by application checks. Cancelled appointments and expired/consumed holds must not count. How the model achieves that (one table for all entry kinds vs. separate tables, how expired holds are excluded) is the builder's call, provided the database still guarantees the rule. Application code checks first for friendly messages, and handles the constraint violation as "that time was just taken" whenever the check races.
- **Required test:** many concurrent attempts to book the same slot against real Postgres → exactly one succeeds. The same applies to drag-moves and blocks racing bookings.
- **Statuses:** booked → arrived → completed, or booked → no-show, or booked → cancelled (records who cancelled: patient or staff). The source is recorded: online or staff.

## 9. Email and reminders

- **Provider:** Resend (as in the portfolio). Without an API key, emails are logged instead of sent.
- **Emails (EN or TR per the patient's choice):** booking confirmation (with .ics and manage link), reschedule confirmation, cancellation confirmation, and (phase 2) a reminder 24 hours before.
- **Who triggers what (Claude's call):** patient actions (book, reschedule, cancel via the manage link) email the patient. Staff actions (move, cancel, staff-created booking) email the patient **only when demo mode is off**. In demo mode they are written to the email log instead, because another visitor acting as staff must never be able to email your address. Staff-created bookings ask for phone (required) and email (optional). With an email and demo mode off, the patient gets the confirmation and a manage link.
- **Demo anti-abuse:** an email only ever goes to the address the visitor typed in their own booking. Cap emails per address and per IP per day (builder picks sensible numbers, e.g. 5/day). Seeded fake patients use reserved, non-deliverable addresses (e.g. `@example.com`) and are never emailed.
- **Phase 2 reminders:** a scheduled job runs regularly and sends due reminders exactly once (idempotent), and writes a log entry for each email and each simulated SMS ("Nova Dental: yarın 14:00 randevunuz var…"). The scheduler mechanism (platform cron hitting a protected route, or similar) is the builder's call, and must be triggerable manually and in tests.

## 10. Demo mode

- Controlled by an environment flag. When on: banner, one-click role logins, seeded data, email caps, nightly reset.
- **Seed data:** realistic bookings for the current week and the next, about 60–80% full so the calendar looks alive, but always leaving free slots today and in the next few days, so a visitor can always book. Includes some arrived/no-show/cancelled history, a few blocks (a surgery, a leave day), and a couple of call-back requests.
- **Shared demo:** all visitors share one demo clinic, and staff actions by one visitor are visible to others. That's acceptable. The visitor's own booking is highlighted in the staff calendar for **that browser** (remembered, e.g. by cookie), which delivers the magic moment.
- **Demo guards (owner decision):** so no visitor can break the shared demo for the next one:
  - **Admin settings are view-only in demo mode.** Visitors can open every settings screen and see what is editable, but saving is disabled with a "Disabled in the demo" note. Outside demo mode, admin works fully.
  - **Receptionist and dentist actions stay fully live** (booking, moving, cancelling, statuses, blocks).
  - **Capacity floor:** in demo mode, staff blocks, moves and cancellations can never leave the clinic with fewer than a minimum number of free public slots today and in each of the next few days (the builder picks the numbers, e.g. at least 4 slots per day for the next 3 days). An action that would go below the floor is refused with a friendly "the demo keeps some slots free for other visitors" message.
- **"Try it as" switching** keeps the visitor oriented: after booking as a patient, switching to Receptionist opens the calendar on the day of their booking.
- **Nightly reset (phase 1)** at 03:00 Istanbul: wipe and re-seed relative to the current date. Also available as a script for local use.

## 11. Quality bar

- TypeScript strict; lint and typecheck gate each commit.
- Unit tests: slot generation (hours, lunch, blocks, holidays, durations, window edges), "anyone available" choice, permission checks, token handling, reminder idempotency.
- Integration tests against Postgres: the overlap guarantee and concurrency (§8).
- End-to-end tests (Playwright): the full patient booking, the manage link, the role switch and magic moment, receptionist drag/keyboard reschedule, dentist block (including the conflict refusal), the call-back request, EN/TR.
- Accessibility: keyboard-usable everything (including the calendar), axe checks in e2e, AA contrast.
- Performance: public pages fast (Lighthouse ≥ 90 on all four scores for the home page).
- GitHub Actions CI running lint, typecheck and all tests (Postgres service container).
- README: what it is, a screenshot, an architecture diagram, the double-booking design explained (it is the main talking point), how to run locally, env vars, the demo accounts, the clinic-name check.

## 12. Hook into the portfolio (after deployment, not now)

When it's deployed, add an entry to `~/Personal/portfolio/src/content/projects.ts` (the portfolio's typed project data) with the live URL and repo link. Out of scope for this project's build.

## 13. Left to the builder

- Exact schema and table layout, the auth library, the drag-and-drop library (or hand-rolled), the calendar rendering approach, the email templating approach, the job scheduler, the image sources.
- Week-view layout details, small copy, empty states, error pages.
- Exact rate-limit and email-cap numbers.
- The invented clinic name (with the realness check).

Decisions marked "Claude's call" above were made by Claude, not the owner.
