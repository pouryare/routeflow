import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ratedb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { rateLimitDb, rateLimitDbReset } = await import("@/lib/repo/rateLimitDb");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("T24 rate limits in Postgres", () => {
  it("blocks after the short window is full, even though the long one has room", async () => {
    const rules = [{ max: 2, windowMs: 60_000 }, { max: 10, windowMs: 3_600_000 }];
    expect((await rateLimitDb("k1", rules)).allowed).toBe(true);
    expect((await rateLimitDb("k1", rules)).allowed).toBe(true);
    const third = await rateLimitDb("k1", rules);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("blocks on the long window when the short one has room", async () => {
    const long = [{ max: 100, windowMs: 60_000 }, { max: 1, windowMs: 3_600_000 }];
    await rateLimitDb("k2", long);
    expect((await rateLimitDb("k2", long)).allowed).toBe(false);
  });

  it("starts again after a reset and after the window ends; keys are independent", async () => {
    const r = [{ max: 1, windowMs: 40 }];
    await rateLimitDb("k3", r);
    expect((await rateLimitDb("k3", r)).allowed).toBe(false);
    expect((await rateLimitDb("other", r)).allowed).toBe(true);
    await rateLimitDbReset("k3", r);
    expect((await rateLimitDb("k3", r)).allowed).toBe(true);
    await new Promise((x) => setTimeout(x, 60));
    expect((await rateLimitDb("k3", r)).allowed).toBe(true);
  });
});
