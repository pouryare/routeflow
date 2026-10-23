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

`test:pg` builds a template database from the migrations, gives each test file its own copy, and compares the failing files with `tests/pg-known-failures.txt`. CI fails if a file not on that list fails, or if a listed file passes (delete its line). The list only shrinks; phase 3 empties it.

## How app code stays portable

- Every call goes through the `Db` interface (`lib/database/client.ts`); `lib/database/pg.ts` is the PostgreSQL side of it.
- SQL that the two engines spell differently goes through `lib/database/dialect.ts`; `tests/sql-dialect-guard.test.ts` refuses the SQLite-only spellings.
- To tell which constraint a failed statement broke, use `isUniqueViolation` / `isCheckViolation` from `lib/database/errors.ts`, not the error text.
