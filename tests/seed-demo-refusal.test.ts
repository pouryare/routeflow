import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const realDb = path.join(REPO, "data", "routeflow.db");

/** Runs the seed as a child process. Returns its combined output and exit code.
 *  `spawnSync` not `execFileSync`: a refusal is an expected non-zero exit with a message on
 *  stderr, and execFileSync throws before the message can be read. */
function runSeed(args: string[]): { out: string; code: number | null } {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings",
     "--import", path.join(REPO, "scripts/_ts-register.mjs"),
     path.join(REPO, "scripts/seed-demo.ts"), ...args],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, SESSION_SECRET: "x" } },
  );
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
}

describe("the demo seed refuses the real database", () => {
  it("refuses the relative path, even with --force", () => {
    const r = runSeed(["--db=data/routeflow.db", "--force"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("refusing to seed the real database");
  });

  it("refuses the absolute path", () => {
    const r = runSeed([`--db=${realDb}`]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("refusing to seed the real database");
  });

  /* The refusal compares RESOLVED ABSOLUTE paths, so a traversal must not slip past. A
     string comparison would accept `data/../data/routeflow.db` and write to the real file. */
  it("refuses a path that only reaches the real db through traversal", () => {
    const r = runSeed(["--db=data/../data/routeflow.db"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("refusing to seed the real database");
  });

  it("refuses to overwrite an existing file without --force", () => {
    const tmp = path.join(REPO, "data", "routeflow.seedtest.db");
    fs.writeFileSync(tmp, "");
    try {
      const r = runSeed([`--db=${tmp}`]);
      expect(r.code).toBe(2);
      expect(r.out).toContain("already exists");
      expect(r.out).toContain("--force");

      /* And --force gets past the guard — reaching the stub, which is a different failure. */
      const forced = runSeed([`--db=${tmp}`, "--force"]);
      expect(forced.out).not.toContain("already exists");
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it("did not touch the real database", () => {
    const db = new DatabaseSync(realDb, { readOnly: true });
    const orgs = db.prepare("SELECT COUNT(*) c FROM organizations").get() as { c: number };
    /* One organisation — the real tenant. The demo builds its own, in its own file. */
    expect(orgs.c).toBe(1);
    const demo = db.prepare(
      "SELECT COUNT(*) c FROM users WHERE username LIKE 'demo.%'",
    ).get() as { c: number };
    expect(demo.c).toBe(0);
  });
});

/* Regression: `flag()` originally read only the two-token form, so
   `npm run seed:demo -- --scale=smoke` was SILENTLY DROPPED and built a HEAVY database —
   the slowest possible outcome, from the flag a person uses to ask for a fast one. Nothing
   failed; the run just took far longer than asked. These assert both spellings are read. */
describe("the seed reads its flags in both spellings", () => {
  it("accepts --scale=smoke", () => {
    const r = runSeed(["--scale=smoke", "--db=/tmp/flagtest.db"]);
    expect(r.out).toContain("seeding smoke demo");
  });

  it("accepts --scale smoke", () => {
    const r = runSeed(["--scale", "smoke", "--db=/tmp/flagtest.db"]);
    expect(r.out).toContain("seeding smoke demo");
  });

  it("accepts --as-of=YYYY-MM-DD", () => {
    const r = runSeed(["--as-of=2026-06-30", "--db=/tmp/flagtest.db"]);
    expect(r.out).toContain("as of 2026-06-30");
  });

  it("defaults to heavy when no scale is given", () => {
    const r = runSeed(["--db=/tmp/flagtest.db"]);
    expect(r.out).toContain("seeding heavy demo");
  });

  it("rejects a malformed --as-of rather than silently using today", () => {
    const r = runSeed(["--as-of=30-06-2026", "--db=/tmp/flagtest.db"]);
    expect(r.out).toMatch(/--as-of must be YYYY-MM-DD/);
  });
});
