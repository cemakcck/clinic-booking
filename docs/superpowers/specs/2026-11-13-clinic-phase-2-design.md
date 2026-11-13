# Nova Dental — phase 2 design: reminders and dashboard

Date: 2026-11-13. Builds on the phase 1 design, `docs/superpowers/specs/2026-11-08-clinic-booking-design.md` (§2 phase 2 goals, §7.1 permissions, §9 email and reminders, §10 demo mode). Everything there still holds unless this document says otherwise.

## 1. Intent

Phase 2 finishes the clinic to the same level as Lodos before both are deployed (deadline about 2026-12-13). The audience is a recruiter or a prospective clinic client opening the live demo. Every phase 2 feature must be **visible and believable within a minute of clicking around a fresh demo**. A reminder you would have to wait 24 hours to see, or a dashboard with empty charts, fails that test even if it works.

Budget: about one week of build.

## 2. Goals

1. **24-hour reminders.** Before each appointment the patient gets one email reminder (EN or TR, by the patient's chosen language) and one **simulated** SMS. Never sent twice.
2. **Reminders log** for staff: every reminder email and simulated SMS, with time, patient, channel, appointment and outcome.
3. **"Send my reminders now"** in demo mode, so a visitor sees their own reminder appear immediately.
4. **Dashboard** with period comparison, built on enough generated history that it looks lived-in on a fresh demo.
5. **Phase 1 leftovers** (§8).

## 3. Non-goals and anti-goals

- No real SMS or WhatsApp sending (phase 1 non-goal, unchanged).
- No patient accounts, no CSV/PDF export, no new staff screens beyond the two below.
- **Anti-goal: a visitor must never be able to make the app email someone else.** Reminders follow phase 1's demo anti-abuse rules exactly (§9 there): an email only ever goes to an address a visitor typed into their own booking, the per-address and per-IP daily caps apply, and seeded patients (`@example.com`) are never emailed.
- Anti-goal: no new paid service or account. Everything must run on the free tiers already chosen (Vercel + Supabase) plus GitHub.

## 4. Reminders

### 4.1 Which appointments get a reminder
- An appointment that is `booked` (not cancelled, not already arrived/completed/no-show) and starts within the next 24 hours.
- **Booked late:** if the appointment was scheduled less than 24 hours before its start, no reminder is sent; the booking (or reschedule) confirmation was enough. "Scheduled" means the last time its start time was set: when it was created, or when it was last moved. Store that moment on the appointment. (Claude's call. Cost if wrong: a one-line rule change.)
- **Moved appointments:** a reminder belongs to an appointment *and its start time*. If an appointment is rescheduled after its reminder went out, the new time gets its own reminder (subject to the rules above). Cancelling stops any reminder not yet sent.
- **Channels:** SMS is simulated for every eligible appointment (all have a phone). Email only when the appointment has an email address and phase 1's rules allow sending (§3 anti-goal). When email is not allowed or not available, the log records why (reusing the phase 1 email statuses: `sent`, `logged`, `suppressed`, `capped`, `failed`).

### 4.2 Exactly once
- Sending must be idempotent: two job runs at once, a retry after a crash, or a manual run overlapping the scheduled one must not produce two reminders for the same appointment, start time and channel. Enforce it in the database (a unique key), not only in application code.
- A failed email send is logged as `failed` and is **not** retried automatically (Claude's call: a retry loop is more machinery than the demo needs; cost if wrong: patients with transient failures miss a reminder).

### 4.3 Content
- Email: clinic name, dentist, treatment, date and time in Istanbul time, address, the manage link (cancel/reschedule, which phase 1 already allows up to 24 h before, so the reminder says to call the clinic instead if inside that window), and the .ics as in the confirmation. EN and TR, same visual style as the phase 1 emails.
- SMS: one short line, under 160 characters, EN or TR, e.g. "Nova Dental: yarın 14:00 Dt. Ayşe Demir ile randevunuz var. Değişiklik için: 0216 …". The exact text is the builder's call; it must be stored as the text that "would have been sent".

### 4.4 Scheduling
- One server function runs a reminder pass for a given `now`. Tests call it directly with a fixed clock.
- In production a protected route (`/api/cron/reminders`, same `CRON_SECRET` bearer check as `/api/cron/reset`) runs the pass.
- **Claude's call:** Vercel's free plan allows cron only once a day, so a **GitHub Actions scheduled workflow** calls the route **every 15 minutes**. It needs only a repository secret with the URL and `CRON_SECRET`. Document that GitHub may delay scheduled runs and disables schedules on repos with no activity for 60 days. Cost if wrong: a few minutes' lateness, or switching to another free pinger later.
- The pass must also work in demo mode, where the nightly reset regenerates appointments. Seeded patients get SMS log entries only, which keeps the log naturally populated.

### 4.5 "Send my reminders now" (demo mode only)
- On the reminders log, demo mode shows a button: **Send my reminders now** (TR: "Hatırlatmalarımı şimdi gönder").
- It sends reminders immediately, ignoring both the 24-hour window and the booked-late rule (a visitor will almost always book for today or tomorrow), for **only the visitor's own upcoming bookings**. It still requires status `booked` and a start in the future; cancelled or already-started appointments are skipped. The bookings are the appointments in the signed `demo_mine` cookie from phase 1. Same channels, same anti-abuse rules and caps, same exactly-once rule. A reminder sent this way counts as sent, so the scheduled pass doesn't send it again.
- If the visitor has no bookings of their own, the button explains: "Book an appointment first, then come back" with a link to booking.
- Rate limit it like phase 1's other demo actions.
- Outside demo mode the button does not exist.

## 5. Reminders log (staff)

- New staff page. Visible to receptionist and admin (phase 1 §7.1); not to dentists.
- A table, newest first: time sent, channel (email / SMS), patient name, phone or email (masked by phase 1's demo masking rules: a visitor sees full details only for their own bookings), appointment (date, time, dentist, linking to it in the calendar), outcome, and for SMS the message text.
- Filters: date range (default last 7 days) and channel. Paginate or cap sensibly.
- In demo mode, the "Send my reminders now" button sits at the top.
- EN + TR, keyboard-usable, axe-clean, same staff look as phase 1.

## 6. Dashboard

### 6.1 Who sees what
- Receptionist and admin: whole clinic.
- Dentist: the same page with only their own numbers (phase 1 §7.1 "own numbers"). No other dentist's data reaches the browser.

### 6.2 Period
- Period picker: **This week** (default), **Last 4 weeks**, **Last 3 months**. Istanbul time.
  - **This week:** Monday 00:00 until now for the headline numbers; it is compared with **the same elapsed part of last week** (Monday 00:00 until the same weekday and time), so a Monday never reads "↓ 80%". Chair utilisation alone covers the whole week including what is already booked ahead, labelled so.
  - **Last 4 weeks:** the rolling 28 days ending now, compared with the 28 days before that.
  - **Last 3 months:** the rolling 91 days (13 weeks) ending now, compared with the 91 days before that.
- Each headline number shows the change against its comparison period ("↑ 12% vs last week"); no arrow when the comparison period has no data.

### 6.3 Numbers (definitions)
- **Appointments:** appointments whose start falls in the period, excluding cancelled. Cancellations shown as a separate count.
- **No-show rate:** no-shows ÷ (completed + arrived + no-show), over appointments in the period that have already started. Upcoming appointments don't count.
- **Online vs staff-made:** the share of the period's appointments by `source` (`online` / `staff`).
- **Chair utilisation, per dentist:** booked minutes (non-cancelled appointments) ÷ that dentist's working minutes in the period (working hours minus lunch, holidays and blocks). The whole period counts, including the future part of "this week"; label it so.
- **Busiest hours:** a weekday × hour heatmap of appointment starts (Istanbul time), over clinic opening hours only.

### 6.4 Presentation
- Headline tiles, then utilisation as bars per dentist, then the heatmap.
- Every chart has a text equivalent (a table or visible numbers), works in both languages, and meets AA contrast. Chart approach (hand-written SVG or a small library) is the builder's call; keep the client bundle small.

### 6.5 Demo history
- The demo seed generates about **26 weeks** of believable past appointments, enough for every period to have a comparison, (it currently covers only around the current week), with realistic weekday and hour patterns, no-shows around the existing 8% rate, a mix of online and staff-made bookings, and seeded `@example.com` patients only. Deterministic, like the current seed.
- These are ordinary appointment rows, so the dashboard reads them with the same queries as real data. They also show up in the patients list and the calendar's past weeks, which is fine. The nightly reset regenerates them relative to the reset date.
- Past history also produces past reminder log entries (SMS only, since seeded patients are never emailed), so the reminders log is not empty on a fresh demo.

## 7. Engineering expectations

- Same stack, conventions and test style as phase 1: Vitest unit and integration tests against Postgres, Playwright e2e with axe, EN + TR.
- Tests must cover at least: reminder eligibility (24 h window edges, booked late, cancelled, moved after a reminder, moved to within 24 h), exactly-once under parallel passes, the demo button only touching the visitor's own bookings and respecting caps, dashboard definitions on a hand-made dataset (including a dentist seeing only their own numbers), and one e2e (independent of the time of day it runs): book for tomorrow → staff reminders log → Send my reminders now → own SMS and email entries appear.
- Dashboard queries must stay fast on the demo dataset (around 5,000 appointments), and the nightly reset must stay quick; add indexes if needed.
- Never use ports 3000 or 3100 locally.

## 8. Phase 1 leftovers (fold in)

1. A hold for a dentist who was just deactivated can still be confirmed: confirming must re-check the dentist is active.
2. An inactive dentist who still has appointments cannot be edited: admin must be able to edit (and reactivate) them.
3. No index on `lower(email_log.to_address)`, which the per-address daily cap queries: add it.
4. `clinic.mapText` ("Moda Caddesi, Kadıköy") on the contact page: check it matches the clinic address used elsewhere and fix if not.
The owner separately checks three Turkish phrases ("Saat kapat", "+ Randevusuz hasta", "İlgi bekliyor"); not part of this build unless they ask.

## 9. Left to the builder

Table and column names, how the pass finds due appointments, the exact SMS wording, chart implementation, page layout details within the existing staff design, pagination size, and the GitHub Actions workflow details.
