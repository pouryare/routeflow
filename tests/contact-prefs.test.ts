import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-cprefs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { setContactPref, contactOffByCustomer } = await import("@/lib/repo/contactPrefs");
const { readCustomers } = await import("@/lib/customers");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("S15 contact preferences", () => {
  it("turns a channel off with its reason, back on, and refuses another company's customer", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('cp','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,phone,lifecycle,synced_at,organization_id) VALUES ('CP','ف','0912','active',?,1)").run(now)).lastInsertRowid);
    expect(await setContactPref(1, cust, "calls", true, "گفت زنگ نزنید", user)).toBe(true);
    expect((await contactOffByCustomer(1)).get(cust)).toMatchObject([{ channel: "calls", reason: "گفت زنگ نزنید" }]);
    const listed = (await readCustomers(db, "all", { organizationId: 1 })).find((c) => c.id === cust);
    expect(listed?.contact_off?.[0].channel).toBe("calls");
    expect(await setContactPref(1, cust, "calls", false, "", user)).toBe(true);
    expect((await contactOffByCustomer(1)).has(cust)).toBe(false);
    expect(await setContactPref(2, cust, "promo", true, "x", user)).toBe(false);
  });
});
