# Time Management

A rota / working-hours management system for a small team (Doctors and ANPs),
built to administer the sessions staff are required to work to meet health
board standards. See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the original brief.

## Stack

- **SvelteKit** (Svelte 5) with `adapter-node` — deploys as a single Node
  process on a small VPS
- **SQLite** via better-sqlite3 + **Drizzle ORM** — no database server to run
- **Tailwind CSS 4** with a neo-brutalist design, accessibility-first
- **exceljs** for the `.xlsx` rota export
- Email + password auth (scrypt via `node:crypto`, session cookies) — no
  external services

## Getting started

```sh
npm install
npm run db:push -- --force   # create/update the SQLite schema (local.db)
npm run db:seed              # admin account + sample rota from example.xlsx
npm run dev
```

Log in as `admin@example.com` / `changeme-admin` (sample staff accounts are
`dr1@example.com` … `anp2@example.com` / `changeme`). **Change these before
deploying anywhere real.**

## Concepts

- **User type**: `admin` (edits the rota and manages users) or `viewer`
  (read-only). Everyone can see everyone's times — that's intentional.
- **Category**: `doctor` or `anp` — the working-hours standard that applies.
  New categories: add to `USER_CATEGORIES` in [src/lib/constants.ts](src/lib/constants.ts).
- **Working sessions**: set per user by an admin as a Mon–Fri × AM/PM grid,
  so someone can work mornings only, afternoons only, or any mix. The rota
  can only schedule those sessions; everything else always reads "Not working".
- **Sessions**: each weekday splits into AM (8am–1pm) and PM (1pm–6pm). A
  session is a status plus sub-choices — currently working/not working, a
  location (East Calder by default, or Ratho) and a Duty flag. Admins set
  them via a popout picker on each rota cell. New statuses, locations or
  flags: extend `CellValue`/`CELL_OPTIONS` in the same file.
- **Live updates**: when an admin saves the rota or edits users, every
  signed-in viewer's page refreshes automatically via a pub/sub channel on
  [ittysockets.com](https://ittysockets.com). The channel (set via
  `PUBLIC_REALTIME_CHANNEL` in `.env`, disabled when unset) is public, so it
  only ever carries content-free "changed" pings — data is re-fetched through
  each viewer's authenticated session.
- **Rota order / shown on rota**: admins control column order; admin-only
  accounts can be hidden from the rota entirely.

## Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | all users | The weekly rota grid (editable for admins) |
| `/users` | admin | Add/edit users, working days, order, roles |
| `/export` | all users | Download the rota as `rota.xlsx` |
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

Current coverage: domain constants, user-form validation, password hashing,
session lifecycle (expiry, sliding renewal, revocation), the login action,
rota load/save rules (slot availability, status validation, role checks), user
create/edit (slot cleanup, lockout guards, duplicate emails) and the xlsx
export layout.

## Planned next (from the brief)

- **Duty roster**: `Duty` flag on working sessions plus automatic warnings
  when too few Doctors are on duty. The schema anticipates this — add a
  `duty` column to `schedule_entries`.
- **Other user sets**: partition by adding a `groupId` to `users` and scoping
  queries by it.

## Deployment

```sh
npm run build
DATABASE_URL=/path/to/production.db node build
```

Put it behind any reverse proxy (Caddy/nginx) for TLS. Back up the database by
copying the SQLite file.
