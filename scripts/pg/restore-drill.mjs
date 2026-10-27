#!/usr/bin/env node
// Proves the backups can be restored: restores the newest backup of each repository into a scratch
// directory, starts a throw-away PostgreSQL on it, reads every table, and compares with the live
// database. Writes restore-drill.json next to backup-status.json. Run monthly (db/server/systemd)
// and after any change to the backup setup, as the postgres user.
//
//   node scripts/pg/restore-drill.mjs
//
// It never touches the live data directory or the live WAL archive: the scratch server runs with
// archiving off and listens on a socket in the scratch directory only.
//
// Environment: DATABASE_URL (the live database, read for row counts), PGBACKREST_STANZA (routeflow),
// COVERAGE_BACKUP_DIR (./backups), RF_DRILL_DIR (a folder on a disk with room for a full copy;
// default /var/lib/routeflow/restore-drill), RF_PG_BIN (the PostgreSQL bin folder; found with
// pg_config when unset).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STANZA = process.env.PGBACKREST_STANZA || "routeflow";
const BACKUP_DIR = process.env.COVERAGE_BACKUP_DIR || path.join(ROOT, "backups");
const DRILL_DIR = process.env.RF_DRILL_DIR || "/var/lib/routeflow/restore-drill";
const LIVE = process.env.DATABASE_URL;
if (!LIVE) {
  console.error("DATABASE_URL is not set: the drill compares the restore with the live database.");
  process.exit(2);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const pgbackrest = (...args) => run("pgbackrest", [`--stanza=${STANZA}`, ...args]);
const bin = process.env.RF_PG_BIN || run("pg_config", ["--bindir"]).trim();

async function tableCounts(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename);
    const counts = {};
    for (const t of tables) counts[t] = (await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    return counts;
  } finally {
    await client.end();
  }
}

/** Restore one repository's newest backup, start it, read it all, stop it, delete it. */
async function drill(repoKey, live) {
  const label = pgbackrest("info", "--output=json", `--repo=${repoKey}`);
  const newest = JSON.parse(label)[0].backup.filter((b) => b.database["repo-key"] === repoKey).sort((a, b) => b.timestamp.stop - a.timestamp.stop)[0];
  if (!newest) throw new Error(`repo${repoKey} has no backup to restore`);

  const dir = path.join(DRILL_DIR, `repo${repoKey}-${Date.now()}`);
  const data = path.join(dir, "data");
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const started = Date.now();
  let running = false;
  try {
    // type=immediate stops at the point the backup became consistent; promote ends recovery.
    pgbackrest(`--repo=${repoKey}`, `--pg1-path=${data}`, "--type=immediate", "--target-action=promote", "restore");
    const port = 40000 + Math.floor(Math.random() * 20000);
    const options = `-p ${port} -c archive_mode=off -c archive_command=/bin/true -c listen_addresses= -c unix_socket_directories=${dir} -c max_wal_senders=0 -c log_directory=${dir} -c logging_collector=off`;
    run(path.join(bin, "pg_ctl"), ["-D", data, "-o", options, "-w", "-t", "600", "-l", path.join(dir, "server.log"), "start"]);
    running = true;
    const dbName = new URL(LIVE).pathname.slice(1) || "postgres";
    const counts = await tableCounts(`postgres://${os.userInfo().username}@/${dbName}?host=${encodeURIComponent(dir)}&port=${port}`);
    const tables = Object.keys(live);
    const missing = tables.filter((t) => !(t in counts));
    const empty = tables.filter((t) => live[t] > 0 && counts[t] === 0 && ["users", "organizations", "customers"].includes(t));
    const ok = missing.length === 0 && empty.length === 0;
    return {
      repo: repoKey,
      ok,
      label: newest.label,
      backupFinished: new Date(newest.timestamp.stop * 1000).toISOString(),
      seconds: Math.round((Date.now() - started) / 1000),
      tables: tables.length,
      rowsRestored: Object.values(counts).reduce((a, b) => a + b, 0),
      rowsLive: Object.values(live).reduce((a, b) => a + b, 0),
      problem: ok ? null : missing.length ? `missing tables: ${missing.slice(0, 5).join(", ")}` : `empty after restore: ${empty.join(", ")}`,
    };
  } finally {
    if (running) {
      try {
        run(path.join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
      } catch {
        /* the folder removal below is what matters */
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const startedAt = new Date().toISOString();
const results = [];
let error = null;
try {
  const live = await tableCounts(LIVE);
  const repos = JSON.parse(pgbackrest("info", "--output=json"))[0].repo.map((r) => r.key);
  for (const key of repos) {
    try {
      const r = await drill(key, live);
      results.push(r);
      console.log(`[drill] repo${key} ${r.label}: ${r.ok ? "restored and readable" : `FAILED, ${r.problem}`} (${r.seconds}s, ${r.rowsRestored} rows)`);
    } catch (e) {
      const detail = String(e?.stderr || e?.message || e).trim().split("\n").slice(-3).join(" ").slice(0, 400);
      results.push({ repo: key, ok: false, problem: detail });
      console.error(`[drill] repo${key} FAILED: ${detail}`);
    }
  }
} catch (e) {
  error = String(e?.message ?? e).slice(0, 400);
  console.error("[drill] FAILED:", error);
}
const ok = error === null && results.length > 0 && results.every((r) => r.ok);
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.writeFileSync(path.join(BACKUP_DIR, "restore-drill.json"), `${JSON.stringify({ ok, startedAt, finishedAt: new Date().toISOString(), results, error }, null, 2)}\n`);
process.exitCode = ok ? 0 : 1;
