import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-iso-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { groupFilter, orgFilter, canReachOrg } = await import("@/lib/session");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

const owner = (f: { orgId: number; ownerId: number }): Session =>
  ({ user: { id: f.ownerId } as never, role: "owner" as never, groupId: null, organizationId: f.orgId });

describe("organisation A and organisation B cannot see each other", () => {
  beforeAll(() => {
    ({ a, b } = seedTwoOrgs(getDb()));
  });

  it("shows each owner only their own customers", () => {
    const db = getDb();
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const f = groupFilter(owner(self), "c.group_id");
      const rows = db
        .prepare(`SELECT c.id FROM customers c WHERE 1 = 1 ${f.sql}`)
        .all(...f.params) as { id: number }[];
      expect(rows.map((r) => r.id)).toContain(self.customerId);
      expect(rows.map((r) => r.id)).not.toContain(other.customerId);
    }
  });

  it("shows each owner only their own rows in every tenant table", () => {
    const db = getDb();
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const f = orgFilter(owner(self));
      for (const table of TENANT_TABLES) {
        const rows = db
          .prepare(`SELECT organization_id FROM ${table} WHERE 1 = 1 ${f.sql}`)
          .all(...f.params) as { organization_id: number }[];
        const foreign = rows.filter((r) => r.organization_id === other.orgId);
        expect(foreign, `${table} leaked ${foreign.length} row(s) to org ${self.orgId}`).toEqual([]);
      }
    }
  });

  it("refuses a write naming the other organisation", () => {
    expect(canReachOrg(owner(a), b.orgId)).toBe(false);
    expect(canReachOrg(owner(b), a.orgId)).toBe(false);
  });

  it("lets both organisations hold the same natural keys", () => {
    const db = getDb();
    const codes = db
      .prepare("SELECT customer_code, COUNT(*) AS n FROM customers GROUP BY customer_code")
      .all() as { customer_code: string; n: number }[];
    expect(codes.find((c) => c.customer_code === "SHARED-001")?.n).toBe(2);
  });
});
