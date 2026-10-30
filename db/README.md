# PostgreSQL (Wave P)

RouteFlow runs on PostgreSQL only (the SQLite code was removed in Wave P, phase 5; plan and history: `docs/decisions.md` 10.1 and 10.2). This folder is the database: image, migrations, server setup. Running it on a real server is `docs/postgres-server.md`.

| Path | What it is |
|---|---|
| `Dockerfile`, `init-extensions.sql`, `compose.yml` | The Postgres 18 image the server, CI and local development use: PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements`, `pg_duckdb`, `wal_level = logical`. |
| `migrations/` | node-pg-migrate SQL files. `1761300000000_baseline.sql` is the schema as it stood when SQLite went; it is now owned by hand like any other migration. Change the schema with a new migration (`npx node-pg-migrate create -m db/migrations --migration-file-language sql <name>`), never by editing an applied one. |

## Commands

```sh
docker compose -f db/compose.yml up -d                  # local Postgres on 127.0.0.1:5432
export DATABASE_URL=postgres://routeflow:routeflow@localhost:5432/routeflow
npm run db:pg:migrate                                   # apply db/migrations
npm run dev                                             # the app, on DATABASE_URL
npm run db:pg:lint                                      # Squawk on the migrations
npm run db:pg:types                                     # Kysely types into lib/database/pg-schema.d.ts
DATABASE_URL=postgres://routeflow:routeflow@localhost:5432/postgres npm test
```

`npm test` builds a template database from the migrations and gives each test file its own copy, so files run in parallel without sharing rows. Pass vitest arguments after `--` (`npm test -- tests/orders.test.ts`). Running bare `vitest` stops with a message saying so (`tests/setup-pg.ts`). The browser suite (`npm run test:smoke`) needs a disposable database in `DATABASE_URL` that nobody is connected to: it copies it with `CREATE DATABASE ... TEMPLATE`, serves the copy and drops it afterwards.

## How app code reaches the database

- Every call goes through the `Db` interface (`lib/database/client.ts`); `lib/database/pg.ts` implements it. SQL is written with `?` placeholders.
- SQL that is awkward to spell (string aggregation, date differences, rounding) goes through `lib/database/dialect.ts`; `tests/sql-dialect-guard.test.ts` refuses the SQLite spellings left over from before.
- To tell which constraint a failed statement broke, use `isUniqueViolation` / `isCheckViolation` from `lib/database/errors.ts`, not the error text.

## Demo data

`npm run seed:demo` builds the demo company in its own database (`routeflow_demo` by default, or `--db <name>`) on the server `DATABASE_URL` points at. It refuses `DATABASE_URL`'s own database, and an existing database unless `--force` is given.

## Sync watermark

Each table the device pull reads has a `sync_xid` column (xid8) that a trigger sets on every insert and update (`1761400000000_sync-xid.sql`). The pull reads `pg_snapshot_xmin` first and hands it back as `x:<xmin>`; the next pull asks for every row with `sync_xid >= xmin`. A writer still open when the pull ran is therefore asked for again, which a timestamp watermark loses. A timestamp watermark from before the switch starts the device again from the beginning. `sync_xid` is never sent to the device.

## Row-level security

`1761500000000_row-level-security.sql` creates the role `routeflow_app` and a policy on every table with `organization_id`:

- `rf_company`: a row is visible and writable only when `rf_scope_allows(organization_id)`;
- `rf_shared`: rows with no company (`organization_id IS NULL`) can be read by everyone and changed only by `system` and `all`.

On a server set `PG_SCOPED=1` and log in as a non-owner role (`routeflow_web`, see `docs/postgres-server.md`); the adapter sets the company before each statement. For tests and local use, `PG_APP_ROLE=routeflow_app` makes the adapter run `SET ROLE` on each new connection, then sets `rf.scope` before each statement (once, as a local setting, inside a transaction). The scope comes from `lib/database/scope.ts`:

| Scope | Who |
|---|---|
| `org:<id>` | a request signed in to that company |
| `all` | a platform owner looking across companies |
| `system` | code outside a request: sweeps, scripts, the sign-in lookup, fixtures |
| `""` | a request with no session: no company's rows |

Inside a request the scope is read from the session cookie (`lib/session.ts` registers the resolver), so a route does not pass it. Use `withDbScope(scope, fn)` only to override it, for example around sign-in. The table owner (the migration user) is not subject to the policies, so run the app as `routeflow_app` on the server. Tables with no `organization_id` of their own (order lines, payment allocations and similar children) are guarded by their parent row, not by a policy.

`test:pg` runs as `routeflow_app` and gives the template `GRANT SET ON PARAMETER session_replication_role` so fixtures can switch foreign keys off. Never grant that on the server.
