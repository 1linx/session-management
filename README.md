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
- **Sessions**: each weekday splits into AM (8am–1pm) and PM (1pm–6pm), each
  `Working`, `Not working`, or `Working (Ratho)`. New statuses: add to
  `SESSION_STATUSES` in the same file.
- **Rota order / shown on rota**: admins control column order; admin-only
  accounts can be hidden from the rota entirely.

## Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | all users | The weekly rota grid (editable for admins) |
| `/users` | admin | Add/edit users, working days, order, roles |
| `/export` | all users | Download the rota as `rota.xlsx` |
| `/raw` | all users | Unprocessed view of the stored data |

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
