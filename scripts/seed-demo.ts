#!/usr/bin/env node
/** Build a complete, believable demo database from nothing.
 *
 *  Run:  node --experimental-strip-types --import ./scripts/_ts-register.mjs \
 *          scripts/seed-demo.ts [--scale=heavy|smoke] [--as-of=YYYY-MM-DD] [--db=<name>] [--force]
 *
 *  The real database is never opened. The target is checked BEFORE anything is imported,
 *  so a mistake cannot even reach it.
 *
 *  `--db` names a database on the server DATABASE_URL points at, routeflow_demo by default,
 *  and the real one is DATABASE_URL's own database. The demo database is dropped and rebuilt
 *  from db/migrations for every build.
 */

export {};

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

const { target, fresh, discard } = await postgresTarget();

/* ── only now is it safe to import the app ────────────────────────────────── */

/* Everything above MUST stay ahead of these imports. the pg adapter reads DATABASE_URL at MODULE LOAD and memoises the handle, so the target is set
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

async function postgresTarget(): Promise<Target> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    console.error("DATABASE_URL is required: the server, and the real database on it.");
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
