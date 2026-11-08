# Thunder Basketball App

Web app for Thunder Basketball (youth basketball). Rebuild of the Google Apps Script + Sheets version.
**SPEC.md is the source of truth for behavior.** Read it before changing features.

Stack: Next.js + Supabase (Postgres), email via Resend. Built and run locally for now; hosting decided later.
Secrets live only in `.env.local` (never committed, never pasted into chat). The app is the only source for users and roles (Thunder and Scenic City); the old MasterAuth sheet sync is retired.

@AGENTS.md

## Commands
- Phone app (iPhone + Android): Expo in `mobile/` (see `mobile/README.md`), its own package.json, lint and tsc; the website's tsc/lint/tests skip it. It calls `app/api/mobile/*`, which use the same `lib/` rules; the session token travels as `Authorization: Bearer` (`phoneUser()` in `lib/auth/server.ts`).
- `npm run dev` — run locally at http://localhost:3000
- `npm test` — run tests (Vitest; tests live next to code as `*.test.ts`). Takes ~90 s: only 2 files run at once because Supabase allows 60 connections and its pooler holds idle ones for a while. If tests fail with "too many clients", wait a minute and rerun.
- `npx tsc --noEmit` and `npm run lint` — type check and lint
- `npm run db:migrate` — apply new `db/migrations/*.sql` files
- `npm run user -- list | add <cell> <first> <last> [email] | director <cell> | admin <cell> | delete <cell>` — test accounts; `admin` makes a CourtCaptain Admin (platform page `/platform`)
- `npm run import:teamsnap -- --sheet [--dry-run]` (or a `"data/import/<file>.csv"` path) — replace registrations from the Winter Registrations sheet's TeamSnapAPI tab (all columns kept; birthdates shifted +1 day when TeamSnap shows an evening time)
- `npm run fastbreak -- [--dry-run | --preview <id>,<id>,... [--new-clubs]]` — add outside clubs' teams registered in FastBreak Compete to Scenic City's current League (rules in `lib/fastbreak/sync.ts`; `FASTBREAK_DOMAIN` + `FASTBREAK_API_KEY` in `.env.local`).
- `npm run import:practice -- [--dry-run]` — import Gyms, PracticeSlots, BlackOuts tabs; safe to re-run (existing slots left alone). Booking rules live in `lib/practice/booking.ts`; times are Eastern via `lib/time.ts`.
- `npm run import:evaluations -- [--dry-run]` — import the sheet's Evaluations tab; safe to re-run (cards already in the app left alone). Rules in `lib/evaluations.ts`.
- `npm run import:teams -- [--dry-run]` — import the sheet's Teams tab; safe to re-run (keeps existing teams, adds staff who now exist). Staff matched by CoachID to users, else to a registration parent's cell (creates their login).
- Google Sheets: read as service account `thunder-sheets@thunderapp-513001.iam.gserviceaccount.com` via `lib/google/sheets.ts`; key in `data/google-service-account.json` locally, or the `GOOGLE_SERVICE_ACCOUNT_JSON` setting on a host like Netlify (never print or paste it); sheet links in `.env.local` (`REGISTRATIONS_SHEET`). Share each sheet with that email.
- While the server runs, `instrumentation.ts` syncs registrations from the sheet every `REGISTRATIONS_SYNC_MINUTES` (default 5) via `lib/teamsnap/sync.ts`: replaces only when the tab changed, never on parse errors or a >50% drop; status in the `sync_status` table, shown on the Players page. Backup: `AppHeader` calls `syncIfStale()` via `after()`, so any page view refreshes a stale sync (the timer only starts when the server starts).
- Announcements (`lib/announcements.ts`): `lib/notify/scheduler.ts` (started from `instrumentation.ts`) emails anything unread for 8 hours, checking every 15 min; `APP_URL` is the link in those emails.
- `data/` holds real exports with personal info: gitignored, never commit or paste it
- Database access is server-only via `lib/db.ts` (pg pool on `DATABASE_URL`, Supabase Session pooler).
  Tables live in `public` (visible in the Supabase dashboard), locked: every new table needs `enable row level security` + `revoke all ... from anon, authenticated` (see 003_lock_tables.sql). Tests run in a throwaway `app_test_*` schema.
- Business rules live in plain functions (e.g. `lib/auth/service.ts`) that take `deps` (pool, email, clock) so tests can drive them; server actions in `app/**/actions.ts` are thin wrappers.
- Email goes through Gmail (`GMAIL_USER` + `GMAIL_APP_PASSWORD`, a Google app password) or else Resend (`lib/email.ts`). With neither set, emails (and their codes) print in the `npm run dev` terminal. `npm run email:test -- <address>` sends a test email.

## How I like to work
- Work one step at a time. After each change, tell me exactly how to test it, then wait for my OK.
- Write tests for the login flow and the booking limits. Run them before telling me something works.
- Keep explanations short and plain. I'm the organization's director, not a full-time developer.
- Mobile-first: coaches use this on their phones. Keep it fast.
- Any sheet or table the app shows stays sorted, with who did it recorded (Booked By, Rostered By).

## Non-negotiable rules
- Every server endpoint checks the session and role on the server. Never trust the browser for role, team, name, or Director status.
- Roles are re-read from the user record on every request.
- Escape all user text before rendering it as HTML.
- Validate all input on the server. Guard against formula injection (`= + - @`) on anything written to Sheets or CSV.
- Writes that can collide (bookings, rosters, codes, PIN tries) run in a transaction.
- A Director manages only their own organization (Thunder or Scenic City; SPEC section 13). Check the role in that organization on the server.
- Find practice slots by Gym + Court + Time, never by position.
