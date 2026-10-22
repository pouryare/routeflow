import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/sessionReads.ts: the customers a caller may reach and their organisation's catalogue,
 * as functions of the session. Two organisations with colliding natural keys. */

const testDbPath = path.join(os.tmpdir(), `rf-session-reads-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { customersFor, catalogueFor } = await import("@/lib/repo/sessionReads");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let otherGroupInA = 0;
let customerInOtherGroup = 0;

function session(role: "owner" | "group_manager", uid: number, gid: number | null, oid: number): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: oid, active: 1 } as never,
    role, groupId: gid, organizationId: oid, roles: [role], hasRole: (x: string) => x === role,
  } as unknown as Session;
}

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  const db = getDb();
  otherGroupInA = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('other', 'other-a', '2026-01-01', 1)").run().lastInsertRowid
  );
  customerInOtherGroup = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at, group_id, organization_id) VALUES ('OTHER-1', 'other group customer', '2026-01-01', ?, 1)")
      .run(otherGroupInA).lastInsertRowid
  );
});

describe("customersFor", () => {
  it("shows an owner their whole organisation and nothing of another", () => {
    const ids = customersFor(session("owner", a.ownerId, null, 1)).map((c) => c.id);
    expect(ids).toContain(a.customerId);
    expect(ids).toContain(customerInOtherGroup);
    expect(ids).not.toContain(b.customerId);
  });

  it("shows a group manager only their own group's customers", () => {
    const ids = customersFor(session("group_manager", a.managerId, a.groupId, 1)).map((c) => c.id);
    expect(ids).toContain(a.customerId);
    expect(ids).not.toContain(customerInOtherGroup);
    expect(ids).not.toContain(b.customerId);
  });

  it("attaches each customer's computed debt only when asked", () => {
    const owner = session("owner", a.ownerId, null, 1);
    // Customer's declared type predates the attached balance, so read the field structurally.
    const debtOf = (rows: { id: number }[]) => (rows.find((c) => c.id === a.customerId) as unknown as { debt?: unknown }).debt;
    expect(debtOf(customersFor(owner))).toBeUndefined();
    expect(debtOf(customersFor(owner, { withDebt: true }))).toBeDefined();
  });
});

describe("catalogueFor", () => {
  it("lists only the caller's organisation's products", () => {
    const own = catalogueFor(session("owner", a.ownerId, null, 1)).map((p) => p.id);
    expect(own).toContain(a.productId);
    expect(own).not.toContain(b.productId);
    expect(catalogueFor(session("owner", b.ownerId, null, 2)).map((p) => p.id)).toEqual(expect.arrayContaining([b.productId]));
  });
});
