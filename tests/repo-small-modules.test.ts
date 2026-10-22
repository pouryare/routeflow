import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* Covers the nine small lib/repo modules that had no test of their own (architecture audit,
 * step 1, section E): commissionRates, orderLines, organizations, productCosts, userOrg, base,
 * crm/state, crm/http and leadImportNotify. Most of them are the tenant-boundary helpers other
 * code leans on, which is why a silent change to one of them matters. */

const testDbPath = path.join(os.tmpdir(), `rf-repo-small-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { companyRatePerKg, managerOverridePct } = await import("@/lib/repo/commissionRates");
const { linesByOrder } = await import("@/lib/repo/orderLines");
const { allOrgIds, userInOrg } = await import("@/lib/repo/organizations");
const { costRowsFor, effectiveCost, avgCostFor, productInOrganization, packagingBelongsTo } = await import("@/lib/repo/productCosts");
const { orgOfUser } = await import("@/lib/repo/userOrg");
const { makeRepo } = await import("@/lib/repo/base");
const { recomputeState } = await import("@/lib/repo/crm/state");
const { crmErrorResponse, idParam, CRM_ROLES } = await import("@/lib/repo/crm/http");
const { CrmError } = await import("@/lib/repo/crm/write");
const { maybeNotifySlowJob } = await import("@/lib/repo/leadImportNotify");
const { createJob } = await import("@/lib/repo/leadImport");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
const NOW = "2026-01-01T00:00:00.000Z";

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
});

describe("commissionRates", () => {
  const rate = (org: number, perKg: number, from: string) =>
    getDb()
      .prepare(
        "INSERT INTO commission_rates (organization_id, salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (?, NULL, ?, ?, ?)"
      )
      .run(org, perKg, from, NOW);

  it("companyRatePerKg is null until a rate has started, and never reads another tenant's", () => {
    expect(companyRatePerKg(getDb(), 1, "2026-06-01")).toBeNull();
    rate(2, 999, "2026-01-01");
    expect(companyRatePerKg(getDb(), 1, "2026-06-01")).toBeNull();
    expect(companyRatePerKg(getDb(), 2, "2026-06-01")).toBe(999);
  });

  it("picks the rate in force on the date, and the higher id on a shared start date", () => {
    rate(1, 100, "2026-01-01");
    rate(1, 150, "2026-03-01");
    rate(1, 175, "2026-03-01"); // corrected the same day: replaces the typo
    expect(companyRatePerKg(getDb(), 1, "2025-12-31")).toBeNull();
    expect(companyRatePerKg(getDb(), 1, "2026-02-01")).toBe(100);
    expect(companyRatePerKg(getDb(), 1, "2026-03-01")).toBe(175);
  });

  it("ignores a per-salesperson rate (only the company-wide one)", () => {
    getDb()
      .prepare("INSERT INTO commission_rates (organization_id, salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (1, ?, 5000, '2026-01-01', ?)")
      .run(a.managerId, NOW);
    expect(companyRatePerKg(getDb(), 1, "2026-02-01")).toBe(100);
  });

  it("managerOverridePct is scoped by organisation and manager, null when none", () => {
    const ins = getDb().prepare(
      "INSERT INTO manager_commission_overrides (organization_id, manager_user_id, override_pct, valid_from, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    ins.run(1, a.managerId, 5, "2026-01-01", NOW);
    ins.run(1, a.managerId, 8, "2026-04-01", NOW);
    expect(managerOverridePct(getDb(), 1, a.managerId, "2026-02-01")).toBe(5);
    expect(managerOverridePct(getDb(), 1, a.managerId, "2026-05-01")).toBe(8);
    expect(managerOverridePct(getDb(), 1, a.managerId, "2025-01-01")).toBeNull();
    expect(managerOverridePct(getDb(), 2, a.managerId, "2026-05-01")).toBeNull(); // wrong tenant
    expect(managerOverridePct(getDb(), 2, b.managerId, "2026-05-01")).toBeNull(); // none set
  });
});

describe("orderLines.linesByOrder", () => {
  let seq = 0;
  const line = (orderId: number, productId: number, packs: number) => {
    const packagingId = Number(
      getDb()
        .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, 2, ?)")
        .run(productId, `ol-${++seq}`, NOW).lastInsertRowid
    );
    getDb()
      .prepare(
        `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
         VALUES (?, ?, ?, ?, ?, 1000, 600, 2, 0.5, ?)`
      )
      .run(orderId, productId, packagingId, packs, packs, NOW);
  };

  it("groups lines by order in id order, omits an order with no lines, and dedupes ids", () => {
    line(a.orderId, a.productId, 1);
    line(a.orderId, a.productId, 2);
    line(a.orderId, a.productId, 3);
    const map = linesByOrder(getDb(), [a.orderId, a.orderId, b.orderId]);
    expect([...map.keys()]).toEqual([a.orderId]);
    expect(map.get(a.orderId)!.map((l) => l.packs_ordered)).toEqual([1, 2, 3]);
    expect(map.get(a.orderId)![0]).not.toHaveProperty("order_id");
    expect(map.get(a.orderId)![0]).toMatchObject({ unit_price_toman: 1000, unit_cost_toman: 600, qty_per_pack: 2, kg_per_base_unit: 0.5 });
  });

  it("returns an empty map for no ids, and handles more than one 500-id chunk", () => {
    expect(linesByOrder(getDb(), []).size).toBe(0);
    line(b.orderId, b.productId, 7);
    const many = [...Array.from({ length: 1200 }, (_, i) => 100_000 + i), a.orderId, b.orderId];
    const map = linesByOrder(getDb(), many);
    expect([...map.keys()].sort((x, y) => x - y)).toEqual([a.orderId, b.orderId].sort((x, y) => x - y));
    expect(map.get(b.orderId)!.map((l) => l.packs_ordered)).toEqual([7]);
  });
});

describe("organizations", () => {
  it("allOrgIds lists every tenant ascending", () => {
    expect(allOrgIds()).toEqual([1, 2]);
  });

  it("userInOrg is true only for the user's own organisation", () => {
    expect(userInOrg(getDb(), a.ownerId, 1)).toBe(true);
    expect(userInOrg(getDb(), a.ownerId, 2)).toBe(false);
    expect(userInOrg(getDb(), b.ownerId, 2)).toBe(true);
    expect(userInOrg(getDb(), 999_999, 1)).toBe(false);
  });
});

describe("productCosts", () => {
  let packA = 0;
  let packOther = 0;
  const cost = (productId: number, packagingId: number | null, c: number, from: string) =>
    getDb()
      .prepare("INSERT INTO product_costs (product_id, packaging_id, method, cost_toman, valid_from, created_at) VALUES (?, ?, 'landed', ?, ?, ?)")
      .run(productId, packagingId, c, from, NOW);

  beforeAll(() => {
    const db = getDb();
    const mkPack = (productId: number, label: string) =>
      Number(
        db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, 12, ?)").run(productId, label, NOW)
          .lastInsertRowid
      );
    packA = mkPack(a.productId, "carton-a");
    packOther = mkPack(b.productId, "carton-b");
    cost(a.productId, null, 500, "2026-01-01");
    cost(a.productId, packA, 650, "2026-02-01");
  });

  it("costRowsFor returns only that product's rows", () => {
    expect(costRowsFor(getDb(), a.productId).map((r) => r.cost_toman).sort()).toEqual([500, 650]);
    expect(costRowsFor(getDb(), b.productId)).toEqual([]);
  });

  it("effectiveCost prefers the packaging-specific row, falls back to product-wide, else null", () => {
    const rows = costRowsFor(getDb(), a.productId);
    expect(effectiveCost(rows, packA, "2026-03-01")?.cost_toman).toBe(650);
    expect(effectiveCost(rows, null, "2026-03-01")?.cost_toman).toBe(500);
    expect(effectiveCost(rows, 987, "2026-03-01")?.cost_toman).toBe(500); // no row for that packaging
    expect(effectiveCost(rows, packA, "2026-01-15")?.cost_toman).toBe(500); // packaging row not started yet
    expect(effectiveCost(rows, packA, "2025-01-01")).toBeNull();
    expect(effectiveCost([], null, "2026-03-01")).toBeNull();
  });

  it("avgCostFor reads products.avg_cost_toman, null for an unknown product", () => {
    getDb().prepare("UPDATE products SET avg_cost_toman = 321 WHERE id = ?").run(a.productId);
    expect(avgCostFor(getDb(), a.productId)).toBe(321);
    expect(avgCostFor(getDb(), 999_999)).toBeNull();
  });

  it("productInOrganization is the tenant check before a cost write", () => {
    expect(productInOrganization(getDb(), a.productId, 1)).toBe(true);
    expect(productInOrganization(getDb(), a.productId, 2)).toBe(false);
    expect(productInOrganization(getDb(), b.productId, 1)).toBe(false);
  });

  it("packagingBelongsTo rejects a mismatched pair", () => {
    expect(packagingBelongsTo(getDb(), packA, a.productId)).toBe(true);
    expect(packagingBelongsTo(getDb(), packA, b.productId)).toBe(false);
    expect(packagingBelongsTo(getDb(), packOther, a.productId)).toBe(false);
  });
});

describe("orgOfUser", () => {
  it("returns the first known organisation, skipping null, undefined and unknown ids", () => {
    expect(orgOfUser(getDb(), a.ownerId)).toBe(1);
    expect(orgOfUser(getDb(), b.ownerId)).toBe(2);
    expect(orgOfUser(getDb(), null, undefined, 999_999, b.ownerId, a.ownerId)).toBe(2);
    expect(orgOfUser(getDb())).toBeNull();
    expect(orgOfUser(getDb(), null, 999_999)).toBeNull();
  });

  it("returns null for a user whose organisation is unset rather than guessing", () => {
    const id = Number(
      getDb()
        .prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES ('no-org', 'x:y', 'x', 'owner', ?)")
        .run(NOW).lastInsertRowid
    );
    expect(orgOfUser(getDb(), id)).toBeNull();
    expect(orgOfUser(getDb(), id, a.ownerId)).toBe(1);
  });
});

describe("base.makeRepo", () => {
  interface Task { id: number; kind: string; title: string; priority: string; status: string; created_at: string }
  const tenantRepo = makeRepo<Task & { organization_id: number }>("tasks", { tenant: true });
  const base = { kind: "call", priority: "NORMAL", status: "open", created_at: NOW };

  it("insert stamps the organisation, and get/list never cross tenants", () => {
    const idA = tenantRepo.insert(1, { ...base, title: "repo-a" } as never);
    const idB = tenantRepo.insert(2, { ...base, title: "repo-b" } as never);
    expect(tenantRepo.get(1, idA)?.title).toBe("repo-a");
    expect(tenantRepo.get(1, idA)?.organization_id).toBe(1);
    expect(tenantRepo.get(1, idB)).toBeUndefined();
    expect(tenantRepo.get(2, idA)).toBeUndefined();
    expect(tenantRepo.list(1, { title: "repo-b" } as never)).toEqual([]);
    expect(tenantRepo.list(2, { title: "repo-b" } as never).map((r) => r.id)).toEqual([idB]);
  });

  it("insert ignores an organization_id smuggled into the row", () => {
    const id = tenantRepo.insert(1, { ...base, title: "smuggle", organization_id: 2 } as never);
    expect(tenantRepo.get(1, id)?.organization_id).toBe(1);
    expect(tenantRepo.get(2, id)).toBeUndefined();
  });

  it("patch changes only the caller's own row; an empty patch is a no-op", () => {
    const idA = tenantRepo.insert(1, { ...base, title: "patch-me" } as never);
    tenantRepo.patch(2, idA, { title: "hijack" });
    expect(tenantRepo.get(1, idA)?.title).toBe("patch-me");
    tenantRepo.patch(1, idA, { title: "patched" });
    expect(tenantRepo.get(1, idA)?.title).toBe("patched");
    tenantRepo.patch(1, idA, {});
    expect(tenantRepo.get(1, idA)?.title).toBe("patched");
  });

  it("a non-tenant repo ignores the organisation argument", () => {
    const orgs = makeRepo<{ id: number; name: string; slug: string; created_at: string }>("organizations", { tenant: false });
    expect(orgs.get(2, 1)?.id).toBe(1);
    expect(orgs.list(1).length).toBeGreaterThanOrEqual(2);
    expect(orgs.db()).toBe(getDb());
  });
});

describe("crm/state.recomputeState", () => {
  const act = (customerId: number, at: string, cols: Record<string, unknown>) =>
    getDb()
      .prepare(
        `INSERT INTO activities (organization_id, customer_id, type, occurred_at, created_at, contact_status_to, stage_to, attempt, miss, talked)
         VALUES (1, ?, 'call', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(customerId, at, at, (cols.contact as string) ?? null, (cols.stage as string) ?? null, cols.attempt ? 1 : 0, cols.miss ? 1 : 0, cols.talked ? 1 : 0);
  const customer = (code: string, extra = "") =>
    Number(
      getDb()
        .prepare(`INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, group_id, organization_id) VALUES (?, ?, 'lead', ?, ?, 1)`)
        .run(code, code, NOW, a.groupId).lastInsertRowid
    ) + 0 * extra.length;
  const state = (id: number) =>
    getDb().prepare("SELECT contact_status, sales_stage, attempt_count, consecutive_misses, last_activity_at, lifecycle FROM customers WHERE id = ?").get(id) as {
      contact_status: string; sales_stage: string; attempt_count: number; consecutive_misses: number; last_activity_at: string | null; lifecycle: string;
    };

  it("folds the activity log into the cached columns on the customer", () => {
    const id = customer("RS-1");
    act(id, "2026-02-01T10:00:00.000Z", { attempt: true, miss: true });
    act(id, "2026-02-02T10:00:00.000Z", { attempt: true, miss: true });
    act(id, "2026-02-03T10:00:00.000Z", { attempt: true, talked: true, contact: "contacted", stage: "interested" });
    recomputeState(getDb(), id);
    const s = state(id);
    expect(s.attempt_count).toBe(3);
    expect(s.sales_stage).toBe("interested");
    expect(s.contact_status).toBe("contacted");
    expect(s.last_activity_at).toBe("2026-02-03T10:00:00.000Z");
    expect(s.lifecycle).toBe("qualified"); // lifecycleFor(interested, lead)
  });

  it("is idempotent, and a customer with no activities returns to the initial state", () => {
    const id = customer("RS-2");
    recomputeState(getDb(), id);
    const first = state(id);
    recomputeState(getDb(), id);
    expect(state(id)).toEqual(first);
    expect(first).toMatchObject({ contact_status: "not_contacted", sales_stage: "unknown", attempt_count: 0, last_activity_at: null, lifecycle: "lead" });
  });

  it("keeps a hand-set temperature when temperature_manual is on", () => {
    const id = customer("RS-3");
    getDb().prepare("UPDATE customers SET temperature_manual = 1, temperature = 'hot' WHERE id = ?").run(id);
    act(id, "2026-02-01T10:00:00.000Z", { attempt: true, miss: true });
    recomputeState(getDb(), id);
    expect((getDb().prepare("SELECT temperature FROM customers WHERE id = ?").get(id) as { temperature: string }).temperature).toBe("hot");
  });
});

