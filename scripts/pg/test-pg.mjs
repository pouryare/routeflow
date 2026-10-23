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
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIST = path.join(ROOT, "tests/pg-known-failures.txt");
const OUT = path.join(ROOT, ".pg-test-results.json");
const TEMPLATE = "rf_template";
const base = process.env.DATABASE_URL;
if (!base) {
  console.error("DATABASE_URL is required (a database to connect to for CREATE DATABASE)");
  process.exit(2);
}

const admin = new pg.Client({ connectionString: base });
await admin.connect();
const old = await admin.query("SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE 'rf_t_%'", [TEMPLATE]);
for (const { datname } of old.rows) await admin.query(`DROP DATABASE ${datname}`);
await admin.query(`CREATE DATABASE ${TEMPLATE}`);
await admin.end();

const templateUrl = new URL(base);
templateUrl.pathname = `/${TEMPLATE}`;
execFileSync("npx", ["node-pg-migrate", "up", "-m", "db/migrations"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: templateUrl.toString() },
});

const args = [
  "vitest", "run",
  "--exclude", "**/node_modules/**", "--exclude", "tests/smoke/**", "--exclude", "tests/playwrightExtract.test.ts",
  // Each file first copies the template database, which takes longer than an SQLite file.
  "--hookTimeout=60000", "--testTimeout=30000",
  "--reporter=dot", "--reporter=json", `--outputFile.json=${OUT}`,
  ...process.argv.slice(2),
];
spawnSync("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, DB_DIALECT: "postgres", ROUTEFLOW_PG_TEMPLATE: TEMPLATE, PG_POOL_MAX: process.env.PG_POOL_MAX ?? "3" },
});

const results = JSON.parse(fs.readFileSync(OUT, "utf8"));
const failing = new Set(
  results.testResults.filter((r) => r.status === "failed").map((r) => path.relative(ROOT, r.name).split(path.sep).join("/"))
);
const ran = new Set(results.testResults.map((r) => path.relative(ROOT, r.name).split(path.sep).join("/")));
const known = new Set(
  fs.readFileSync(LIST, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
);

const newFailures = [...failing].filter((f) => !known.has(f)).sort();
const nowPassing = [...known].filter((f) => ran.has(f) && !failing.has(f)).sort();
const gone = [...known].filter((f) => !fs.existsSync(path.join(ROOT, f))).sort();

console.log(`\nPostgreSQL: ${ran.size - failing.size} of ${ran.size} test files pass; ${known.size} on the known-failures list.`);
if (newFailures.length) console.log(`\nFailing and not on the list (fix them, they passed before or are new):\n  ${newFailures.join("\n  ")}`);
if (nowPassing.length) console.log(`\nOn the list but passing now (delete their lines from tests/pg-known-failures.txt):\n  ${nowPassing.join("\n  ")}`);
if (gone.length) console.log(`\nOn the list but no longer exist (delete their lines):\n  ${gone.join("\n  ")}`);
process.exit(newFailures.length || nowPassing.length || gone.length ? 1 : 0);
