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
    organizationId: 1,
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
beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM sales; DELETE FROM districts; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;",
  );
  const now = new Date().toISOString();
  mine = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('مال من','a',?,1)").run(now)
      .lastInsertRowid,
  );
  theirs = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('مال آنها','b',?,1)").run(now)
      .lastInsertRowid,
  );
  owner = Number(
    db.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)",
    ).run(now).lastInsertRowid,
  );
  manager = Number(
    db.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('m','x','گ','group_manager',?,?,1)",
    ).run(mine, now).lastInsertRowid,
  );
});

function customer(name: string, group: number, lastPurchaseDaysAgo: number | null) {
  const db = getDb();
  return Number(
    db.prepare(
      "INSERT INTO customers (customer_code,business_name,lifecycle,last_purchase_date,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,?,1)",
    ).run(name, name, lastPurchaseDaysAgo === null ? null : iso(lastPurchaseDaysAgo).slice(0, 10), iso(0), group)
      .lastInsertRowid,
  );
}

function district(group: number, status: string) {
  getDb()
    .prepare(
      "INSERT INTO districts (name,level,boundary_geojson,coverage_status,updated_at,group_id,organization_id) VALUES ('م'||abs(random()),'mantaghe','{}',?,?,?,1)",
    )
    .run(status, new Date().toISOString(), group);
}

describe("coverageAnalytics scoping", () => {
  it("a manager counts only their own group's districts", () => {
    district(mine, "visited");
    district(theirs, "visited");
    district(theirs, "visited");

    expect(coverageAnalytics(session("group_manager", manager, mine)).districtTotal).toBe(1);
    expect(coverageAnalytics(session("owner", owner, null)).districtTotal).toBe(3);
  });

  it("a manager's dormant count excludes another group's quiet customers", () => {
    customer("مالِ من", mine, 90);
    customer("مالِ آنها", theirs, 90);
    customer("تازه", mine, 3);

    expect(coverageAnalytics(session("group_manager", manager, mine)).dormant).toBe(1);
    expect(coverageAnalytics(session("owner", owner, null)).dormant).toBe(2);
  });

  it("dormancy is 30 days, and a customer who never bought is not dormant", () => {
    customer("مرز", mine, 31);
    customer("تازه", mine, 29);
    customer("هرگز", mine, null);
    expect(coverageAnalytics(session("group_manager", manager, mine)).dormant).toBe(1);
  });

  it("a manager's cost-to-serve rows are their own customers only", () => {
    customer("الف", mine, 5);
    customer("ب", theirs, 5);
    const rows = coverageAnalytics(session("group_manager", manager, mine)).costToServe;
    expect(rows.map((r) => r.business_name)).toEqual(["الف"]);
  });

  it("says match quality is unmeasurable rather than reporting a confident zero", () => {
    const db = getDb();
    customer("شناخته", mine, 5);
    db.prepare(
      "INSERT INTO sales (customer_name,amount,sale_date,imported_at) VALUES ('شناخته',100,?,?)",
    ).run(iso(3).slice(0, 10), iso(0));
    db.prepare(
      "INSERT INTO sales (customer_name,amount,sale_date,imported_at) VALUES ('ناشناخته',900,?,?)",
    ).run(iso(3).slice(0, 10), iso(0));

    /* Counting rows that match NO customer needs the unscoped `sales` table, and `sales`
       predates tenancy — it has no organization_id, so the join to `customers` is the
       only tenancy it has. An owner therefore cannot be given that read without handing
       them another organisation's sales. Both org-scoped roles get the join, and both
       must SAY so rather than report a confident zero. */
    for (const s of [session("owner", owner, null), session("group_manager", manager, mine)]) {
      const r = coverageAnalytics(s);
      expect(r.match.measurable).toBe(false);
      expect(r.match.unmatchedRows).toBe(0);
      expect(r.costToServe.find((c) => c.business_name === "شناخته")?.revenue).toBe(100);
    }

    /* A platform_owner legitimately spans organisations, so for them the count is real. */
    const asPlatform = coverageAnalytics(session("platform_owner", owner, null));
    expect(asPlatform.match.measurable).toBe(true);
    expect(asPlatform.match.unmatchedRows).toBe(1);
    expect(asPlatform.match.unmatchedRevenue).toBe(900);
  });

  it("always returns eight weekly buckets, oldest first, even with no activity", () => {
    const { weeks } = coverageAnalytics(session("owner", owner, null));
    expect(weeks).toHaveLength(8);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });
});
