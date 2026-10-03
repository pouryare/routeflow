import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const realDb = path.join(REPO, "data", "routeflow.db");

/* A FRESH target path per call.
 *
 * Five tests used to share one hard-coded `/tmp/flagtest.db` and only ever cleaned up
 * `routeflow.seedtest.db`. The first test to run created the file and the other four were
 * then refused with "already exists" — 4 failures that looked like seed bugs and were nothing
 * of the kind. Worse, it was order-dependent: run alone it could pass, run beside
 * `seed-demo-build.test.ts` it failed.
 *
 * The refusal being tested IS "the target already exists", so a shared target guarantees the
 * wrong refusal. Each test needs its own path to test anything at all. */
let callSeq = 0;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-seedrefuse-"));
function freshTarget(): string {
  return path.join(tmpDir, `t${++callSeq}.db`);
}
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

  /* `--force` gets past the guard — reaching the next check, which is a different failure.
       A malformed `--as-of` aborts right after the banner, so the guard is genuinely cleared
       without paying for a 78,000-order heavy build. */
  it("refuses to overwrite an existing file without --force", () => {
    const tmp = freshTarget();
    fs.writeFileSync(tmp, "");
    const r = runSeed([`--db=${tmp}`]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("already exists");
    expect(r.out).toContain("--force");

    const forced = runSeed([`--as-of=not-a-date`, `--db=${tmp}`, "--force"]);
    expect(forced.out).not.toContain("already exists");
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
  /* Each of these spawns a REAL seed as a child process. A smoke build is measured at ~26s on
   * this machine, so vitest's 5s default times out on a test that is working perfectly. The
   * timeout is per test, not global — raising it everywhere would paper over genuinely slow
   * tests across the rest of the suite. */
  const SEED_TIMEOUT = 180_000;

  it("accepts --scale=smoke", () => {
    const r = runSeed(["--scale=smoke", `--db=${freshTarget()}`]);
    expect(r.out).toContain("seeding smoke demo");
  }, SEED_TIMEOUT);

  it("accepts --scale smoke", () => {
    const r = runSeed(["--scale", "smoke", `--db=${freshTarget()}`]);
    expect(r.out).toContain("seeding smoke demo");
  }, SEED_TIMEOUT);

  it("accepts --as-of=YYYY-MM-DD", () => {
    /* `--scale=smoke` added deliberately: this test only asserts the anchor is echoed, and
     * without it the seed builds HEAVY — 78,474 orders, 12,260s for phase 05 alone, measured.
     * The flag parser is what is under test, and it has already run by this point. */
    const r = runSeed(["--scale=smoke", "--as-of=2026-06-30", `--db=${freshTarget()}`]);
    expect(r.out).toContain("as of 2026-06-30");
  }, SEED_TIMEOUT);

  /* The default is read from the banner runSeed prints before it deletes anything. There is no
   * way to read it without starting the build, so this is the one test that goes heavy. */
  it("defaults to heavy when no scale is given", () => {
    const r = runSeed([`--db=${freshTarget()}`]);
    expect(r.out).toContain("seeding heavy demo");
  }, 6 * 60 * 60 * 1000);

  it("rejects a malformed --as-of rather than silently using today", () => {
    const r = runSeed(["--as-of=30-06-2026", `--db=${freshTarget()}`]);
    expect(r.out).toMatch(/--as-of must be YYYY-MM-DD/);
  }, SEED_TIMEOUT);
});
