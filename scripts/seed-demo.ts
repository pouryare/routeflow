#!/usr/bin/env node
/** Build a complete, believable demo database from nothing.
 *
 *  Run:  node --experimental-strip-types --import ./scripts/_ts-register.mjs \
 *          scripts/seed-demo.ts [--scale=heavy|smoke] [--as-of=YYYY-MM-DD] [--db=<path>] [--force]
 *
 *  The real database is never opened. The target is checked BEFORE anything is imported,
 *  so a mistake cannot even reach the file.
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

/* ── only now is it safe to import the app ────────────────────────────────── */

/* Everything above MUST stay ahead of these imports. lib/db.ts reads ROUTEFLOW_DB_PATH at
   MODULE LOAD (lib/db.ts:21) and memoises the handle (_db, lib/db.ts:23), so the env var is
   set here and every app import is dynamic, below this line. */
process.env.ROUTEFLOW_DB_PATH = target;
process.env.SESSION_SECRET ||= "demo-seed-not-a-real-secret";

const { runSeed } = await import("./seed/run");
await runSeed({ scaleName, asOf: asOfArg ?? null, target });
