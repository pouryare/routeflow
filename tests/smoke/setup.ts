import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Put .env.local into the WORKER process's environment.
 *
 *  Two things had to be got right here, and both failed silently first:
 *
 *  1. Loading env in vitest.smoke.mts is not enough. The config is evaluated in vitest's
 *     main process; tests run in a pool worker with its own `process.env`, so
 *     SESSION_SECRET was missing exactly where createSessionToken needed it.
 *  2. `@next/env` — the obvious choice, since it is what the dev server uses — read
 *     nothing at all under vite's module transform: it returned an empty
 *     `loadedEnvFiles` for a file that plainly exists. Rather than chase that, this reads
 *     the file directly. The format this app's .env.local uses is `KEY=value` lines, and
 *     a parser for that is shorter than the workaround would have been.
 *
 *  Existing variables win, so a value exported in the shell still overrides the file —
 *  the same precedence Next applies.
 */
const ROOT = new URL("../..", import.meta.url).pathname;

for (const name of [".env.local", ".env"]) {
  const path = join(ROOT, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/** Fail here rather than 84 tests later.
 *
 *  Without the secret every minted cookie is rejected, every route redirects to /login,
 *  and /login lays out perfectly — so the suite would go green while testing nothing. */
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set — the smoke suite cannot mint a session");
}
