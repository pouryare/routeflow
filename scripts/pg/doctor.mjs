#!/usr/bin/env node
// Checks that a PostgreSQL server is set up the way RouteFlow expects, and says what is wrong.
//
//   DATABASE_URL=postgres:///routeflow?host=/var/run/postgresql node scripts/pg/doctor.mjs
//
// Run it as the database owner (the role that runs the migrations), after db/server/install.sh and
// again after any change to the server. It only reads: it creates no table and changes no setting.
// Exit status is 1 when anything is marked FAIL, so a deploy script or a timer can stop on it.
//
// Optional: PG_APP_ROLE (checks the app role can connect and sees only what its scope allows),
// COVERAGE_BACKUP_DIR (checks backup-status.json is recent), RF_EXPECT_PGBACKREST=0 to skip the
// backup checks on a development machine.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const results = [];
const record = (level, name, detail = "") => results.push({ level, name, detail });
const ok = (name, detail) => record("ok", name, detail);
const warn = (name, detail) => record("WARN", name, detail);
const fail = (name, detail) => record("FAIL", name, detail);

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
} catch (e) {
  console.error(`FAIL  cannot connect with DATABASE_URL: ${e.message}`);
  process.exit(1);
}
const q = async (text, params) => (await client.query(text, params)).rows;
const setting = async (name) => (await q("SELECT current_setting($1, true) AS v", [name]))[0].v;

