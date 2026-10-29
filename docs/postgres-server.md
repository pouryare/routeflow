# Running RouteFlow on its own PostgreSQL server

This is the operator's page for the PostgreSQL side (Wave P, phase 4): setting the server up, what the backups do, how to restore, and how to move the app over. The files it refers to are in `db/server/` and `scripts/pg/`. `db/README.md` covers development; this page covers a machine that real people use.

One machine is assumed: PostgreSQL and the app together, a second machine you own for the off-site copy. Nothing here needs a paid or foreign service.

## What you get

| Piece | Where | What it does |
|---|---|---|
| `db/server/install.sh` | the checkout | Installs PostgreSQL 18 (PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements`; `pg_duckdb` if present), writes the server settings, creates the database and roles, sets up pgBackRest and the backup timers, writes `/etc/routeflow/env`, runs the migrations and the check. Safe to run again. |
| `db/server/postgresql.routeflow.conf` | `conf.d/routeflow.conf` | The settings: localhost only, WAL archiving on, `wal_level = logical`, slow statements logged. Edit the memory sizes for the machine. |
| `db/server/pgbackrest.conf` | `/etc/pgbackrest/` | Two repositories: `repo1` on this machine, `repo2` on the second machine over SFTP, both encrypted. |
| `db/server/systemd/` | `/etc/systemd/system/` | Full backup on Sundays 01:30 Tehran time, differential on the other days, incremental every four hours, and a restore drill on the 1st of each month. |
| `scripts/pg/backup.mjs` | the checkout | Runs one backup to every repository, checks it, tars the photos, writes `backup-status.json` for the owner's status page. |
| `scripts/pg/restore-drill.mjs` | the checkout | Restores the newest backup of each repository into a scratch folder, starts a throw-away server on it, reads every table, compares with the live database, writes `restore-drill.json`. |
| `scripts/pg/doctor.mjs` | the checkout | Says whether the server is set up as RouteFlow expects. Exit status 1 on any FAIL. |
| `scripts/pg/click-through.ts` | the checkout | Opens every screen each role can reach in a browser and reports what broke. For the demo database only. |

## How the app connects

The app logs in over the local socket as a database role that does **not** own the tables, `routeflow_web` (password in `/etc/routeflow/web-role-pass` and in the env file, one scram line for it in `pg_hba.conf`). It is a member of `routeflow_app`, the role that row-level security applies to, so every statement sees only the signed-in company's rows. `PG_SCOPED=1` makes the adapter set the company before each statement without any `SET ROLE`. The migrations and backups run as `routeflow`, the owner, over the passwordless socket login; the policies do not apply to it.

Why not log in as the owner and `SET ROLE`: a query that reached the database by mistake (the injection fixed in the 2026-10-29 audit was one) could run `RESET ROLE` or `set_config('role', ...)` and be the owner again, with row-level security off. As `routeflow_web` there is no higher role to step up to. What it does not stop: the company is a plain session setting (`rf.scope`), so SQL injected into the app can still set it. The defence for that is the code (no SQL from request data), not the database.

`/etc/routeflow/env`, written by `install.sh` and read by the app's service and by the timers:

```
DATABASE_URL=postgres://routeflow_web:<generated>@/routeflow?host=/var/run/postgresql
PG_SCOPED=1
SESSION_SECRET=<generated>
COVERAGE_BACKUP_DIR=/var/lib/routeflow/backups
ROUTEFLOW_PHOTOS_DIR=/opt/routeflow/data/photos
```

Add `EnvironmentFile=/etc/routeflow/env` to the app's own unit. Do not run the app with an owner `DATABASE_URL` and no `PG_SCOPED` or `PG_APP_ROLE`: row-level security would not apply. A server set up with the older env file (`PG_APP_ROLE=routeflow_app`, owner login) still works, and `doctor.mjs` warns until it is moved: delete `/etc/routeflow/env` and run `install.sh` again (it keeps the session secret only if you copy it over first), or edit the two lines by hand after the script has created the role.

## Setting up

1. Check out the repository on the server (`/opt/routeflow`), `npm ci`, and have Node 22 or newer.
2. If `apt.postgresql.org` is not reachable from the server, set `PGDG_URL` to a mirror you can reach.
3. On the second machine, create a user for the copies and a folder: `useradd -m rfbackup; mkdir /srv/routeflow-pgbackrest; chown rfbackup /srv/routeflow-pgbackrest`. Also raise that user's open-file limit: `printf 'rfbackup soft nofile 65536\nrfbackup hard nofile 65536\n' > /etc/security/limits.d/routeflow-backup.conf`. pgBackRest 2.50 keeps a file handle open per file it reads over SFTP, and the default limit of 1024 stops a restore after about 1,000 files (found by the restore drill; the backups themselves were fine).
4. On the server: `sudo OFFSITE_HOST=<second machine> OFFSITE_USER=rfbackup OFFSITE_PATH=/srv/routeflow-pgbackrest db/server/install.sh`. It prints a public key; add it to `~rfbackup/.ssh/authorized_keys` on the second machine and run the script again (the stanza check needs the key to work).
5. Copy `/etc/pgbackrest/cipher-pass` to a place that is not on either machine. Without it the backups cannot be read.
6. `sudo systemctl start routeflow-backup@full`, then `journalctl -u routeflow-backup@full`. Then `node scripts/pg/doctor.mjs` (with the env from `/etc/routeflow/env`) should end with no FAIL. The owner's status page (`/sales/admin/status`) shows the backup as soon as `backup-status.json` exists.

pg_duckdb is optional. It comes from the Pigsty repository, not PGDG; if it is installed when `install.sh` runs, it is added to the preload list and created in the database.

## Moving the app to PostgreSQL

The data is dummy, so the move is a fresh start rather than a copy. The release that contains this page has no SQLite code at all: the app needs `DATABASE_URL` and will not start without it.

1. Set the server up as above. The database is empty apart from the baseline (company 1 exists, no users).
2. Make the first owner: `set -a; . /etc/routeflow/env; set +a; node scripts/create-user.mjs <username> <password> "<Name>" platform_owner` (then `owner` accounts the same way, or from the users screen once you can sign in).
3. Optional, for a training copy: `DATABASE_URL=postgres:///postgres?host=/var/run/postgresql npm run seed:demo` builds the demo company in its own database `routeflow_demo`; it refuses to write to the database `DATABASE_URL` names. Point a second copy of the app at it if you want one (`npm run dev:demo`).
4. Stop the app, add `EnvironmentFile=/etc/routeflow/env` to its unit, deploy this release, start it. `ROUTEFLOW_DB_PATH` and `data/routeflow.db` are no longer read; delete them when you are happy.
5. Sign in, click through the day's screens, and run `node scripts/pg/doctor.mjs` again.

**Going back:** there is no switch any more. Stop the app and deploy the previous release (the last one before Wave P phase 5), which still runs on its SQLite file; that file is untouched until you delete it. Keep it until the Postgres side has run a few weeks.

## Restoring

Which restore depends on what went wrong. All of them run as the `postgres` user with the app stopped.

- **Look at a backup without touching the live data:** `node scripts/pg/restore-drill.mjs` does exactly this, monthly.
- **The machine is gone:** install on the new machine with `install.sh` (same `OFFSITE_*`, same `/etc/pgbackrest/cipher-pass`), stop the cluster, empty its data directory, then `pgbackrest --stanza=routeflow --repo=2 restore` and start the cluster. It replays WAL up to the last segment that reached the second machine.
- **A bad deploy or a deleted table, minutes ago:** `pgbackrest --stanza=routeflow --repo=1 --type=time "--target=2026-11-02 14:05:00+00" --target-action=promote restore` (stop the cluster and empty the data directory first). Times are UTC.
- **One table:** restore into a scratch folder as the drill does, then `pg_dump -t` from it into the live database.

## Day to day

- `journalctl -u 'routeflow-backup@*' -u routeflow-restore-drill` shows the last runs; a failure also turns the owner status page's backup line red.
- `pgbackrest --stanza=routeflow info` lists what each repository holds.
- Slow statements (over 500 ms) are in the PostgreSQL log; `pg_stat_statements` has the totals.
- A new migration is applied with `npm run db:pg:migrate` as the `routeflow` user; the checks in CI (Squawk) catch the ones that would lock a big table.
