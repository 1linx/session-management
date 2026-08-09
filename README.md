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

Log in with initials as the username: admin is `ADM` / `changeme-admin`
(sample staff are `DR1` … `ANP2` / `changeme`). **Change these before
deploying anywhere real.**

### Custom seed data

The sample rota is only a fallback. To make the real users + staffing rules
the default data set: set everything up through the UI, then

```sh
npm run db:snapshot                     # or: node scripts/snapshot.js --with-passwords
```

This writes `scripts/seed-data.json`, which `db:seed` prefers from then on
(no rota entries are captured — weeks start empty). Without
`--with-passwords`, reseeded users all get the password `changeme`; with it,
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
  values" marks them as Working at their usual practice on an empty week,
  but every cell on the rota can be set manually, and changing someone's
  standard sessions never deletes what's already rostered. A separate
  "can be sent to Ratho" flag tells Auto-fix who may be relocated.
- **Session state**: Working (at a practice, optionally with a role: Duty
  doctor, EC Duty team, EC House visits) or unavailable — Not working, Off
  sick, Annual leave, Admin work, Minor surgery, Special activity. The
  Absences page totals annual leave against each person's entitlement for
  the current leave year (1 April – 31 March) and sickness as raw totals.
- **Weeks**: the rota is managed week by week. The grid shows one week
  (identified by its Monday, `?week=YYYY-MM-DD`), defaulting to the current
  week in UK time, with previous/next navigation. Admins can populate an
  empty week by copying the week before it.
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

1. Exactly one GP duty doctor per practice per session (always on).
2. Minimum GPs/trainees on routine clinics, per practice.
3. EC duty team minimum (error) and desirable (warning) per session;
   ANPs fill the team before GPs.
4. EC house-visit allocations per session, GPs/trainees only.
5. Duty team / house visits flagged if placed at Ratho.

**Auto-fix** (`autofix.ts`) runs in the browser on the grid as shown —
including unsaved edits — and applies its corrections as **unsaved edits**
for review; nothing persists until the admin presses Save. It strips invalid
roles, promotes routine GPs to duty (choosing the lowest
duty-per-sessions-worked ratio so duty spreads proportionately), relocates a
`canWorkRatho` GP when Ratho lacks one (only if EC still meets its own
rules), fills the duty team ANP-first, then house visits — never touching
unavailable cells (not working, sick, leave, activities) and never dropping
anyone below the routine minimum. Every change is listed in the UI; what can't be fixed stays red,
and navigating away discards the proposal like any other unsaved edit.

Planned next (from the brief, not yet implemented): a cross-site
auto-allocation history ("sub-rota") recording who was moved or given
extra duty.

## Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | all users | The weekly rota grid (editable for admins), rule warnings, Auto-fix |
| `/absences` | all users | Annual leave vs entitlement + sickness totals |
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
