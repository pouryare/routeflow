// Runs the unit suite against PostgreSQL and holds it to tests/pg-known-failures.txt (Wave P).
//
//   DATABASE_URL=postgres://user@host:5432/postgres npm run test:pg
//
// Builds a template database from db/migrations, gives every test file its own copy of it
// (lib/database/pg.ts testDatabaseUrl), then compares the failing files with the list:
//   - a file that fails and is not listed fails the run: something that worked on PostgreSQL
//     broke, or new code is SQLite-only;
//   - a listed file that now passes fails the run too, so the list only ever shrinks: delete
//     its line.
// Phase 3 of the move empties the list; then SQLite can go.
//
// tests/pg-sqlite-only.txt names the files about SQLite itself (its migrations, pragmas and
// query planner), which are left out of the run, each with its reason.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { dropDatabases, freshDatabase } from "./fresh-database.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIST = path.join(ROOT, "tests/pg-known-failures.txt");
const SQLITE_ONLY = path.join(ROOT, "tests/pg-sqlite-only.txt");
const OUT = path.join(ROOT, ".pg-test-results.json");
const TEMPLATE = "rf_template";
const base = process.env.DATABASE_URL;
if (!base) {
  console.error("DATABASE_URL is required (a database to connect to for CREATE DATABASE)");
  process.exit(2);
}

await dropDatabases(base, TEMPLATE, "rf_t_%");
const templateUrl = await freshDatabase(base, TEMPLATE);

/* The suite connects as the app's own role, as the server does, so row-level security and the
   grants are what production gets. Fixtures reset tables in replica mode (PRAGMA foreign_keys
   = OFF in lib/database/pg.ts), which a non-superuser may only set when granted it. The grant
   is server-wide, so it is for a test server only; production's never gets it. */
const APP_ROLE = "routeflow_app";
{
  const c = new pg.Client({ connectionString: templateUrl });
  await c.connect();
  try {
    await c.query(`GRANT SET ON PARAMETER session_replication_role TO ${APP_ROLE}`);
  } finally {
    await c.end();
  }
}

const listed = (file) =>
  fs.readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
const sqliteOnly = listed(SQLITE_ONLY);
const unexplained = fs.readFileSync(SQLITE_ONLY, "utf8").split("\n").filter((l) => /^tests\//.test(l) && !/#\s*.{10,}/.test(l));
if (unexplained.length) {
  console.error(`tests/pg-sqlite-only.txt: each file needs a reason after #:\n  ${unexplained.join("\n  ")}`);
  process.exit(2);
}

const args = [
  "vitest", "run",
  "--exclude", "**/node_modules/**", "--exclude", "tests/smoke/**", "--exclude", "tests/playwrightExtract.test.ts",
  ...sqliteOnly.flatMap((f) => ["--exclude", f]),
  // Each file first copies the template database, which takes longer than an SQLite file.
  "--hookTimeout=60000", "--testTimeout=30000",
  "--reporter=dot", "--reporter=json", `--outputFile.json=${OUT}`,
  ...process.argv.slice(2),
];
spawnSync("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, DB_DIALECT: "postgres", ROUTEFLOW_PG_TEMPLATE: TEMPLATE, PG_APP_ROLE: APP_ROLE, PG_POOL_MAX: process.env.PG_POOL_MAX ?? "3" },
});

const results = JSON.parse(fs.readFileSync(OUT, "utf8"));
const failing = new Set(
  results.testResults.filter((r) => r.status === "failed").map((r) => path.relative(ROOT, r.name).split(path.sep).join("/"))
);
const ran = new Set(results.testResults.map((r) => path.relative(ROOT, r.name).split(path.sep).join("/")));
const known = new Set(listed(LIST));

const newFailures = [...failing].filter((f) => !known.has(f)).sort();
const nowPassing = [...known].filter((f) => ran.has(f) && !failing.has(f)).sort();
const gone = [...known, ...sqliteOnly].filter((f) => !fs.existsSync(path.join(ROOT, f))).sort();

console.log(`\nPostgreSQL: ${ran.size - failing.size} of ${ran.size} test files pass; ${known.size} on the known-failures list, ${sqliteOnly.length} SQLite-only left out.`);
if (newFailures.length) console.log(`\nFailing and not on the list (fix them, they passed before or are new):\n  ${newFailures.join("\n  ")}`);
if (nowPassing.length) console.log(`\nOn the list but passing now (delete their lines from tests/pg-known-failures.txt):\n  ${nowPassing.join("\n  ")}`);
if (gone.length) console.log(`\nListed but no longer exist (delete their lines):\n  ${gone.join("\n  ")}`);
process.exit(newFailures.length || nowPassing.length || gone.length ? 1 : 0);
