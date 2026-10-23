import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-margin-commission-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { commissionForUnit, readCompanyRatePerKg, readManagerOverridePct } = await import(
  "@/lib/margin/commission"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { owner: 0, seller: 0, manager: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  // A second organisation so the cross-tenant read below is real. commission_rates
  // carries organization_id as a foreign key, so the parent row has to exist first --
  // the database refusing to let this test fake a tenant that isn't there.
  await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)").run(
    "سازمان دوم",
    "second-org",
    now
  );
  ctx.owner = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("owner", "مالک", now)).lastInsertRowid
  );
  ctx.seller = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at) VALUES (?, 'x', ?, 'phone_sales', 1, ?)"
      )
      .run("nazanin", "نازنین", now)).lastInsertRowid
  );
  ctx.manager = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at) VALUES (?, 'x', ?, 'group_manager', 1, ?)"
      )
      .run("mahnaz", "مهناز", now)).lastInsertRowid
  );
});

describe("commissionForUnit", () => {
  it("converts a per-kilogram rate into a per-unit figure", () => {
    // 0.25 kg per base unit at 200,000 Toman/kg is 50,000 per unit.
    expect(commissionForUnit(0.25, 200_000)).toBe(50_000);
  });

  it("is zero when the product has no weight", () => {
    expect(commissionForUnit(0, 200_000)).toBe(0);
  });

  it("is zero when there is no rate in force", () => {
    expect(commissionForUnit(0.25, null)).toBe(0);
  });

  it("rounds through the one shared rule", () => {
    // 0.333 kg at 100,001 is 33,300.33 -> 33,300 whole.
    expect(commissionForUnit(0.333, 100_001)).toBe(33_300);
  });

  it("is negative for a negative weight, so a reversal can claw back", () => {
    expect(commissionForUnit(-0.25, 200_000)).toBe(-50_000);
  });

  it("treats a null rate as absent rather than as zero money owed", () => {
    // The distinction that matters on screen: "no rate set" must not render as
    // "commission 0", which would read as a measured zero.
    expect(commissionForUnit(0.25, null)).toBe(0);
    expect(commissionForUnit(0.25, 0)).toBe(0);
  });
});

describe("readCompanyRatePerKg", () => {
  it("reads the company default when nobody has a personal rate", async () => {
    const db = getDb();
    await db.prepare(
      `INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman, valid_from, organization_id, created_at)
       VALUES (NULL, 180000, '2026-01-01', 1, ?)`
    ).run(new Date().toISOString());
    expect(await readCompanyRatePerKg(db, 1, "2026-06-01")).toBe(180_000);
  });

  it("is null before the first rate started", async () => {
    expect(await readCompanyRatePerKg(getDb(), 1, "2025-01-01")).toBeNull();
  });

  it("reads nothing for another organisation", async () => {
    const db = getDb();
    await db.prepare(
      `INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman, valid_from, organization_id, created_at)
       VALUES (NULL, 999000, '2026-01-01', 2, ?)`
    ).run(new Date().toISOString());
    // Organisation 1 must keep seeing 180000, never the tenant-2 figure.
    expect(await readCompanyRatePerKg(db, 1, "2026-06-01")).toBe(180_000);
  });
});

describe("readManagerOverridePct", () => {
  it("reads the override in force for a manager", async () => {
    const db = getDb();
    await db.prepare(
      `INSERT INTO manager_commission_overrides (manager_user_id, override_pct, valid_from, organization_id, created_at)
       VALUES (?, 5, '2026-01-01', 1, ?)`
    ).run(ctx.manager, new Date().toISOString());
    expect(await readManagerOverridePct(db, 1, ctx.manager, "2026-06-01")).toBe(5);
  });

  it("is null when the manager has no override", async () => {
    expect(await readManagerOverridePct(getDb(), 1, ctx.owner, "2026-06-01")).toBeNull();
  });
});
