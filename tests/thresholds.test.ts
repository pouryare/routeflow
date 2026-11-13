import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_THRESHOLDS, thresholdsProblem } from "@/lib/thresholds";
import { freshnessTier } from "@/lib/freshness";

const testDbPath = path.join(os.tmpdir(), `rf-thresholds-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { thresholdsFor, setThresholds } = await import("@/lib/repo/thresholds");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("D30 owner-set thresholds", () => {
  it("starts at the old fixed values, saves a full set, and refuses nonsense", async () => {
    expect(await thresholdsFor(1)).toEqual(DEFAULT_THRESHOLDS);
    expect(await setThresholds(1, { ...DEFAULT_THRESHOLDS, quiet_customer_days: 30, stalled_order_days: 3 })).toBeNull();
    expect(await thresholdsFor(1)).toMatchObject({ quiet_customer_days: 30, stalled_order_days: 3 });
    expect(await setThresholds(1, { ...DEFAULT_THRESHOLDS, quiet_customer_days: 2 })).toMatch(/ساکت/);
    expect(await setThresholds(1, { ...DEFAULT_THRESHOLDS, data_ageing_days: 10, data_stale_days: 10 })).toMatch(/کهنه/);
    expect((await thresholdsFor(1)).quiet_customer_days).toBe(30);
    expect(await setThresholds(1, DEFAULT_THRESHOLDS)).toBeNull();
  });

  it("freshness follows the company's own limits", () => {
    const now = new Date("2026-11-13T00:00:00.000Z");
    const nineDaysAgo = "2026-11-04T00:00:00.000Z";
    expect(freshnessTier(nineDaysAgo, now)).toBe("ageing");
    expect(freshnessTier(nineDaysAgo, now, 10, 20)).toBe("fresh");
    expect(freshnessTier(nineDaysAgo, now, 3, 8)).toBe("stale");
  });

  it("checks the stale limit sits above the ageing one", () => {
    expect(thresholdsProblem({ ...DEFAULT_THRESHOLDS, data_stale_days: 5 })).not.toBeNull();
  });
});
