import { spawn } from "node:child_process";

const PORT = 3100;
/* localhost, not 127.0.0.1: next dev refuses its dev assets and HMR socket to any origin
   but the one it started on (allowedDevOrigins), so on 127.0.0.1 every page rendered its
   server HTML and never hydrated. Geometry still passed; anything interactive could not. */
export const BASE = `http://localhost:${PORT}`;

async function answers(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Boot `next dev` on a spare port and resolve once it answers.
 *
 *  dev, NOT `next start`: the routeflow systemd service serves .next/ out of this very
 *  directory, and a production build would pull the chunk files out from under the
 *  running process — which is exactly how this app went down once already this week.
 *  `next dev` writes to .next/dev/ and leaves that alone.
 *
 *  Reuses an already-running server if one answers, so a developer with dev already open
 *  does not pay the boot twice.
 */
export async function startDevServer(): Promise<() => Promise<void>> {
  if (await answers()) return async () => {};

  /* detached, so the child gets its own process group.
   *
   *  `npx` is a wrapper: SIGTERM to it leaves the real `next-server` holding the port,
   *  and the next run silently REUSES that stale server — serving the code as it was
   *  when the leak happened. A smoke suite that tests yesterday's build while reporting
   *  success is the worst thing this file could do, and it did it once already. Killing
   *  the negated pid signals the whole group. */
  const proc = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
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

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await answers()) {
      return async () => {
        killGroup();
        /* Wait for the port to actually free, so a second run does not race the reuse
           check above and adopt a server that is on its way out. */
        const gone = Date.now() + 10_000;
        while (Date.now() < gone && (await answers())) {
          await new Promise((r) => setTimeout(r, 200));
        }
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killGroup();
  throw new Error(`next dev did not answer on ${PORT} within 180s`);
}
