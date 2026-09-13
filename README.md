# FieldPoint

Site and asset map for field-operations teams: offices, warehouses, client locations, job sites and vehicles on one map, with role-based access, an audit trail and CSV export.

Built to be boring and dependable: Node.js + Express 5, SQLite through the Node built-in `node:sqlite` (no native modules to compile), Leaflet with OpenStreetMap tiles (no map API key), and a dependency-free auth stack (scrypt hashes, server-side sessions, HMAC-signed cookies).

## Features

- **Map** — Leaflet + OpenStreetMap, colour-coded pins by category, dimmed pins for inactive sites, fit-to-data on load, right-click to add a site at a point, "Near me" proximity view with an accuracy circle.
- **Sites** — create / edit / delete, assign to a user, search across name, address and notes, filter by category, status and assignee, sort by name or recency, pagination, CSV export (formula-injection safe).
- **Soft delete** — deleting a site hides it everywhere but keeps the row; admins see a recycle bin and can restore it.
- **Work orders** — the field work itself: title, description, status (open / in progress / blocked / done / cancelled), priority, assignee, due date, and a comment thread. Overdue orders are flagged, `completedAt` is derived from status and never trusted from the client.
- **Proximity search** — `nearLat` / `nearLng` / `radiusKm` with an index-friendly bounding box followed by an exact haversine check; results can be sorted by distance.
- **Checklists** — a work order carries its own checklist, copied from a template at creation so a later template edit can never rewrite what a technician ticked off. Each tick records who and when.
- **Time tracking** — clock in and out against a work order, or type an entry in after the fact. A database partial index enforces one running timer per person; totals ignore a timer that is still running.
- **Templates** — reusable recipes (title, priority, estimate, ordered checklist) that a work order or a schedule can instantiate.
- **Recurring maintenance** — a schedule generates a work order every N days. The sweep runs hourly and on boot, is idempotent, and catches a long-missed schedule up in one jump instead of generating a backlog.
- **Geocoding** — "Locate" button resolves an address via OpenStreetMap Nominatim (browser-side, optional).
- **Auth** — first registered user becomes admin; admins create further accounts. scrypt password hashing, server-side sessions with signed cookies, rate-limited login, password change with session rotation.
- **Roles** — `admin` (everything) and `member` (view, create, edit sites). Last active admin cannot be demoted or disabled.
- **Audit log** — every login, user change and site mutation is recorded and visible to admins.
- **Hardening** — Helmet CSP, same-origin check on all mutations (CSRF), zod validation on every input, JSON body limit, global + login rate limits, JSON 404/500 envelopes that never leak stack traces.
- **Observability** — one structured JSON log line per request (no bodies, cookies or credentials), an `x-request-id` on every response, and a health check that actually queries the database.
- **Migrations** — numbered, transactional migrations in `src/db/migrations/`; an older database upgrades on boot and a newer one is refused.

> **Mock application.** Demo credentials are committed on purpose so the app boots anywhere with
> zero setup. No secret is baked into the image: `SESSION_SECRET` is read from the environment and,
> when absent, generated and persisted beside the database.

## Demo accounts

Created automatically on first boot (`SEED_DEMO=true`, idempotent):

| Email | Password | Role |
| --- | --- | --- |
| admin@fieldpoint.local | admin-demo-pass | admin |
| ops@fieldpoint.local | ops-demo-pass1 | member |
| qa@fieldpoint.local | qa-demo-pass-2026 | admin |

`npm run seed` prints the same table. Extra admins: `FIELDPOINT_USER_EMAIL=… FIELDPOINT_USER_PASSWORD=… node scripts/create-user.js`.

## Quick start

Requires Node.js 22.13+ (uses `node:sqlite`).

```bash
npm install
npm start         # http://localhost:4100 (LAN address printed too); demo data seeded on boot
```

Set `SEED_DEMO=false` to start empty; the sign-in screen then offers to create the first administrator.

## Configuration

