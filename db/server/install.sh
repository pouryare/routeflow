#!/usr/bin/env bash
# Sets up the PostgreSQL side of one RouteFlow server: Debian or Ubuntu, the database and the app on
# the same machine, backups to a second machine you own. Safe to run again; it skips what exists.
#
#   sudo db/server/install.sh                       # everything, PostgreSQL 18
#   sudo OFFSITE_HOST=backup.example OFFSITE_USER=rfbackup OFFSITE_PATH=/srv/routeflow-pgbackrest \
#        db/server/install.sh
#
# Options:  --skip-packages   do not touch apt (PostgreSQL and pgBackRest are already installed)
#           --no-systemd      do not install or enable the backup timers
#           --no-migrate      do not run the migrations or the final check
#
# Environment: PG_MAJOR (18), DB_NAME (routeflow), APP_USER (routeflow), APP_DIR (/opt/routeflow, the
# checkout this script is in), PGDG_URL (https://apt.postgresql.org/pub/repos/apt; set a mirror if
# that host is not reachable from the server), OFFSITE_HOST / OFFSITE_USER / OFFSITE_PATH (the second
# machine; without them only the local repository is configured and the check says so).
#
# What it does not do: open the database to the network (it listens on localhost and a socket; the
# app connects over the socket as the OS user, so there is no database password to keep), install
# pg_duckdb (it comes from the Pigsty repository; if it is installed, this adds it to the server's
# preload list), or touch the app's own systemd unit.

set -euo pipefail

SKIP_PACKAGES=0; NO_SYSTEMD=0; NO_MIGRATE=0
for a in "$@"; do
  case "$a" in
    --skip-packages) SKIP_PACKAGES=1 ;;
    --no-systemd) NO_SYSTEMD=1 ;;
    --no-migrate) NO_MIGRATE=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 2; }

PG_MAJOR=${PG_MAJOR:-18}
DB_NAME=${DB_NAME:-routeflow}
APP_USER=${APP_USER:-routeflow}
APP_ROLE=routeflow_app
# The role the running app logs in as: not the owner, so a query that reaches the database cannot
# step up to the owner. The migrations still run as $APP_USER (the owner) over the socket.
WEB_ROLE=routeflow_web
STANZA=routeflow
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=${APP_DIR:-$(cd "$HERE/../.." && pwd)}
PGDG_URL=${PGDG_URL:-https://apt.postgresql.org/pub/repos/apt}
PGCONF=/etc/postgresql/$PG_MAJOR/main
PGDATA=/var/lib/postgresql/$PG_MAJOR/main
SOCKET_DIR=/var/run/postgresql
ENV_FILE=/etc/routeflow/env

step() { printf '\n== %s\n' "$*"; }
as_postgres() { runuser -u postgres -- "$@"; }
psql_pg() { as_postgres psql -v ON_ERROR_STOP=1 -X -q "$@"; }

if [ "$SKIP_PACKAGES" = 0 ]; then
  step "Packages (PostgreSQL $PG_MAJOR from PGDG, PostGIS, pgBackRest)"
  . /etc/os-release
  install -d /usr/share/postgresql-common/pgdg
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    apt-get update -qq && apt-get install -y -qq curl ca-certificates gnupg lsb-release
    curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] $PGDG_URL ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  fi
  apt-get update -qq
  apt-get install -y -qq "postgresql-$PG_MAJOR" "postgresql-$PG_MAJOR-postgis-3" pgbackrest openssh-client rsync
fi

step "Server settings"
install -d "$PGCONF/conf.d"
install -m 644 "$HERE/postgresql.routeflow.conf" "$PGCONF/conf.d/routeflow.conf"
if [ -f "$(pg_config --pkglibdir 2>/dev/null || echo /nonexistent)/pg_duckdb.so" ]; then
  sed -i "s/^shared_preload_libraries = .*/shared_preload_libraries = 'pg_stat_statements,pg_duckdb'/" "$PGCONF/conf.d/routeflow.conf"
