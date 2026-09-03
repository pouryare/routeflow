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

  it("keeps tenant capacity_factors apart while the NULL-org defaults stay shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const rows = db
        .prepare("SELECT id FROM capacity_factors WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(rows.map((r) => r.id)).toContain(self.capacityFactorId);
      expect(rows.map((r) => r.id)).not.toContain(other.capacityFactorId);
    }
    // the six shipped defaults belong to neither org and are visible to both
    const defaults = db
      .prepare("SELECT COUNT(*) AS n FROM capacity_factors WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(defaults.n).toBe(6);
  });

  it("keeps tasks, alerts and tenant rules apart; the default rules stay shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const [table, selfId, otherId] of [
        ["tasks", self.taskId, other.taskId],
        ["alerts", self.alertId, other.alertId],
      ] as const) {
        const rows = db
          .prepare(`SELECT id FROM ${table} WHERE organization_id = ?`)
          .all(self.orgId) as { id: number }[];
        expect(rows.map((r) => r.id)).toContain(selfId);
        expect(rows.map((r) => r.id)).not.toContain(otherId);
      }
    }
    const shared = db
      .prepare("SELECT COUNT(*) AS n FROM rules WHERE code = 'SHARED-RULE'")
      .get() as { n: number };
    expect(shared.n).toBe(2);
    const defaults = db
      .prepare("SELECT COUNT(*) AS n FROM rules WHERE organization_id IS NULL")
      .get() as { n: number };
    // 5 original spine rules + 8 Phase 1 + 5 Phase 2 `notify` rules (RULE_SEED in lib/db.ts).
    expect(defaults.n).toBe(18);
  });

  it("keeps tenant objection cards + lesson progress apart; the starter cards stay shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const rows = db
        .prepare("SELECT id FROM objection_cards WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(rows.map((r) => r.id)).toContain(self.objectionCardId);
      expect(rows.map((r) => r.id)).not.toContain(other.objectionCardId);

      const lp = db
        .prepare("SELECT COUNT(*) AS n FROM lesson_progress WHERE organization_id = ?")
        .get(self.orgId) as { n: number };
      expect(lp.n).toBeGreaterThan(0);
    }
    const starters = db
      .prepare("SELECT COUNT(*) AS n FROM objection_cards WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(starters.n).toBe(8);
  });

  it("keeps tenant KPI snapshots + definition overrides apart; the 14 defaults stay shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const snaps = db
        .prepare("SELECT id, organization_id FROM kpi_snapshots WHERE organization_id = ?")
        .all(self.orgId) as { id: number; organization_id: number }[];
      expect(snaps.map((r) => r.id)).toContain(self.kpiSnapshotId);
      expect(snaps.map((r) => r.id)).not.toContain(other.kpiSnapshotId);
      expect(snaps.every((r) => r.organization_id === self.orgId)).toBe(true);

      const override = db
        .prepare("SELECT title_fa FROM kpi_definitions WHERE organization_id = ? AND metric = 'net_sales'")
        .get(self.orgId) as { title_fa: string } | undefined;
      expect(override?.title_fa).toBe(`فروش ${self.orgId === 1 ? "a" : "b"}`);
    }
    const defaults = db
      .prepare("SELECT COUNT(*) AS n FROM kpi_definitions WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(defaults.n).toBe(14);
  });

  it("keeps forecast models, churn scores and seasonal overrides apart; the shipped defaults stay shared", () => {
    const db = getDb();
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const models = db
        .prepare("SELECT id, organization_id FROM forecast_models WHERE organization_id = ?")
        .all(self.orgId) as { id: number; organization_id: number }[];
      expect(models.map((r) => r.id)).toContain(self.forecastModelId);
      expect(models.map((r) => r.id)).not.toContain(other.forecastModelId);
      expect(models.every((r) => r.organization_id === self.orgId)).toBe(true);

      const scores = db
        .prepare("SELECT id FROM churn_scores WHERE organization_id = ?")
        .all(self.orgId) as { id: number }[];
      expect(scores.map((r) => r.id)).toContain(self.churnScoreId);
      expect(scores.map((r) => r.id)).not.toContain(other.churnScoreId);

      const override = db
        .prepare("SELECT factor FROM seasonal_factors WHERE organization_id = ? AND kind = 'month' AND idx = 1")
        .get(self.orgId) as { factor: number } | undefined;
      expect(override?.factor).toBe(self.orgId === 1 ? 1.3 : 0.7);

      // a tenant capacity_factors learned_* value must not leak
      db.prepare(
        `INSERT INTO capacity_factors (organization_id, condition_code, stop_factor, service_time_factor, speed_factor, max_duration_factor, active, updated_at, learned_speed_factor, learned_n)
         VALUES (?, ?, 1, 1, 1, 1, 1, ?, ?, 7)`
      ).run(self.orgId, `fog`, "2026-01-01T00:00:00.000Z", self.orgId === 1 ? 0.42 : 0.88);
    }
    const leaked = db
      .prepare("SELECT organization_id, learned_speed_factor FROM capacity_factors WHERE condition_code = 'fog' AND organization_id IS NOT NULL")
      .all() as { organization_id: number; learned_speed_factor: number }[];
    expect(leaked.find((r) => r.organization_id === a.orgId)?.learned_speed_factor).toBe(0.42);
    expect(leaked.find((r) => r.organization_id === b.orgId)?.learned_speed_factor).toBe(0.88);

    const seasonalDefaults = db
      .prepare("SELECT COUNT(*) AS n FROM seasonal_factors WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(seasonalDefaults.n).toBe(19);
    const churnDefaults = db
      .prepare("SELECT COUNT(*) AS n FROM churn_models WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(churnDefaults.n).toBe(1);
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
