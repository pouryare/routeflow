import { describe, it, expect } from "vitest";
process.env.ROUTEFLOW_DB_PATH = `${process.env.TMPDIR ?? "/tmp"}/rf-db-checks-${Date.now()}.db`;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

describe("database input checks (migration 1762000000000)", () => {
  it("refuses a negative price and an over-long name", async () => {
    const db = getDb();
    await expect(
      db.prepare("INSERT INTO vehicles (organization_id, name, cost_per_km_toman, created_at, updated_at) VALUES (1, 'v', -1, 'x', 'x')").run()
    ).rejects.toThrow(/ck_vehicles_cost_per_km_toman/);
    await expect(
      db.prepare("INSERT INTO vehicles (organization_id, name, created_at, updated_at) VALUES (1, ?, 'x', 'x')").run("x".repeat(201))
    ).rejects.toThrow(/ck_vehicles_name/);
  });
});