fi
# Debian starts the cluster itself; a restart picks up wal_level, archive_mode and the preload list.
pg_ctlcluster "$PG_MAJOR" main restart 2>/dev/null || pg_ctlcluster "$PG_MAJOR" main start

step "App user, database, roles and extensions"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
# The app connects over the socket as this OS user, mapped to the database role of the same name by
# the default 'local all all peer' rule. routeflow_app is the role the app acts as (row-level security
# applies to it); the migrations would create it, but creating it here keeps the owner free of CREATEROLE.
psql_pg -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER') THEN CREATE ROLE "$APP_USER" LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE') THEN CREATE ROLE $APP_ROLE NOLOGIN; END IF;
END \$\$;
GRANT $APP_ROLE TO "$APP_USER";
SQL
# Password for the web role, kept only in $ENV_FILE (mode 640, group $APP_USER). pg_hba gets one
# scram line for it ahead of the default peer rule; the owner keeps the passwordless socket login.
WEB_PASS_FILE=/etc/routeflow/web-role-pass
install -d -m 755 /etc/routeflow
[ -f "$WEB_PASS_FILE" ] || ( umask 037; head -c 32 /dev/urandom | base64 | tr -d '\n=+/' > "$WEB_PASS_FILE" )
chgrp "$APP_USER" "$WEB_PASS_FILE"
WEB_PASS=$(cat "$WEB_PASS_FILE")
psql_pg -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$WEB_ROLE') THEN CREATE ROLE $WEB_ROLE LOGIN; END IF;
END \$\$;
ALTER ROLE $WEB_ROLE PASSWORD '$WEB_PASS';
GRANT $APP_ROLE TO $WEB_ROLE;
SQL
grep -q "$WEB_ROLE" "$PGCONF/pg_hba.conf" || sed -i "0,/^local/s||local   all   $WEB_ROLE   scram-sha-256\n&|" "$PGCONF/pg_hba.conf"
pg_ctlcluster "$PG_MAJOR" main reload
if ! as_postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" -d postgres | grep -q 1; then
  psql_pg -d postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$APP_USER\""
fi
# Superuser-only extensions, created once here so the migrations (run by the owner) find them in place.
psql_pg -d "$DB_NAME" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
as_postgres psql -Atqc "SELECT 1 FROM pg_available_extensions WHERE name = 'pg_duckdb'" -d "$DB_NAME" | grep -q 1 \
  && psql_pg -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_duckdb" || true

step "Backups (pgBackRest)"
install -d -o postgres -g postgres -m 750 /var/lib/pgbackrest /etc/pgbackrest
if [ ! -f /etc/pgbackrest/cipher-pass ]; then
  ( umask 077; head -c 32 /dev/urandom | base64 > /etc/pgbackrest/cipher-pass )
  chown postgres:postgres /etc/pgbackrest/cipher-pass
  echo "  A new encryption passphrase is in /etc/pgbackrest/cipher-pass. Copy it somewhere that is"
  echo "  neither this machine nor the backup machine: without it the backups cannot be read."
