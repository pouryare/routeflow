/* The SQLite file behind getDb(): opening it, its pragmas, and the boot schema and migrations
 * every statement waits for. This is the part the PostgreSQL pool replaces (Wave P). */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { instrumentSlowSql, slowSqlThresholdMs } from "../slowSql";
import { createBaseSchema } from "./schema";
import { runMigrations } from "./migrate";
import { sqliteDb, type Db } from "./client";

export const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(process.cwd(), "data", "routeflow.db");

let _db: DatabaseSync | null = null;
let _ready: Promise<void> | null = null;
let _asyncDb: Db | null = null;

/** The database the app uses. Every call is asynchronous (see lib/database/client.ts). */
export function getDb(): Db {
  return (_asyncDb ??= sqliteDb(openSqlite, dbReady, closeSqlite));
}

/** Resolves once the schema and the boot migrations have run. getDb() and tx() wait for it on
 *  their own; only code that takes the raw handle needs it. */
export function dbReady(): Promise<void> {
  openSqlite();
  return _ready!;
}

/** The synchronous node:sqlite handle, after the boot migrations. Only for the SQLite-specific
 *  boot code in lib/database/ and the tests that check it: everything else goes through
 *  getDb(), which is what moves to PostgreSQL. */
export async function rawSqlite(): Promise<DatabaseSync> {
  await dbReady();
  return openSqlite();
}

function closeSqlite(): void {
  const db = _db;
  _db = null;
  _ready = null;
  db?.close();
}

function openSqlite(): DatabaseSync {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // Opt-in: ROUTEFLOW_SLOW_SQL_MS=200 logs any statement that takes that long, migrations included.
  const slowMs = slowSqlThresholdMs();
  if (slowMs > 0) instrumentSlowSql(db, slowMs);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  /* Read tuning. synchronous is deliberately left at FULL: the offline outbox drops a fact
     once the server acknowledges it, so a commit lost after an ack would never be re-sent.
     cache_size is negative = KiB, so -65536 is 64 MiB. mmap_size lets large reads skip a
     copy. busy_timeout makes a second writer wait rather than throw SQLITE_BUSY -- the
     lead-import runner and the request path share this file. */
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec("PRAGMA cache_size = -65536;");
  db.exec("PRAGMA mmap_size = 268435456;");
  db.exec("PRAGMA busy_timeout = 5000;");

  createBaseSchema(db);
  _db = db;
  /* A few migrations call app code, which is asynchronous now, so the migrations run as a
     promise that every statement waits for. If they fail, every waiting statement fails with
     the same error and the next call opens the file and tries again, as a failed open did. */
  _ready = runMigrations(db, sqliteDb(() => db)).catch((e) => {
    if (_db === db) {
      _db = null;
      _ready = null;
      db.close();
    }
    throw e;
  });
  return db;
}
