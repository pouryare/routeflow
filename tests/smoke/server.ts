import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 3100;
/* localhost, not 127.0.0.1: next dev refuses its dev assets and HMR socket to any origin
   but the one it started on (allowedDevOrigins), so on 127.0.0.1 every page rendered its
   server HTML and never hydrated. Geometry still passed; anything interactive could not. */
export const BASE = `http://localhost:${PORT}`;

const ROOT = new URL("../..", import.meta.url).pathname;

async function answers(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A private copy of the database for this run: `CREATE DATABASE ... TEMPLATE` from the one
 *  DATABASE_URL names, which must be a disposable one (the demo database from `npm run seed:demo`)
 *  with nobody connected to it, because PostgreSQL will not copy a database in use.
 *
 *  The smoke suite writes (the board's drag test moves a real task), so nothing here may touch
 *  the real database: the copy is what the server and the test workers are pointed at, and it is
 *  dropped when the run ends. */
async function snapshotDb(): Promise<{ url: string; drop: () => Promise<void> }> {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL must name a disposable database (the demo one) for the smoke suite to copy");
  const from = new URL(source);
  const name = `rf_smoke_${process.pid}_${Date.now()}`;
  const admin = new URL(source);
  admin.pathname = "/postgres";
  const withAdmin = async <T>(fn: (c: pg.Client) => Promise<T>) => {
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };
  await withAdmin((c) => c.query(`CREATE DATABASE "${name}" TEMPLATE "${from.pathname.slice(1)}"`));
  const copy = new URL(source);
  copy.pathname = `/${name}`;
  return {
    url: copy.toString(),
    drop: () => withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(() => undefined),
  };
}

/** Boot `next dev` on a spare port, against a snapshot of the database, and resolve once
 *  it answers.
 *
 *  dev, NOT `next start`: the routeflow systemd service serves .next/ out of this very
 *  directory, and a production build would pull the chunk files out from under the
 *  running process — which is exactly how this app went down once already this week.
 *  `next dev` writes to .next/dev/ and leaves that alone.
 *
 *  It no longer adopts a server that is already answering on the port: that server could
 *  be running against the live database, and a suite that writes must know it is not. A
 *  busy port is a loud failure instead.
 */
export async function startDevServer(): Promise<() => Promise<void>> {
  if (await answers()) {
    throw new Error(
      `something is already answering on ${PORT}; stop it first (the smoke suite runs its own server on a database snapshot)`,
    );
  }

  const snapshot = await snapshotDb();
  /* The worker reads the same snapshot, so the session it mints is checked against the
     database the server is actually serving. */
  process.env.DATABASE_URL = snapshot.url;

  /* vitest runs with NODE_ENV=test and a child inherits it; next dev under NODE_ENV=test
     is a non-standard mode (it warns, and next.config's dev-only branches misfire). Let
     next set its own. */
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "NODE_ENV"),
  ) as NodeJS.ProcessEnv;

  /* detached, so the child gets its own process group.
   *
   *  `npx` is a wrapper: SIGTERM to it leaves the real `next-server` holding the port.
   *  Killing the negated pid signals the whole group. */
  const proc = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env,
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
  });

  const killGroup = () => {
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  const dropSnapshot = () => snapshot.drop();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await answers()) {
      return async () => {
        killGroup();
        /* Wait for the port to actually free, so the next run's busy-port check does not
           trip over a server that is on its way out. */
        const gone = Date.now() + 10_000;
        while (Date.now() < gone && (await answers())) {
          await new Promise((r) => setTimeout(r, 200));
        }
        await dropSnapshot();
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killGroup();
  await dropSnapshot();
  throw new Error(`next dev did not answer on ${PORT} within 180s`);
}
