import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pragmas-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const pragma = (name: string) =>
  Object.values(getDb().prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];

describe("getDb pragmas", () => {
  it("keeps WAL and foreign keys on", () => {
    expect(pragma("journal_mode")).toBe("wal");
    expect(pragma("foreign_keys")).toBe(1);
  });

  it("leaves synchronous at the default (FULL, 2): durability is not traded away", () => {
    expect(pragma("synchronous")).toBe(2);
  });

  it("keeps temp structures in memory and enlarges the page cache", () => {
    expect(pragma("temp_store")).toBe(2);
    expect(Number(pragma("cache_size"))).toBeLessThanOrEqual(-65536);
  });

  it("sets a busy timeout so a concurrent writer waits instead of throwing", () => {
    expect(Number(pragma("busy_timeout"))).toBeGreaterThanOrEqual(5000);
  });
});
