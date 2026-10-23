import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-coverage-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { coverageAnalytics } = await import("@/lib/repo/coverageAnalytics");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function session(role: Role, uid: number, gid: number | null): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow,
    role,
    groupId: gid,
    organizationId: 1, roles: [role], hasRole: (x) => x === role 
  };
}

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

let mine = 0;
let theirs = 0;
let owner = 0;
let manager = 0;

/** The panels this repo feeds used to live on `/analytics`, which proxy.ts kept away
 *  from a فروشنده because every figure on it is a whole-group aggregate. Folding them
 *  into `/sales/dashboard` — a page a فروشنده CAN reach — moved that boundary from the
 *  edge of the app into this function's scoping, so these tests are what now holds it. */
beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM sales; DELETE FROM districts; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;",
  );
  const now = new Date().toISOString();
  mine = Number(
    (await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('مال من','a',?,1)").run(now))
      .lastInsertRowid,
  );
  theirs = Number(
    (await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('مال آنها','b',?,1)").run(now))
      .lastInsertRowid,
  );
  owner = Number(
    (await db.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)",
    ).run(now)).lastInsertRowid,
  );
  manager = Number(
    (await db.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('m','x','گ','group_manager',?,?,1)",
    ).run(mine, now)).lastInsertRowid,
  );
});

async function customer(name: string, group: number, lastPurchaseDaysAgo: number | null) {
  const db = getDb();
  return Number(
    (await db.prepare(
      "INSERT INTO customers (customer_code,business_name,lifecycle,last_purchase_date,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,?,1)",
    ).run(name, name, lastPurchaseDaysAgo === null ? null : iso(lastPurchaseDaysAgo).slice(0, 10), iso(0), group))
      .lastInsertRowid,
  );
}

async function district(group: number, status: string) {
  await getDb()
    .prepare(
      "INSERT INTO districts (name,level,boundary_geojson,coverage_status,updated_at,group_id) VALUES ('م'||abs(random()),'mantaghe','{}',?,?,?)",
    )
    .run(status, new Date().toISOString(), group);
}

describe("coverageAnalytics scoping", () => {
  it("a manager counts only their own group's districts", async () => {
    await district(mine, "visited");
    await district(theirs, "visited");
    await district(theirs, "visited");

    expect((await coverageAnalytics(session("group_manager", manager, mine))).districtTotal).toBe(1);
    expect((await coverageAnalytics(session("owner", owner, null))).districtTotal).toBe(3);
  });

  it("a manager's dormant count excludes another group's quiet customers", async () => {
    await customer("مالِ من", mine, 90);
    await customer("مالِ آنها", theirs, 90);
    await customer("تازه", mine, 3);

    expect((await coverageAnalytics(session("group_manager", manager, mine))).dormant).toBe(1);
    expect((await coverageAnalytics(session("owner", owner, null))).dormant).toBe(2);
  });

  it("dormancy is 30 days, and a customer who never bought is not dormant", async () => {
    await customer("مرز", mine, 31);
    await customer("تازه", mine, 29);
    await customer("هرگز", mine, null);
    expect((await coverageAnalytics(session("group_manager", manager, mine))).dormant).toBe(1);
  });

  it("a manager's cost-to-serve rows are their own customers only", async () => {
    await customer("الف", mine, 5);
    await customer("ب", theirs, 5);
    const rows = (await coverageAnalytics(session("group_manager", manager, mine))).costToServe;
    expect(rows.map((r) => r.business_name)).toEqual(["الف"]);
  });

  it("counts unmatched sales for an owner, scoped to their company, and says a manager cannot", async () => {
    const db = getDb();
    await customer("شناخته", mine, 5);
    await db.prepare(
      "INSERT INTO sales (customer_name,amount,sale_date,imported_at,organization_id) VALUES ('شناخته',100,?,?,1)",
    ).run(iso(3).slice(0, 10), iso(0));
    await db.prepare(
      "INSERT INTO sales (customer_name,amount,sale_date,imported_at,organization_id) VALUES ('ناشناخته',900,?,?,1)",
    ).run(iso(3).slice(0, 10), iso(0));
    // Another company's unmatched row must not be counted for this one.
    await db.prepare("INSERT INTO organizations (id, name, slug, active, created_at) VALUES (2, 'other', 'other', 1, ?) ON CONFLICT DO NOTHING").run(iso(0));
    await db.prepare(
      "INSERT INTO sales (customer_name,amount,sale_date,imported_at,organization_id) VALUES ('بیگانه',555,?,?,2)",
    ).run(iso(3).slice(0, 10), iso(0));

    /* `sales` now carries organization_id, so an owner can be given the unmatched count for their own
       company. A group manager still gets the join (scoped to their groups) and must SAY it cannot count
       rows that match no customer, rather than report a confident zero. */
    const asOwner = await coverageAnalytics(session("owner", owner, null));
    expect(asOwner.match.measurable).toBe(true);
    expect(asOwner.match.unmatchedRows).toBe(1);
    expect(asOwner.match.unmatchedRevenue).toBe(900);
    expect(asOwner.costToServe.find((c) => c.business_name === "شناخته")?.revenue).toBe(100);

    const asManager = await coverageAnalytics(session("group_manager", manager, mine));
    expect(asManager.match.measurable).toBe(false);
    expect(asManager.match.unmatchedRows).toBe(0);
    expect(asManager.costToServe.find((c) => c.business_name === "شناخته")?.revenue).toBe(100);
  });

  it("always returns eight weekly buckets, oldest first, even with no activity", async () => {
    const { weeks } = await coverageAnalytics(session("owner", owner, null));
    expect(weeks).toHaveLength(8);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });
});
