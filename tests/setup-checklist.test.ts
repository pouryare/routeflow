import { describe, it, expect } from "vitest";
import { setupProgress } from "@/lib/setupChecklist";

describe("setup checklist (FB19)", () => {
  it("starts at 0 with every step's minutes to go", () => {
    const p = setupProgress({});
    expect(p.percent).toBe(0);
    expect(p.minutesLeft).toBe(30);
    expect(p.steps.every((s) => !s.done)).toBe(true);
  });
  it("ticks from the data it is given, and the percent and minutes follow", () => {
    const p = setupProgress({ products: true, customers: true, order: true });
    expect(p.percent).toBe(60);
    expect(p.minutesLeft).toBe(7); // team 5 + vehicle 2
    expect(setupProgress({ products: true, customers: true, team: true, vehicle: true, order: true }).percent).toBe(100);
  });
});

describe("setup checklist reads the company's own data", () => {
  it("ticks products, customers, team, vehicle and order as they appear", async () => {
    const os = await import("node:os"), path = await import("node:path"), fs = await import("node:fs");
    const p = path.join(os.tmpdir(), `rf-setup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.ROUTEFLOW_DB_PATH = p;
    process.env.SESSION_SECRET = "test-secret";
    const { getDb } = await import("@/lib/db");
    const { setupFor } = await import("@/lib/repo/setupChecklist");
    const before = await setupFor(1);
    expect(before.steps.find((s) => s.id === "customers")?.done).toBe(false);
    await getDb().prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('Z1','x','RESTAURANT','active','2026-01-01',1)").run();
    const after = await setupFor(1);
    expect(after.steps.find((s) => s.id === "customers")?.done).toBe(true);
    expect(after.percent).toBeGreaterThan(before.percent);
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${p}${s}`, { force: true });
  });
});
