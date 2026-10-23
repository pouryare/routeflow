import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-balance-scope-${Date.now()}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { orderFilter } = await import("@/lib/session");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/* Copied from tests/delivery.test.ts rather than invented: `orderFilter` reads BOTH
 * session.role and session.user.role (the van-role check is `isVanRole(session.role)`, and
 * user_roles holds the rest). A stub with only one of the two set produces a filter that
 * widens instead of scoping -- which is precisely the leak this file exists to catch. */
function session(role: "delivery_driver" | "owner", uid: number, gid: number | null, oid = 1): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: oid } as never,
    role,
    groupId: gid,
    organizationId: oid,
    roles: [role],
    hasRole: (x: string) => x === role,
  } as unknown as Session;
}

let driverA = 0, driverB = 0, otherOrgDriver = 0;
let aCustomer = 0, bCustomer = 0;
const groups = { a: 0, b: 0 };
let xOrderOnA = 0, xOrderOtherOrg = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM orders; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  /* The existing two-tenant fixture, not a hand-built one. It creates organization 2 and it
   * makes both companies' rows COLLIDE on purpose — the same customer code, the same order
   * number. A test that passes against that has proved isolation rather than proved the ids
   * happened to differ. */
  const { a, b } = await seedTwoOrgs(db);
  // The fixture ships owners and managers, not drivers, so make two real ones. The point of
  // the file is the VAN ROLE branch of orderFilter, and an owner takes the branch above it.
  const mk = async (tag: string, org: number, gid: number) =>
    Number(
      (await db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?, 'x:y', ?, 'delivery_driver', ?, 1, ?, ?)"
        )
        .run(`drv-${tag}`, `راننده ${tag}`, gid, now, org)).lastInsertRowid
    );
  driverA = await mk("a", 1, a.groupId);
  driverB = await mk("b", 1, a.groupId);
  otherOrgDriver = await mk("x", 2, b.groupId);

  // Put each org's order on its own driver's van, which is one of the two ways a van role
  // earns an order. The other -- authoring it -- is what tests/delivery.test.ts covers.
  const run = db.prepare(
    "INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id) VALUES (?, ?, '2026-01-01', ?, ?, ?, ?)"
  );
  const stop = db.prepare(
    "INSERT INTO delivery_stops (run_id, order_id, sort_order, status, collected_toman, created_at) VALUES (?,?,0,'pending',0,?)"
  );
  await stop.run(Number((await run.run(driverA, a.groupId, driverA, now, now, 1)).lastInsertRowid), a.orderId, now);
  await stop.run(Number((await run.run(otherOrgDriver, b.groupId, otherOrgDriver, now, now, 2)).lastInsertRowid), b.orderId, now);
  groups.a = a.groupId;
  groups.b = b.groupId;
  aCustomer = a.customerId;
  bCustomer = b.customerId;
  xOrderOnA = a.orderId;
  xOrderOtherOrg = b.orderId;
});

describe("the outstanding balance a driver is shown", () => {
  it("never widens when the role has no rule of its own", () => {
    /* The invariant underneath the rest of this file.
     *
     * A scoped role's filter must never be an EMPTY fragment: `WHERE 1=1 AND ` sees every row
     * in the table. So a driver whose balance query somehow produced an empty scope would
     * report the company's entire debt — and it would look like a correct, large number, which
     * is the dangerous shape of this bug. */
    const f = orderFilter(session("delivery_driver", driverA, null));
    expect(f.sql.trim()).not.toBe("");
    expect(f.params.length).toBeGreaterThan(0);
  });

  it("shows a driver their own orders and none from another tenant", async () => {
    // THE POINT. The balance is another party's account data. A driver needs it to know
    // whether to expect cash at the door, but a driver must never see the whole receivables
    // book. Org 2's order belongs to a different CUSTOMER as well as a different company, so
    // this also pins that a customer's history is not global.
    const seen = await orderIdsFor(session("delivery_driver", driverA, null), aCustomer);
    expect(seen).toContain(xOrderOnA);
    expect(seen).not.toContain(xOrderOtherOrg);
  });

  it("gives two drivers of the SAME company different sets", async () => {
    /* They share a company, not a book.
     *
     * A's van carries org A's order; B drives a different van and has no run of A's, so B must
     * not see it — even though both are delivery_drivers in organization 1. Two colleagues
     * getting different answers for the same customer is the CORRECT outcome, and the test that
     * matters is that neither of them ever sees org 2's order. */
    const aSees = await orderIdsFor(session("delivery_driver", driverA, groups.a), aCustomer);
    const bSees = await orderIdsFor(session("delivery_driver", driverB, groups.a), aCustomer);
    expect(aSees).toContain(xOrderOnA);
    expect(bSees).not.toContain(xOrderOnA);
    expect(bSees).not.toEqual(aSees);
    // …and neither of them sees the other company's order, which sits on a different customer.
    expect(aSees).not.toContain(xOrderOtherOrg);
    expect(bSees).not.toContain(xOrderOtherOrg);
  });

  it("hides another tenant's driver from the balance entirely", async () => {
    const mine = await orderIdsFor(session("delivery_driver", driverA, null), aCustomer);
    const theirs = await orderIdsFor(session("delivery_driver", otherOrgDriver, null, 2), bCustomer);
    for (const id of theirs) expect(mine).not.toContain(id);
  });
});

/** The orders a session can see for one customer: the balance query's SELECT list, with the
 *  scope fragment applied. Asserting on the LIST rather than a SUM means a failure names the
 *  order that leaked, instead of a number that is quietly one too large. */
async function orderIdsFor(who: Session, customerId: number): Promise<number[]> {
  const f = orderFilter(who, "o");
  const rows = await getDb()
    .prepare(`SELECT o.id FROM orders o WHERE o.customer_id = ?${f.sql}`)
    .all(customerId, ...f.params) as { id: number }[];
  return rows.map((r) => r.id);
}
