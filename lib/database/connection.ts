/* The database behind getDb(): the PostgreSQL pool in ./pg.ts, against a database whose schema
 * node-pg-migrate has already applied (db/migrations). DATABASE_URL names it.
 *
 * Tests never use DATABASE_URL's own database. With ROUTEFLOW_PG_TEMPLATE set, each test file gets a
 * copy of that template named after ROUTEFLOW_DB_PATH, which a test sets to a path of its own before
 * it imports lib/db (the name is only a key now: no file is opened). scripts/pg/test-pg.mjs builds
 * the template, sets both, and is what `npm test` runs. */
import path from "node:path";
import type { Db } from "./client";
import { pgDb, testDatabaseUrl } from "./pg";

/** The key that names a test file's own database. Unused outside tests. */
export const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(process.cwd(), "data", "routeflow.db");

let _asyncDb: Db | null = null;
let _pgReady: (() => Promise<void>) | null = null;

/** The database the app uses. Every call is asynchronous (see lib/database/client.ts). */
export function getDb(): Db {
  if (_asyncDb) return _asyncDb;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set: it names the PostgreSQL database (see db/README.md)");
  const template = process.env.ROUTEFLOW_PG_TEMPLATE;
  const test = template ? testDatabaseUrl(base, template, DB_PATH) : null;
  _pgReady = test?.ready ?? (async () => {});
  return (_asyncDb = pgDb(test?.url ?? base, _pgReady));
}

/** Resolves once the database can take statements (a test's copy of the template exists). getDb()
 *  waits for it on its own; only code that takes the connection string needs it. */
export function dbReady(): Promise<void> {
  getDb();
  return _pgReady!();
}
