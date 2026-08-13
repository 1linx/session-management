# Time Management

A rota / working-hours management system for a small team (Doctors and ANPs),
built to administer the sessions staff are required to work to meet health
board standards.

## Stack

- **SvelteKit** (Svelte 5) with `adapter-node` — deploys as a single Node
  process on a small VPS
- **SQLite** via better-sqlite3 + **Drizzle ORM** — no database server to run
- **Tailwind CSS 4** with a neo-brutalist design, accessibility-first
- **exceljs** for the `.xlsx` rota export
- Initials + password auth (scrypt via `node:crypto`, session cookies) — no
  external services, no email addresses stored

## Getting started

```sh
npm install
npm run db:migrate           # create/update the SQLite schema (local.db)
npm run db:seed              # admin account + sample rota from example.xlsx
npm run dev
```

Log in with initials as the username: admin is `ADM` / `eastcalder-admin`
(sample staff are `DR1` … `ANP2` / `eastcalder`). **Change these before
deploying anywhere real.**

### Custom seed data

The sample rota is only a fallback. To make the real users + staffing rules
the default data set: set everything up through the UI, then

```sh
npm run db:snapshot                     # or: node scripts/snapshot.js --with-passwords
```

This writes `scripts/seed-data.json`, which `db:seed` prefers from then on
(no rota entries are captured — weeks start empty). Without
`--with-passwords`, reseeded users all get the password `eastcalder`; with it,
everyone keeps their login.

The file contains real staff names, so it is **gitignored, never committed**.
Copy it to the server by hand before reseeding there:

```sh
scp scripts/seed-data.json foundry:session-management/scripts/
```

## Concepts

- **Practices**: East Calder (default) and Ratho, both open Mon–Fri 8am–6pm.
- **User type**: `admin` (edits the rota and manages users) or `viewer`
  (read-only). Everyone can see everyone's times — that's intentional.
- **Category**: `doctor` (GP), `gp_trainee` or `anp`. GPs and trainees are
  "clinicians" for staffing rules; only GPs can be the duty doctor.
  New categories: add to `USER_CATEGORIES` in [src/lib/constants.ts](src/lib/constants.ts).
- **Standard sessions**: set per user by an admin as a Mon–Fri × AM/PM grid
  of practices, so someone can be EC-only, Ratho-only, or split across both
  on different sessions. These are defaults, not restrictions — "Use default
  values" fills an empty week's grid with Working at their usual practice
  as unsaved edits (stored only when the admin presses Save), but every
  cell on the rota can be set manually, and changing someone's
  standard sessions never deletes what's already rostered. A separate
  "can be sent to Ratho" flag tells Auto-fix who may be relocated.
- **Session state**: Working (at a practice, optionally with a role: Duty
  doctor, EC Duty team, EC House visits) or unavailable — Not working, Off
  sick, Annual leave, Admin work, Minor surgery, Special activity. The
  Absences page totals annual leave against each person's entitlement for
  the current leave year (1 April – 31 March) and sickness as raw totals.
- **Weeks**: the rota is managed week by week. The grid shows one week
  (identified by its Monday, `?week=YYYY-MM-DD`), defaulting to the current
  week in UK time, with previous/next navigation. Entering an empty week
  offers "Use default values" (with or without an Auto-fix pass on top),
  filling the grid as unsaved edits.
- **Sessions**: each weekday splits into AM (8am–1pm) and PM (1pm–6pm),
  set via a popout picker on each rota cell. New statuses, locations or
  roles: extend `CellValue`/`CELL_OPTIONS` in [src/lib/constants.ts](src/lib/constants.ts).
- **Live updates**: when an admin saves the rota or edits users, every
  signed-in viewer's page refreshes automatically via a pub/sub channel on
  [ittysockets.com](https://ittysockets.com). The channel (set via
  `PUBLIC_REALTIME_CHANNEL` in `.env`, disabled when unset) is public, so it
  only ever carries content-free "changed" pings — data is re-fetched through
  each viewer's authenticated session.
- **Rota order / shown on rota**: admins control column order; admin-only
  accounts can be hidden from the rota entirely.

## Staffing rules engine

All allocation logic lives in [src/lib/rules/](src/lib/rules/) — deliberately
pure (no database, no framework) because it will need the most fine-tuning.
The rota page runs `validateWeek()` live in the browser as cells are edited;
rows breaking a rule are outlined red with the reasons listed under the grid.

Rules implemented (configurable on the Staffing rules page unless noted):

1. Exactly one GP duty doctor per practice per session (always on). Users
   can be excluded from AM and/or PM duty (checkboxes on their user page);
   the exclusion covers duty doctor and the EC duty team. Auto-fix never
   assigns either in that period, and validation flags it if set by hand.
2. Minimum GPs/trainees on routine clinics, per practice. The duty doctor
   counts towards it (duty is worked alongside routine patients); duty
   team and house visits don't.
