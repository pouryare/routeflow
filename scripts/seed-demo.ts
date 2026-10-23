#!/usr/bin/env node
/** Build a complete, believable demo database from nothing.
 *
 *  Run:  node --experimental-strip-types --import ./scripts/_ts-register.mjs \
 *          scripts/seed-demo.ts [--scale=heavy|smoke] [--as-of=YYYY-MM-DD] [--db=<path>] [--force]
 *
 *  The real database is never opened. The target is checked BEFORE anything is imported,
 *  so a mistake cannot even reach the file.
 *
 *  On PostgreSQL (DB_DIALECT=postgres) `--db` names a database on the server DATABASE_URL
 *  points at, routeflow_demo by default, and the real one is DATABASE_URL's own database.
 *  The demo database is dropped and rebuilt from db/migrations for every build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_DB = path.join(ROOT, "data", "routeflow.db");
const DEFAULT_DEMO = path.join(ROOT, "data", "routeflow.demo.db");

const argv = process.argv.slice(2);

/* Accept BOTH `--flag value` and `--flag=value`.
 *
 *  `flag()` alone only reads the two-token form, so `npm run seed:demo -- --scale=smoke`
 *  silently dropped the scale and built a HEAVY database instead — the slowest possible
 *  outcome, from the flag a person uses to ask for a fast one. An inline `--db=` scan was
 *  already needed for the same reason, so both forms are handled in one place here. */
function flag(name: string): string | undefined {
  const eq = `--${name}=`;
  const inline = argv.find((a) => a.startsWith(eq));
  if (inline) return inline.slice(eq.length);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
}

const scaleName = flag("scale") ?? "heavy";
const asOfArg = flag("as-of");
const targetArg = flag("db");
const force = argv.includes("--force");

const pgMode = process.env.DB_DIALECT === "postgres";
const { target, fresh, discard } = pgMode ? await postgresTarget() : sqliteTarget();

/* ── only now is it safe to import the app ────────────────────────────────── */

/* Everything above MUST stay ahead of these imports. lib/db.ts reads ROUTEFLOW_DB_PATH (and
   the pg adapter DATABASE_URL) at MODULE LOAD and memoises the handle, so the target is set
   in the environment above and every app import is dynamic, below this line. */
process.env.SESSION_SECRET ||= "demo-seed-not-a-real-secret-0123456789";

const { runSeed } = await import("./seed/run");
await runSeed({ scaleName, asOf: asOfArg ?? null, target, fresh, discard });

interface Target {
  /** What the summary prints as the place the demo went. */
  target: string;
  /** Empties the target so the build starts from nothing. */
  fresh: () => Promise<void>;
  /** Removes a half-built target after a failure. */
  discard: () => Promise<void>;
}

function sqliteTarget(): Target {
  /* Resolve ABSOLUTELY before comparing. `data/../data/routeflow.db` is a different string from
     `data/routeflow.db` but the same file, and a string comparison would let it through and
     write demo rows into the real ledger. path.resolve collapses `.` and `..`; realpath would
     also resolve symlinks, but the file may not exist yet, so resolution is the right tool. */
  const target = path.resolve(ROOT, targetArg ?? DEFAULT_DEMO);

  if (target === REAL_DB) {
    console.error(
      `refusing to seed the real database:\n  target: ${target}\n  real:   ${REAL_DB}\n` +
        `The demo database is data/routeflow.demo.db. Nothing here should ever write to the\n` +
        `real one.`,
    );
    process.exit(2);
  }

  if (fs.existsSync(target) && !force) {
    console.error(
      `${path.relative(ROOT, target)} already exists.\n` +
        `Pass --force to overwrite it, or --db=<other path> to build elsewhere.`,
    );
    process.exit(2);
  }

  process.env.ROUTEFLOW_DB_PATH = target;
  /* getDb() opens whatever is there and every schema statement is IF NOT EXISTS, so a stale
     file would blend old rows into the new build: it is deleted, never reused. */
  const remove = async () => {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${target}${suffix}`, { force: true });
  };
  return { target: path.relative(process.cwd(), target), fresh: remove, discard: remove };
}

async function postgresTarget(): Promise<Target> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    console.error("DB_DIALECT=postgres needs DATABASE_URL: the server, and the real database on it.");
    process.exit(2);
  }
  const { databaseExists, databaseName, databaseUrl, dropDatabases, freshDatabase } = await import("./pg/fresh-database.mjs");
  const name = targetArg ?? "routeflow_demo";
  const real = databaseName(base);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    console.error(`--db must be a plain database name (lower case, digits, _), got "${name}"`);
    process.exit(2);
  }
  if (name === real) {
    console.error(
      `refusing to seed the real database:\n  target: ${name}\n  real:   ${real} (DATABASE_URL)\n` +
        `The demo database is routeflow_demo. Nothing here should ever write to the real one.`,
    );
    process.exit(2);
  }
  if (!force && (await databaseExists(base, name))) {
    console.error(`database ${name} already exists.\nPass --force to overwrite it, or --db=<other name> to build elsewhere.`);
    process.exit(2);
  }
  process.env.DATABASE_URL = databaseUrl(base, name);
  return {
    target: `postgres database ${name}`,
    fresh: async () => void (await freshDatabase(base, name)),
    discard: async () => {
      const { getDb } = await import("@/lib/db");
      await getDb().close();
      await dropDatabases(base, name);
    },
  };
}
