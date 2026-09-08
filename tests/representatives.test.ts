import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-reps-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { createRepresentative, advanceStage, completeStep, listOnboarding, RepStageError } =
  await import("@/lib/repo/representatives");
const { ONBOARDING_STEPS } = await import("@/lib/repOnboarding");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;

function seedOrgCustomer(orgId: number, code: string): number {
  const db = getDb();
  db.exec(
    `INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${orgId},'O${orgId}','o${orgId}','2026-01-01')`
  );
  if (!userId) {
    userId = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES ('rep-tester','x','ت','owner',1,1,'2026-01-01')"
        )
        .run().lastInsertRowid
    );
  }
  return Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, organization_id) VALUES (?,?,'WHOLESALE','qualified','2026-01-01',?)"
      )
      .run(code, "نماینده تست", orgId).lastInsertRowid
  );
}

describe("representative_profiles", () => {
  it("is a tenant table; onboarding steps are not", () => {
    expect(TENANT_TABLES).toContain("representative_profiles");
    expect(TENANT_TABLES).not.toContain("representative_onboarding_steps");
  });

  it("createRepresentative seeds the standard onboarding steps", () => {
    const custId = seedOrgCustomer(2, "REP-A");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-A", manager_user_id: null });
    expect(listOnboarding(2, repId).length).toBe(ONBOARDING_STEPS.length);
  });

  it("blocks stage -> active until required steps are done, then allows it", () => {
    const custId = seedOrgCustomer(2, "REP-B");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-B", manager_user_id: null });
    for (const to of ["qualified", "negotiating", "documents", "approved", "onboarding"] as const) {
      advanceStage(2, repId, to);
    }
    expect(() => advanceStage(2, repId, "active")).toThrow(RepStageError);
    for (const s of ONBOARDING_STEPS.filter((s) => s.required)) completeStep(2, repId, s.step_code, userId);
    expect(() => advanceStage(2, repId, "active")).not.toThrow();
    expect(
      (getDb().prepare("SELECT stage, activated_at FROM representative_profiles WHERE id=?").get(repId) as {
        stage: string;
        activated_at: string | null;
      })
    ).toMatchObject({ stage: "active" });
  });

  it("rejects an illegal stage jump", () => {
    const custId = seedOrgCustomer(2, "REP-C");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-C", manager_user_id: null });
    expect(() => advanceStage(2, repId, "active")).toThrow(RepStageError); // prospect -> active
  });

  it("keeps rep_code unique per organisation but shareable across organisations", () => {
    const cA = seedOrgCustomer(2, "REP-D2");
    const cB = seedOrgCustomer(3, "REP-D3");
    createRepresentative(2, { customer_id: cA, rep_code: "SHARED", manager_user_id: null });
    expect(() =>
      createRepresentative(3, { customer_id: cB, rep_code: "SHARED", manager_user_id: null })
    ).not.toThrow();
    const cA2 = seedOrgCustomer(2, "REP-D2b");
    expect(() =>
      createRepresentative(2, { customer_id: cA2, rep_code: "SHARED", manager_user_id: null })
    ).toThrow(); // UNIQUE(organization_id, rep_code)
  });

  it("does not find another organisation's representative", () => {
    const custId = seedOrgCustomer(2, "REP-E");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-E", manager_user_id: null });
    expect(() => advanceStage(3, repId, "qualified")).toThrow(RepStageError);
  });
});
