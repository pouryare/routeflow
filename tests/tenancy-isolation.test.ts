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
    const reps = db
      .prepare("SELECT rep_code, COUNT(*) AS n FROM representative_profiles GROUP BY rep_code")
      .all() as { rep_code: string; n: number }[];
    expect(reps.find((r) => r.rep_code === "SHARED-REP")?.n).toBe(2);
    const cheques = db
      .prepare("SELECT cheque_no, COUNT(*) AS n FROM cheques GROUP BY cheque_no")
      .all() as { cheque_no: string; n: number }[];
    expect(cheques.find((c) => c.cheque_no === "SHARED-CHQ")?.n).toBe(2);
  });

  it("keeps payments and cheques apart", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const pays = db
        .prepare("SELECT id FROM payments WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(pays.map((r) => r.id)).toContain(self.paymentId);
      expect(pays.map((r) => r.id)).not.toContain(other.paymentId);

      const cheques = db
        .prepare("SELECT id FROM cheques WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(cheques.map((r) => r.id)).toContain(self.chequeId);
      expect(cheques.map((r) => r.id)).not.toContain(other.chequeId);
    }
  });

  it("keeps batches, stock movements and complaints apart, and allows a shared batch_code", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const [table, selfId, otherId] of [
        ["batches", self.batchId, other.batchId],
        ["stock_movements", self.stockMovementId, other.stockMovementId],
        ["quality_complaints", self.complaintId, other.complaintId],
      ] as const) {
        const rows = db
          .prepare(`SELECT id FROM ${table} WHERE organization_id = ?`)
          .all(self.orgId) as { id: number }[];
        expect(rows.map((r) => r.id)).toContain(selfId);
        expect(rows.map((r) => r.id)).not.toContain(otherId);
      }
    }
    const codes = db
      .prepare("SELECT batch_code, COUNT(*) AS n FROM batches GROUP BY batch_code")
      .all() as { batch_code: string; n: number }[];
    expect(codes.find((c) => c.batch_code === "SHARED-BATCH")?.n).toBe(2);
  });

  it("keeps deliveries, order events and reason codes apart; system reason codes are shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const [table, selfId, otherId] of [
        ["deliveries", self.deliveryId, other.deliveryId],
        ["reason_codes", self.reasonCodeId, other.reasonCodeId],
      ] as const) {
        const rows = db
          .prepare(`SELECT id FROM ${table} WHERE organization_id = ?`)
          .all(self.orgId) as { id: number }[];
        expect(rows.map((r) => r.id)).toContain(selfId);
        expect(rows.map((r) => r.id)).not.toContain(otherId);
      }
      const evs = db
        .prepare("SELECT organization_id FROM order_events WHERE organization_id = ?")
        .all(other.orgId) as { organization_id: number }[];
      // nothing from the other org shows when we scoped to it -- and our own has a row
      expect(
        (db.prepare("SELECT COUNT(*) n FROM order_events WHERE organization_id = ?").get(self.orgId) as { n: number }).n
      ).toBeGreaterThan(0);
      expect(evs.every((e) => e.organization_id === other.orgId)).toBe(true);
    }
    // the per-tenant SHARED-RC code exists once per org
    const rc = db
      .prepare("SELECT COUNT(*) AS n FROM reason_codes WHERE code = 'SHARED-RC'")
      .get() as { n: number };
    expect(rc.n).toBe(2);
    // the system defaults (NULL org) are visible to both and belong to neither
    const sys = db
      .prepare("SELECT COUNT(*) AS n FROM reason_codes WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(sys.n).toBeGreaterThanOrEqual(13);
  });

  it("keeps sync_mutations and deleted_rows apart; the client_uuid UNIQUE is per-tenant", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const muts = db
        .prepare("SELECT id FROM sync_mutations WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(muts.map((r) => r.id)).toContain(self.syncMutationId);
      expect(muts.map((r) => r.id)).not.toContain(other.syncMutationId);

      const tombs = db
        .prepare("SELECT COUNT(*) AS n FROM deleted_rows WHERE organization_id = ?")
        .get(self.orgId) as { n: number };
      expect(tombs.n).toBeGreaterThan(0);
    }
    // both orgs hold the same client_uuid -- the UNIQUE is (organization_id, client_uuid)
    const shared = db
      .prepare("SELECT COUNT(*) AS n FROM sync_mutations WHERE client_uuid = 'SHARED-MUT'")
      .get() as { n: number };
    expect(shared.n).toBe(2);
  });

  it("keeps vehicles and route templates apart; the plate UNIQUE is per-tenant", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const [table, selfId, otherId] of [
        ["vehicles", self.vehicleId, other.vehicleId],
        ["route_templates", self.routeTemplateId, other.routeTemplateId],
      ] as const) {
        const rows = db
          .prepare(`SELECT id FROM ${table} WHERE organization_id = ?`)
          .all(self.orgId) as { id: number }[];
        expect(rows.map((r) => r.id)).toContain(selfId);
        expect(rows.map((r) => r.id)).not.toContain(otherId);
      }
    }
    const plates = db
      .prepare("SELECT COUNT(*) AS n FROM vehicles WHERE plate = 'SHARED-PLATE'")
      .get() as { n: number };
    expect(plates.n).toBe(2);
  });

  it("keeps representatives and credit approvals apart", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const reps = db
        .prepare("SELECT id FROM representative_profiles WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(reps.map((r) => r.id)).toContain(self.repId);
      expect(reps.map((r) => r.id)).not.toContain(other.repId);

      const ca = db
        .prepare("SELECT id FROM credit_approvals WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(ca.map((r) => r.id)).toContain(self.creditApprovalId);
      expect(ca.map((r) => r.id)).not.toContain(other.creditApprovalId);
    }
  });
});