describe("crm/http", () => {
  it("idParam accepts digits only", () => {
    expect(idParam("42")).toBe(42);
    expect(idParam("0")).toBe(0);
    for (const bad of ["", "-1", "1.5", "12a", "0x10", " 7", "7 ", "NaN"]) expect(idParam(bad), bad).toBeNull();
  });

  it("crmErrorResponse turns a CrmError into its JSON status, and rethrows anything else", async () => {
    const res = crmErrorResponse(new CrmError(404, "پیدا نشد", { code: "x" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "پیدا نشد", code: "x" });
    expect(crmErrorResponse(new CrmError(403, "no")).status).toBe(403);
    expect(() => crmErrorResponse(new Error("boom"))).toThrow("boom");
  });

  it("CRM_ROLES is the set of roles allowed into the CRM", () => {
    expect([...CRM_ROLES].sort()).toEqual(["group_manager", "owner", "phone_sales", "platform_owner", "rep_manager"]);
  });
});

describe("leadImportNotify.maybeNotifySlowJob", () => {
  const eventsFor = (org: number, job: number) =>
    (getDb().prepare("SELECT COUNT(*) AS n FROM events WHERE organization_id = ? AND kind = 'lead_import.slow' AND entity_id = ?").get(org, job) as { n: number }).n;

  it("notifies once per job: the second poll claims nothing and writes nothing", () => {
    const job = createJob(1, a.groupId, 500);
    const first = maybeNotifySlowJob(1, job, 500);
    /* KNOWN GAP, pinned: recipientsFor() (lib/repo/notifications.ts) has no branch for
       'lead_import.slow', so the fan-out finds nobody and nothing is delivered. The module's own
       comment says it tells "the tenant's managers"; who exactly is a product decision. When
       that branch is added this becomes > 0 and the line below is the one to change. */
    expect(first).toBe(0);
    expect(eventsFor(1, job)).toBe(1);
    expect(getDb().prepare("SELECT code FROM notification_types WHERE organization_id = 1 AND code = 'lead_import.slow'").get()).toBeTruthy();
    expect(maybeNotifySlowJob(1, job, 500)).toBe(0);
    expect(eventsFor(1, job)).toBe(1);
  });

  it.todo("delivers the slow-import notice to the job's managers (needs a recipientsFor branch)");

  it("will not claim another organisation's job", () => {
    const job = createJob(2, b.groupId, 100);
    expect(maybeNotifySlowJob(1, job, 100)).toBe(0);
    expect(eventsFor(1, job)).toBe(0);
    expect(eventsFor(2, job)).toBe(0);
    expect((getDb().prepare("SELECT notified_at FROM lead_import_jobs WHERE id = ?").get(job) as { notified_at: string | null }).notified_at).toBeNull();
  });
});
