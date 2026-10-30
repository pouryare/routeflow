# PostgreSQL for RouteFlow (Wave P): the server, CI and local development all run this image.
#
#   docker build -t routeflow-postgres db
#   docker compose -f db/compose.yml up -d
#
# Every extension docs/decisions.md 10.1 names. PostGIS comes from PGDG, whose apt source the
# official image already has; pg_trgm, btree_gist and pg_stat_statements ship with Postgres;
# pg_duckdb comes from the Pigsty repository, which PGDG does not carry.
FROM postgres:18-trixie

ARG PG_MAJOR=18
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    echo "deb [trusted=yes] https://repo.pigsty.io/apt/pgsql/trixie trixie main" > /etc/apt/sources.list.d/pigsty-pgsql.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "postgresql-${PG_MAJOR}-postgis-3" \
      "postgresql-${PG_MAJOR}-pg-duckdb"; \
    apt-get purge -y curl; \
    rm -rf /var/lib/apt/lists/*

# pg_stat_statements and pg_duckdb must be loaded at start; logical WAL keeps change data
# capture and logical replicas possible without a restart later.
CMD ["postgres", \
     "-c", "shared_preload_libraries=pg_stat_statements,pg_duckdb", \
     "-c", "wal_level=logical"]

# Creates the extensions in the first database on first start (template1 too, so every
# database made afterwards, including the per-test copies, has them).
COPY init-extensions.sql /docker-entrypoint-initdb.d/10-extensions.sql
