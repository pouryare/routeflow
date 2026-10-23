import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `tier-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { savePlan, planFor, listPlans, deletePlan } = await import("@/lib/repo/commissionTiers");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let org = 0;
let otherOrg = 0;
let owner = 0;
let seller = 0;

const TWO = {
  mode: "marginal" as const,
  metric: "kg" as const,
  tiers: [
    { from_value: 0, to_value: 100, rate_type: "flat" as const, rate_value: 1_000 },
    { from_value: 100, to_value: null, rate_type: "flat" as const, rate_value: 2_000 },
  ],
};

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const mk = async (name: string, slug: string) =>
    Number(
      (await db
        .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
        .run(name, slug, now)).lastInsertRowid,
    );
  org = await mk("T", `t-${Date.now()}`);
  otherOrg = await mk("Other", `o-${Date.now()}`);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,organization_id,created_at) VALUES (?,?,?,?,?,?)",
  );
  owner = Number((await u.run(`o${Date.now()}`, "x", "owner", "owner", org, now)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x", "فروشنده", "salesperson", org, now)).lastInsertRowid);
});

describe("the commission_tiers repo", () => {
  it("a saved plan round-trips through planFor", async () => {
    await savePlan({ salesperson_user_id: seller, organization_id: org, plan: TWO, valid_from: "2026-01-01", created_by: owner });
    const got = await planFor(org, seller, "2026-06-01");
    expect(got).not.toBeNull();
    expect(got!.tiers).toEqual(TWO.tiers);
    expect(got!.mode).toBe("marginal");
    expect(got!.metric).toBe("kg");
  });

  it("a personal plan beats the company default", async () => {
    await savePlan({ salesperson_user_id: null, organization_id: org, plan: { ...TWO, metric: "revenue_toman" }, valid_from: "2026-01-01", created_by: owner });
    // The seller has their own plan, so the default must not win.
    expect((await planFor(org, seller, "2026-06-01"))!.metric).toBe("kg");
    // Someone with no personal plan gets the default.
    expect((await planFor(org, owner, "2026-06-01"))!.metric).toBe("revenue_toman");
  });

  it("a personal plan does NOT apply before its valid_from", async () => {
    // Mirrors rateFor in lib/commission.ts: before its start date the person is on the
    // company default, not on no plan at all.
    await savePlan({ salesperson_user_id: seller, organization_id: org, plan: { ...TWO, metric: "margin_toman" }, valid_from: "2027-01-01", created_by: owner });
    // Their 2026 plan still governs 2026; the 2027 one starts on its own date.
    expect((await planFor(org, seller, "2026-06-01"))!.metric).toBe("kg");
    expect((await planFor(org, seller, "2027-06-01"))!.metric).toBe("margin_toman");
  });

  it("saving a new plan from a later date does not delete the earlier one", async () => {
    await savePlan({ salesperson_user_id: owner, organization_id: org, plan: { ...TWO, metric: "volume_m3" }, valid_from: "2028-01-01", created_by: owner });
    await savePlan({ salesperson_user_id: owner, organization_id: org, plan: { ...TWO, metric: "orders" }, valid_from: "2029-01-01", created_by: owner });
    expect((await planFor(org, owner, "2027-01-01"))!.metric).toBe("revenue_toman"); // the default
    expect((await planFor(org, owner, "2028-06-01"))!.metric).toBe("volume_m3");
    expect((await planFor(org, owner, "2029-06-01"))!.metric).toBe("orders");
  });

  it("savePlan throws on a gapped plan and writes nothing", async () => {
    const gapped = { ...TWO, tiers: [
      { from_value: 0, to_value: 100, rate_type: "flat" as const, rate_value: 1_000 },
      { from_value: 200, to_value: null, rate_type: "flat" as const, rate_value: 2_000 },
    ] };
    await expect((async () =>
      await savePlan({ salesperson_user_id: seller, organization_id: org, plan: gapped, valid_from: "2030-01-01", created_by: owner }))()).rejects.toThrow();
    // And nothing landed: the 2027 plan is still the one in force for 2030.
    expect((await planFor(org, seller, "2030-06-01"))!.metric).toBe("margin_toman");
  });

  it("a plan from another organization is never returned", async () => {
    await savePlan({ salesperson_user_id: seller, organization_id: otherOrg, plan: { ...TWO, metric: "volume_m3" }, valid_from: "2031-01-01", created_by: owner });
    // Other org set the seller's plan to volume from 2031. In OUR org it must not appear.
    expect((await planFor(org, seller, "2031-06-01"))!.metric).not.toBe("volume_m3");
  });

  it("deletePlan removes only that person's plan from that date", async () => {
    await savePlan({ salesperson_user_id: owner, organization_id: org, plan: { ...TWO, metric: "volume_m3" }, valid_from: "2032-01-01", created_by: owner });
    expect((await planFor(org, owner, "2032-06-01"))!.metric).toBe("volume_m3");
    await deletePlan(org, owner, "2032-01-01");
    // Falls back to whatever governed before.
    expect((await planFor(org, owner, "2032-06-01"))!.metric).not.toBe("volume_m3");
  });

  it("listPlans returns only this organisation's plans", async () => {
    await savePlan({ salesperson_user_id: owner, organization_id: org, plan: { ...TWO, metric: "orders" }, valid_from: "2033-01-01", created_by: owner });
    const mine = await listPlans(org);
    expect(mine.length).toBeGreaterThan(0);
    // Every row we get back must belong to us; the other org's plan is not in here.
    const db = getDb();
    const otherRows = await db
      .prepare("SELECT COUNT(*) AS n FROM commission_tiers WHERE organization_id = ?")
      .get(otherOrg) as { n: number };
    expect(mine.filter((p) => p.tiers.length === 0)).toEqual([]);
    expect(otherRows.n).toBeGreaterThan(0);
  });

  it("every tier row carries its organization, so the backfill sweep has something to find", async () => {
    await savePlan({ salesperson_user_id: owner, organization_id: org, plan: TWO, valid_from: "2034-01-01", created_by: owner });
    const db = getDb();
    const row = await db
      .prepare("SELECT organization_id FROM commission_tiers WHERE valid_from = ? LIMIT 1")
      .get("2034-01-01") as { organization_id: number | null };
    expect(row.organization_id).toBe(org);
  });
});