fi
CIPHER_PASS=$(cat /etc/pgbackrest/cipher-pass)
if [ -n "${OFFSITE_HOST:-}" ]; then
  SSH_DIR=$(getent passwd postgres | cut -d: -f6)/.ssh
  install -d -o postgres -g postgres -m 700 "$SSH_DIR"
  [ -f "$SSH_DIR/routeflow_backup" ] || as_postgres ssh-keygen -q -t ed25519 -N '' -C "routeflow-backup@$(hostname)" -f "$SSH_DIR/routeflow_backup"
  as_postgres sh -c "ssh-keyscan -H '$OFFSITE_HOST' >> '$SSH_DIR/known_hosts' 2>/dev/null; sort -u -o '$SSH_DIR/known_hosts' '$SSH_DIR/known_hosts'"
  echo "  On $OFFSITE_HOST: create $OFFSITE_PATH owned by $OFFSITE_USER, raise its open-file limit (restores read thousands of files over one"
  echo "  SFTP session): echo '$OFFSITE_USER soft nofile 65536' and '$OFFSITE_USER hard nofile 65536' into /etc/security/limits.d/routeflow-backup.conf."
  echo "  Put this key in ~$OFFSITE_USER/.ssh/authorized_keys there:"
  cat "$SSH_DIR/routeflow_backup.pub"
  if ! as_postgres ssh -i "$SSH_DIR/routeflow_backup" -o BatchMode=yes -o ConnectTimeout=10 "${OFFSITE_USER:?set OFFSITE_USER}@$OFFSITE_HOST" "test -d '${OFFSITE_PATH:?set OFFSITE_PATH}'"; then
    echo "  Cannot reach $OFFSITE_HOST with that key yet (or $OFFSITE_PATH is missing). Add the key, then run this again." >&2
    exit 3
  fi
  sed -e "s|<OFFSITE_PATH>|${OFFSITE_PATH:?set OFFSITE_PATH}|" -e "s|<OFFSITE_HOST>|$OFFSITE_HOST|" -e "s|<OFFSITE_USER>|${OFFSITE_USER:?set OFFSITE_USER}|" \
      -e "s|<CIPHER_PASS>|$CIPHER_PASS|g" -e "s|<PGDATA>|$PGDATA|" "$HERE/pgbackrest.conf" > /etc/pgbackrest/pgbackrest.conf
else
  # Local repository only: drop the repo2 lines.
  sed -e '/^repo2-/d' -e '/^# *repo2/d' -e "s|<CIPHER_PASS>|$CIPHER_PASS|g" -e "s|<PGDATA>|$PGDATA|" "$HERE/pgbackrest.conf" > /etc/pgbackrest/pgbackrest.conf
  echo "  OFFSITE_HOST is not set: backups stay on this machine until you rerun this with it."
fi
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf; chmod 640 /etc/pgbackrest/pgbackrest.conf
as_postgres pgbackrest --stanza=$STANZA stanza-create
as_postgres pgbackrest --stanza=$STANZA check

if [ "$NO_SYSTEMD" = 0 ]; then
  step "Backup timers"
  install -m 644 "$HERE"/systemd/* /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now routeflow-backup-full.timer routeflow-backup-diff.timer routeflow-backup-incr.timer routeflow-restore-drill.timer
fi

step "App environment ($ENV_FILE)"
install -d -m 755 /etc/routeflow
if [ ! -f "$ENV_FILE" ]; then
  ( umask 027
    cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgres://$WEB_ROLE:$WEB_PASS@/$DB_NAME?host=$SOCKET_DIR
PG_SCOPED=1
SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')
COVERAGE_BACKUP_DIR=/var/lib/routeflow/backups
ROUTEFLOW_PHOTOS_DIR=$APP_DIR/data/photos
ENV
  )
  chgrp "$APP_USER" "$ENV_FILE"
  echo "  Wrote $ENV_FILE with a new SESSION_SECRET. Add 'EnvironmentFile=$ENV_FILE' to the app's service."
else
  echo "  $ENV_FILE exists, left as it is."
fi
install -d -o postgres -g "$APP_USER" -m 2775 /var/lib/routeflow/backups

if [ "$NO_MIGRATE" = 0 ]; then
  step "Migrations and the final check"
  # Migrations run as the owner over the socket; the app and the check use the web role from the env file.
  runuser -u "$APP_USER" -- env DATABASE_URL="postgres:///$DB_NAME?host=$SOCKET_DIR" bash -c "cd '$APP_DIR' && npm run --silent db:pg:migrate"
  runuser -u "$APP_USER" -- env $(grep -v '^#' "$ENV_FILE" | xargs) PG_APP_ROLE=$APP_ROLE bash -c "cd '$APP_DIR' && node scripts/pg/doctor.mjs" || {
    echo "The check found problems above; the first backup may simply not have run yet: sudo systemctl start routeflow-backup@full"
  }
fi
step "Done"