try {
  const [{ v: version, n: versionNum }] = await q("SELECT current_setting('server_version') AS v, current_setting('server_version_num')::int AS n");
  Math.floor(versionNum / 10000) >= 16 ? ok("server version", version) : fail("server version", `${version}; RouteFlow needs 16 or newer`);

  const me = (await q("SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"))[0];
  if (me.rolsuper) warn("connected as a superuser", `${me.u}: fine for migrations, but the app must not run as this role (it would skip row-level security)`);

  const wanted = ["postgis", "pg_trgm", "btree_gist", "pg_stat_statements"];
  const have = new Set((await q("SELECT extname FROM pg_extension")).map((r) => r.extname));
  const missing = wanted.filter((e) => !have.has(e));
  missing.length === 0 ? ok("extensions", wanted.join(", ")) : fail("extensions missing", `${missing.join(", ")} (CREATE EXTENSION as a superuser, install.sh does it)`);
  const available = new Set((await q("SELECT name FROM pg_available_extensions")).map((r) => r.name));
  if (!have.has("pg_duckdb")) available.has("pg_duckdb") ? warn("pg_duckdb", "installed on the server but not created in this database") : warn("pg_duckdb", "not installed; only the reporting ideas in the roadmap need it");

  const walLevel = await setting("wal_level");
  ["replica", "logical"].includes(walLevel) ? ok("wal_level", walLevel) : fail("wal_level", `${walLevel}; backups need replica or logical`);
  ["UTC", "Etc/UTC"].includes(await setting("timezone")) ? ok("timezone", "UTC") : warn("timezone", `${await setting("timezone")}; the app stores UTC`);
  (await setting("data_checksums")) === "on" ? ok("data checksums", "on") : warn("data checksums", "off; a damaged page would be read silently (initdb --data-checksums, on by default from 18)");

  // Migrations: every file in db/migrations has been applied.
  const files = fs.readdirSync(path.join(ROOT, "db", "migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
  const hasTable = (await q("SELECT to_regclass('public.pgmigrations') AS t"))[0].t;
  if (!hasTable) {
    fail("migrations", "no pgmigrations table; run: npx node-pg-migrate up -m db/migrations");
  } else {
    const applied = new Set((await q("SELECT name FROM pgmigrations")).map((r) => r.name));
    const todo = files.filter((f) => !applied.has(f));
    todo.length === 0 ? ok("migrations", `${files.length} applied`) : fail("migrations pending", todo.join(", "));
  }

  // Row-level security covers every table that carries organization_id.
  const unguarded = await q(
    `SELECT c.table_name AS t FROM information_schema.columns c
       JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
        AND (NOT k.relrowsecurity
             OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.table_name AND p.policyname = 'rf_company'))`
  );
  unguarded.length === 0 ? ok("row-level security", "every table with organization_id has its policy") : fail("row-level security", `no policy on: ${unguarded.map((r) => r.t).join(", ")}`);

  // The app role: not a superuser, does not bypass row-level security, and sees only what its scope allows.
  const appRole = process.env.PG_APP_ROLE;
  if (!appRole) {
    warn("PG_APP_ROLE", "not set; the app would run as the table owner and row-level security would not apply to it");
  } else {
    const r = (await q("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1", [appRole]))[0];
    if (!r) {
      fail("app role", `${appRole} does not exist`);
    } else if (r.rolsuper || r.rolbypassrls) {
      fail("app role", `${appRole} is a superuser or bypasses row-level security`);
    } else {
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${appRole}`);
        await client.query("SELECT set_config('rf.scope', '', true)");
        const none = (await q("SELECT count(*)::int AS n FROM customers"))[0].n;
        await client.query("SELECT set_config('rf.scope', 'system', true)");
        const all = (await q("SELECT count(*)::int AS n FROM customers"))[0].n;
        none === 0 ? ok("app role", `${appRole}: no scope sees no rows; system scope sees ${all}`) : fail("app role", `${appRole} saw ${none} customers with no scope`);
      } catch (e) {
        fail("app role", `${appRole} could not be used from this connection: ${e.message}`);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    }
  }

  // The sync watermark's trigger is on the tables the phones pull.
  const stamped = (await q("SELECT count(DISTINCT c.relname)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE '%\_sync\_xid' AND NOT t.tgisinternal"))[0].n;
  stamped > 0 ? ok("sync watermark", `${stamped} tables stamp sync_xid`) : fail("sync watermark", "no sync_xid triggers found");

  // Backups: WAL is being archived, and the last backup finished recently.
  if (process.env.RF_EXPECT_PGBACKREST === "0") {
    warn("backups", "skipped (RF_EXPECT_PGBACKREST=0)");
  } else {
    (await setting("archive_mode")) === "on" ? ok("archive_mode", "on") : fail("archive_mode", "off; no point-in-time recovery");
    const a = (await q("SELECT last_archived_time, last_failed_time, failed_count FROM pg_stat_archiver"))[0];
    if (a.last_failed_time && (!a.last_archived_time || a.last_failed_time > a.last_archived_time)) {
      fail("WAL archiving", `the last attempt failed at ${a.last_failed_time.toISOString()}; look in the pgBackRest log`);
    } else {
      a.last_archived_time ? ok("WAL archiving", `last segment ${a.last_archived_time.toISOString()}`) : warn("WAL archiving", "nothing archived yet");
    }
    const dir = process.env.COVERAGE_BACKUP_DIR;
    if (!dir) {
      warn("backup status", "COVERAGE_BACKUP_DIR is not set, so the owner's status page cannot show backups");
    } else {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, "backup-status.json"), "utf8"));
        const hours = (Date.now() - Date.parse(s.finishedAt)) / 3_600_000;
        if (!s.ok) fail("last backup", s.error ?? "the last run failed its check");
        else if (hours > 26) fail("last backup", `${Math.round(hours)} hours ago`);
        else ok("last backup", `${Math.round(hours)} hours ago, ${s.database?.file ?? "no label"}`);
      } catch {
        fail("last backup", `no readable backup-status.json in ${dir}`);
      }
    }
    try {
      execFileSync("pgbackrest", ["--stanza=" + (process.env.PGBACKREST_STANZA ?? "routeflow"), "check"], { stdio: "pipe" });
      ok("pgbackrest check", "archive and repositories answer");
    } catch (e) {
      const text = String(e.stderr ?? e.message).trim().split("\n").slice(-2).join(" ");
      fail("pgbackrest check", text || "pgbackrest is not installed or not configured");
    }
  }
} finally {
  await client.end();
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => r.level === "FAIL").length;
const warned = results.filter((r) => r.level === "WARN").length;
console.log(`\n${results.length - failed - warned} ok, ${warned} warning(s), ${failed} failure(s).`);
process.exit(failed ? 1 : 0);
