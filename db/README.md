# PostgreSQL (Wave P)

RouteFlow still runs on SQLite by default. This folder is the PostgreSQL side that runs next to it until the cut-over (plan: `docs/roadmap.md` 10.1 and 10.2).

| Path | What it is |
|---|---|
| `Dockerfile`, `init-extensions.sql`, `compose.yml` | The Postgres 18 image the server, CI and local development use: PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements`, `pg_duckdb`, `wal_level = logical`. |
| `migrations/` | node-pg-migrate SQL files. `1761300000000_baseline.sql` is **generated** from the SQLite schema by `npm run db:pg:generate`; never edit it by hand. |

## Commands

```sh
docker compose -f db/compose.yml up -d                  # local Postgres on 127.0.0.1:5432
export DATABASE_URL=postgres://routeflow:routeflow@localhost:5432/routeflow
npm run db:pg:migrate                                   # apply db/migrations
DB_DIALECT=postgres npm run dev                         # the app on Postgres
npm run db:pg:generate                                  # after changing lib/database/: regenerate the baseline
npm run db:pg:lint                                      # Squawk on the migrations
npm run db:pg:types                                     # Kysely types into lib/database/pg-schema.d.ts
DATABASE_URL=postgres://routeflow:routeflow@localhost:5432/postgres npm run test:pg
```

`test:pg` builds a template database from the migrations, gives each test file its own copy, and compares the failing files with `tests/pg-known-failures.txt`. CI fails if a file not on that list fails, or if a listed file passes (delete its line). The list is empty since phase 3 and should stay that way. A file that only makes sense on SQLite (it reads `PRAGMA`s or SQLite's file) goes in `tests/pg-sqlite-only.txt` with a reason; a single such test uses `it.skipIf(sqliteOnly)` from `tests/helpers/schema.ts`.

## How app code stays portable

- Every call goes through the `Db` interface (`lib/database/client.ts`); `lib/database/pg.ts` is the PostgreSQL side of it.
- SQL that the two engines spell differently goes through `lib/database/dialect.ts`; `tests/sql-dialect-guard.test.ts` refuses the SQLite-only spellings.
- To tell which constraint a failed statement broke, use `isUniqueViolation` / `isCheckViolation` from `lib/database/errors.ts`, not the error text.

## Demo data

`DB_DIALECT=postgres npm run seed:demo` builds the demo company in its own database (`routeflow_demo` by default, or `--db <name>`) on the server `DATABASE_URL` points at. It refuses `DATABASE_URL`'s own database, and an existing database unless `--force` is given.

## Sync watermark

Each table the device pull reads has a `sync_xid` column (xid8) that a trigger sets on every insert and update (`1761400000000_sync-xid.sql`). The pull reads `pg_snapshot_xmin` first and hands it back as `x:<xmin>`; the next pull asks for every row with `sync_xid >= xmin`. A writer still open when the pull ran is therefore asked for again, which a timestamp watermark loses. A timestamp watermark from before the switch starts the device again from the beginning. `sync_xid` is never sent to the device.

## Row-level security

`1761500000000_row-level-security.sql` creates the role `routeflow_app` and a policy on every table with `organization_id`:

- `rf_company`: a row is visible and writable only when `rf_scope_allows(organization_id)`;
- `rf_shared`: rows with no company (`organization_id IS NULL`) can be read by everyone and changed only by `system` and `all`.

Set `PG_APP_ROLE=routeflow_app` and the adapter runs `SET ROLE` on each new connection, then sets `rf.scope` before each statement (once, as a local setting, inside a transaction). The scope comes from `lib/database/scope.ts`:

| Scope | Who |
|---|---|
| `org:<id>` | a request signed in to that company |
| `all` | a platform owner looking across companies |
| `system` | code outside a request: sweeps, scripts, the sign-in lookup, fixtures |
| `""` | a request with no session: no company's rows |

Inside a request the scope is read from the session cookie (`lib/session.ts` registers the resolver), so a route does not pass it. Use `withDbScope(scope, fn)` only to override it, for example around sign-in. The table owner (the migration user) is not subject to the policies, so run the app as `routeflow_app` on the server. Tables with no `organization_id` of their own (order lines, payment allocations and similar children) are guarded by their parent row, not by a policy.

`test:pg` runs as `routeflow_app` and gives the template `GRANT SET ON PARAMETER session_replication_role` so fixtures can switch foreign keys off. Never grant that on the server.
