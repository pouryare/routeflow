import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/scheduleView.ts: the month plan's visits and runs are the caller's company's only. */

const testDbPath = path.join(os.tmpdir(), `rf-schedule-view-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { planViewData } = await import("@/lib/repo/scheduleView");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

const owner = (uid: number, oid: number): Session =>
  ({
    user: { id: uid, role: "owner", group_id: null, organization_id: oid, active: 1 } as never,
    role: "owner", groupId: null, organizationId: oid, roles: ["owner"], hasRole: (x: string) => x === "owner",
  }) as unknown as Session;

beforeAll(async () => {
  ({ a, b } = await seedTwoOrgs(getDb()));
  const plan = getDb().prepare("INSERT INTO visit_plans (entity_type, entity_id, planned_date, status, sort_order, created_at) VALUES ('customer', ?, '2026-01-10', 'planned', 0, '2026-01-01')");
  await plan.run(a.customerId);
  await plan.run(b.customerId);
});

describe("planViewData", () => {
  it("lists only the caller's company's visits", async () => {
    const seenByA = (await planViewData(owner(a.ownerId, a.orgId), "2026-01-01", "2026-01-31")).visits;
    expect(seenByA).toHaveLength(1);
    const seenByB = (await planViewData(owner(b.ownerId, b.orgId), "2026-01-01", "2026-01-31")).visits;
    expect(seenByB).toHaveLength(1);
    expect(seenByA[0].id).not.toBe(seenByB[0].id);
  });
});