3. EC duty team minimum (error) and desirable (warning) per session.
   ANPs working at EC are always on the duty team (Auto-fix marks them;
   validation warns when one isn't); GPs top the team up to the minimum,
   lowest Duty Tally first (never trainees).
4. EC house-visit allocations per session, GPs/trainees only. Trainees
   count as half a GP, rounded down (2 trainees = 1 GP; 3 still = 1), and
   trainees working at EC always do house visits in AM sessions.
5. Duty team / house visits flagged if placed at Ratho.

**Auto-fix** (`autofix.ts`) runs in the browser on the grid as shown —
including unsaved edits — and applies its corrections as **unsaved edits**
for review; nothing persists until the admin presses Save. It puts every
East Calder ANP on the duty team — including bringing in an ANP left "Not
working" in a session their standard availability covers at EC — strips
invalid roles, promotes routine GPs to duty (see duty balancing below), relocates
a `canWorkRatho` GP when Ratho lacks one (only if EC still meets its own
rules), tops the duty team up with GPs, then fills house visits — never
touching absences (sick, leave, activities), never bringing anyone but an
available ANP in from "Not working", and never dropping anyone below the
routine minimum. Every change is listed in the UI; what can't be fixed stays red,
and navigating away discards the proposal like any other unsaved edit.

### Duty balancing

Duty is an extra commitment, so Auto-fix spreads it using a running
**Duty Tally**: duty sessions ÷ sessions worked (a duty-team session
counts the same as duty), per GP, over a rolling
window of saved rota history (365 days by default; set `DUTY_HISTORY_DAYS`
in `.env` to shrink it for testing). Only **East Calder** sessions count,
on both sides of the ratio — Ratho duty falls to whoever is on site, often
a Ratho-only doctor, so it would skew the balance. The lowest tally gets
duty first, so a GP working 8 EC sessions is expected to carry twice the
duty of one working 4. A doctor already on duty in the other half of the
same day is passed over whenever another candidate exists — no AM+PM duty
on one day unless unavoidable.
Tallies within 0.02 count as level, and between level candidates Auto-fix
avoids giving anyone the same duty slot they held the previous week — a
preference, never a rule. The admin **Duty** page shows the current tally
per GP and a week-by-week log of who held duty in every session, as the
audit trail for fairness questions. The window is enforced at query time;
no rota history is deleted (it also feeds the absence summaries, and a year
of data is only ~13k small rows).

Planned next (from the brief, not yet implemented): a cross-site
auto-allocation history ("sub-rota") recording who was moved.

## Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | all users | The weekly rota grid (editable for admins), rule warnings, Auto-fix |
| `/absences` | all users | Annual leave vs entitlement + sickness totals |
| `/duty` | admin | Duty tally per GP + week-by-week duty log |
| `/users` | admin | Add/edit users, standard sessions, order, roles |
| `/settings` | admin | Staffing-rule requirements (minimums, duty team, house visits) |
| `/export?week=` | all users | Download one week's rota as `rota-YYYY-MM-DD.xlsx` |
| `/raw` | all users | Unprocessed view of the stored data |

## Tests

```sh
npm test           # run once
npm run test:watch # watch mode
```

Vitest, running in plain Node against an **in-memory SQLite** — no dev server
or fixtures on disk. [src/tests/setup.ts](src/tests/setup.ts) points the app's
db singleton at `:memory:` and creates the schema; suites call `resetDb()`
between tests. Form actions and load functions are imported directly from the
route modules and invoked with stub request events
([src/tests/helpers.ts](src/tests/helpers.ts) has the builders), so new logic
— e.g. the Duty roster — can be tested the same way: add a `*.test.ts` under
`src/tests/`.

Current coverage: domain constants, date/week helpers, user-form validation,
password hashing, session lifecycle (expiry, sliding renewal, revocation),
the login action, week-scoped rota load/save, the empty-week bootstraps, the
staffing rules engine and Auto-fix behaviours, user create/edit/delete
(lockout guards, duplicate initials) and the xlsx export layout.

## Planned next (from the brief)

- Cross-site auto-allocation history ("sub-rota").
- **Other user sets**: partition by adding a `groupId` to `users` and scoping
  queries by it.

## Schema changes

The schema is applied via committed migration files in `drizzle/` — after
editing [schema.ts](src/lib/server/db/schema.ts), run `npm run db:generate`
(review the SQL it writes!) and `npm run db:migrate`. Avoid
`drizzle-kit push` against data you care about: it can resolve schema
diffs destructively (we've seen it truncate a table to add a column).

## Deployment

```sh
npm run build
DATABASE_URL=/path/to/production.db node build
```

Put it behind any reverse proxy (Caddy/nginx) for TLS. Back up the database by
copying the SQLite file.
