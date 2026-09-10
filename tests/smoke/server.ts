import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

/** A consistent copy of the live database for this run.
 *
 *  The smoke suite used to run against data/routeflow.db itself, the production database,
 *  which was only safe while every test was read-only. The board's drag test moves a
 *  real task, and nothing that writes may touch production. `VACUUM INTO` rather than a
 *  file copy: the database runs in WAL mode, and a plain `cp` of the main file silently
 *  misses whatever is still in the -wal. */
function snapshotDb(): string {
  const live = process.env.ROUTEFLOW_DB_PATH ?? join(ROOT, "data", "routeflow.db");
  const copy = join(tmpdir(), `rf-smoke-${process.pid}-${Date.now()}.db`);
  const db = new DatabaseSync(live, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return copy;
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

  const dbPath = snapshotDb();
  /* The worker reads the same snapshot, so the session it mints is checked against the
     database the server is actually serving. */
  process.env.ROUTEFLOW_DB_PATH = dbPath;

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
  const dropSnapshot = () => {
    for (const s of ["", "-wal", "-shm"]) rmSync(`${dbPath}${s}`, { force: true });
  };

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
        dropSnapshot();
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killGroup();
  dropSnapshot();
  throw new Error(`next dev did not answer on ${PORT} within 180s`);
}
