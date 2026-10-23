import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { canTransition } from "@/lib/customerLifecycle";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-lc-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setLifecycle, LifecycleError } = await import("@/lib/repo/customers");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("customer lifecycle transitions", () => {
  it("allows the forward path and re-engagement", () => {
    expect(canTransition("lead", "qualified")).toBe(true);
    expect(canTransition("qualified", "sampled")).toBe(true);
    expect(canTransition("sampled", "active")).toBe(true);
    expect(canTransition("lead", "sampled")).toBe(false); // skips qualified
    expect(canTransition("active", "dormant")).toBe(true);
    expect(canTransition("dormant", "active")).toBe(true);
    expect(canTransition("lost", "lead")).toBe(true);
    expect(canTransition("active", "blocked")).toBe(true);
    expect(canTransition("blocked", "active")).toBe(true);
    expect(canTransition("blocked", "lead")).toBe(false);
  });
});

describe("setLifecycle", () => {
  it("enforces the transition table and tenant scope", async () => {
    const db = getDb();
    await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (7,'S','s','2026-01-01')`);
    await db.exec(
      `INSERT INTO customers (id, customer_code, business_name, lifecycle, synced_at, organization_id)
       VALUES (500, 'C500', 'x', 'lead', '2026-01-01', 7)`
    );

    await setLifecycle(7, 500, "qualified");
    expect(
      (await db.prepare("SELECT lifecycle, qualified_at FROM customers WHERE id=500").get() as {
        lifecycle: string;
        qualified_at: string | null;
      })
    ).toMatchObject({ lifecycle: "qualified" });
    expect(
      (await db.prepare("SELECT qualified_at FROM customers WHERE id=500").get() as { qualified_at: string | null })
        .qualified_at
    ).toBeTruthy(); // stamped on the lead -> qualified move

    await (async () => await setLifecycle(7, 500, "active"))(); // qualified -> active legal
    await expect((async () => await setLifecycle(7, 500, "lead"))()).rejects.toThrow(LifecycleError); // active -> lead illegal
    await expect((async () => await setLifecycle(999, 500, "dormant"))()).rejects.toThrow(LifecycleError); // wrong org -> not found
  });
});