Copy `.env.example` to `.env` (or export variables). All optional in development.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4100` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address; use `127.0.0.1` to keep it local |
| `DB_PATH` | `./data/fieldpoint.db` | SQLite file, directory auto-created |
| `SESSION_SECRET` | generated and persisted at `<DB dir>/.session-secret` | Set explicitly (32+ chars) for anything that is not a demo; production logs a warning when unset |
| `SEED_DEMO` | `false` (`true` in `.env` / `Dockerfile`) | Seed demo accounts + sites on boot |
| `SESSION_TTL_HOURS` | `72` | Session lifetime |
| `NODE_ENV` | `development` | `production` enables secure cookies + trust-proxy |
| `ALLOWED_ORIGINS` | same-origin only | Comma-separated extra origins allowed to mutate |

`npm start` loads `.env` when present (`--env-file-if-exists`).

## API

All routes return `{ ok: boolean, ... }`. Errors: `{ ok: false, error, details? }`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Liveness |
| GET | `/api/auth/me` | – | Current user + `needsBootstrap` |
| POST | `/api/auth/register` | none (first user) / admin | Create user |
| POST | `/api/auth/login` | – | Sign in (sets `fp_session` cookie) |
| POST | `/api/auth/logout` | – | Destroy session |
| POST | `/api/auth/password` | user | Change own password |
| GET | `/api/sites` | user | List; `q`, `category`, `status`, `assignedTo`, `sort`, viewport (`north`/`south`/`east`/`west`), proximity (`nearLat`/`nearLng`/`radiusKm`), `includeDeleted` (admin), `limit`, `offset` |
| GET | `/api/sites/stats` | user | Counts by category × status |
| GET | `/api/sites/export.csv` | user | CSV export (same filters) |
| GET/POST | `/api/sites`, `/api/sites/:id` | user | Read / create |
| PATCH | `/api/sites/:id` | user | Partial update — only the fields sent are changed |
| PUT | `/api/sites/:id` | user | Full replacement — body must include every site field |
| DELETE | `/api/sites/:id` | admin | Soft delete |
| POST | `/api/sites/:id/restore` | admin | Restore a soft-deleted site |
| GET | `/api/work-orders` | user | List; `siteId`, `status`, `priority`, `assignedTo`, `openOnly`, `overdue`, `q`, `sort` |
| GET | `/api/work-orders/summary` | user | Counts by status × priority |
| GET/POST | `/api/work-orders`, `/api/work-orders/:id` | user | Read / create |
| PATCH | `/api/work-orders/:id` | user | Partial update |
| DELETE | `/api/work-orders/:id` | admin | Delete (cascades comments) |
| GET/POST | `/api/work-orders/:id/comments` | user | Read / add a comment |
| GET/POST | `/api/work-orders/:id/checklist` | user | Read / add checklist items |
| PATCH/DELETE | `/api/work-orders/:id/checklist/:itemId` | user | Tick / remove an item |
| GET | `/api/work-orders/:id/time` | user | Time logs and total minutes |
| POST | `/api/work-orders/:id/time/start`, `.../stop` | user | Clock in / out |
| POST | `/api/work-orders/:id/time` | user | Manual entry (`startedAt`, `endedAt`, `note`) |
| DELETE | `/api/work-orders/:id/time/:logId` | owner or admin | Remove an entry |
| GET | `/api/templates`, `/api/templates/:id` | user | Read templates |
| POST/PATCH/DELETE | `/api/templates`, `/api/templates/:id` | admin | Manage templates |
| GET | `/api/maintenance` | user | Schedules; `siteId`, `dueOnly`, `includeInactive` |
| POST/PATCH/DELETE | `/api/maintenance`, `/api/maintenance/:id` | admin | Manage schedules |
| POST | `/api/maintenance/run` | admin | Generate everything due now |
| GET | `/api/users/directory` | user | Active users (id, name, email, role) for assignment |
| GET | `/api/users` | admin | List users |
| PATCH | `/api/users/:id` | admin | Change `role` / `isActive` |
| GET | `/api/users/audit` | admin | Recent audit entries |

Site categories: `office`, `warehouse`, `client`, `job_site`, `vehicle`, `other`. Site statuses: `active`, `planned`, `inactive`.
Work-order statuses: `open`, `in_progress`, `blocked`, `done`, `cancelled`. Priorities: `low`, `normal`, `high`, `urgent`. Due dates are calendar days (`YYYY-MM-DD`), so no timezone can shift them.

## Development

```bash
npm run dev             # restart on change
npm test                # node:test + supertest, in-memory SQLite
npm run test:coverage   # with V8 coverage report
npm run lint            # syntax check + forbidden-statement scan
```

## Atlantic Software Factory

`compose.preview.yml` boots the app under the Factory's exact preview envelope (read-only root,
every capability dropped, no-new-privileges, tmpfs `/tmp` and `/data`). CI runs it on every push and
asserts the container never restarts. Reproduce a preview boot locally with
`docker compose -f compose.preview.yml up --build`.

`factory.deploy.yml` declares the preview: one service built from the `Dockerfile`, port 4100,
`/data` writable for SQLite, health on `/api/health`, and a `qa_seed` hook that creates the
Factory's QA administrator via `scripts/create-user.js`. No external services, no required secrets.

## Docker

```bash
docker build -t fieldpoint .
docker run -p 4100:4100 -v fieldpoint-data:/data -e SESSION_SECRET=$(openssl rand -hex 32) fieldpoint
```

The image runs as root by design: preview platforms mount `/data` as a plain root-owned tmpfs under a
read-only root with every capability dropped, where an unprivileged user gets `EACCES` and nothing can
`chown`. In that envelope root holds no capabilities either. To run unprivileged, own the data volume
with your uid and pass `--user`, e.g. `docker run --user 1000:1000 -v /srv/fieldpoint:/data …`.
If the directory is not writable the app exits with a one-line message naming the path and uid.

## Project layout

```
src/
  app.js            express app factory (used by server and tests)
  server.js         entrypoint: listen, LAN address banner, graceful shutdown
  config.js         env → frozen config
  db/               connection, numbered migrations, demo seed
  auth/             password hashing, session store, middleware, routes
  sites/            zod schemas, repository, routes, csv, geo helpers
  work-orders/      zod schemas, repository, routes, checklist, time logs
  templates/        reusable work-order recipes
  maintenance/      recurring schedules + the generator sweep
  users/            repository, directory + admin routes
  audit/            append-only audit log
  middleware/       errors, validation, origin check, request logging
public/             static SPA (vanilla ES modules + Leaflet)
scripts/            seed, lint
test/               integration + unit tests
```

## Limitations / next steps

- Single-process SQLite: fine for a team; move to Postgres behind the repository layer for multi-instance deployments.
- No email flow: admins set temporary passwords and users change them in-app.
- Tiles and geocoding call OpenStreetMap's public services; for heavy use, point `TILE_URL` in `public/js/map.js` at your own tile provider.
