import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-onboarding-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { onboardingChecklist } = await import("@/lib/onboarding");
const { onboardingFor } = await import("@/lib/repo/onboarding");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const empty = { lat: null, lng: null, price_tier: null, contacts: 0, contact_person: null, credit_limit_toman: null };

describe("onboardingChecklist (F40)", () => {
  it("a bare record misses all four, in a fixed order", () => {
    const c = onboardingChecklist(empty, 0);
    expect(c.missing).toEqual(["location", "price", "contact", "credit"]);
    expect(c.isNew).toBe(true);
  });
  it("a zero credit limit is a decision, not a gap; the old contact field counts", () => {
    const c = onboardingChecklist({ ...empty, lat: 35.7, lng: 51.4, price_tier: "B", contact_person: "آقای رضایی", credit_limit_toman: 0 }, 2);
    expect(c.missing).toEqual([]);
    expect(c.isNew).toBe(false);
  });
});

describe("onboardingFor", () => {
  it("reads the customer's fields and contacts inside its organisation only", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = Number(
      (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,lat,lng,organization_id) VALUES ('OB','x','active',?,35.7,51.4,1)").run(now)).lastInsertRowid
    );
    await db.prepare("INSERT INTO contacts (organization_id,customer_id,name,role,active,is_primary,created_at,updated_at) VALUES (1,?,'م','OWNER',1,1,?,?)").run(id, now, now);
    const c = (await onboardingFor(1, id))!;
    expect(c.missing).toEqual(["price", "credit"]);
    expect(c.isNew).toBe(true);
    expect(await onboardingFor(2, id)).toBeNull();
  });
});
