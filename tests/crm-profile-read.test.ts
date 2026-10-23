import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.tmpdir(), `rf-profile-read-${Date.now()}-${Math.random()}.db`);
process.env.ROUTEFLOW_DB_PATH = file;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { profileFor, timelineFor } = await import("@/lib/repo/crm/profile");
type TimelinePage = NonNullable<Awaited<ReturnType<typeof timelineFor>>>;
type Session = import("@/lib/session").Session;
const db = getDb();
const NOW = "2026-09-11T08:00:00.000Z";
afterAll(async () => { await db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(file + s, { force: true }); });
const group = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('profile','profile',?,1)").run(NOW)).lastInsertRowid);
async function user(name: string) {
  return Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,'x',?,'phone_sales',?,?,1)").run(name, name, group, NOW)).lastInsertRowid);
}
const a = await user("profile-a"), b = await user("profile-b");
const session: Session = { user: { id: a } as Session["user"], role: "phone_sales", groupId: group, organizationId: 1, roles: ["phone_sales"], hasRole: (x) => x === "phone_sales" };
let serial = 0;
async function customer(owner: number | null) {
  const code = `profile-${++serial}`;
  return Number((await db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id) VALUES (?,?,?,?,?,1)").run(code, code, owner, group, NOW)).lastInsertRowid);
}
const own = await customer(a), other = await customer(b), pool = await customer(null);
async function activity(id: number, at = NOW, completed: number | null = null) {
  return Number((await db.prepare("INSERT INTO activities (organization_id,customer_id,user_id,type,note,occurred_at,created_at,completed_task_id) VALUES (1,?,?,'note','یادداشت',?,?,?)").run(id, a, at, at, completed)).lastInsertRowid);
}
async function task(id: number, at = NOW) {
  return Number((await db.prepare("INSERT INTO tasks (organization_id,kind,title,entity_type,entity_id,status,done_at,created_at,assignee_user_id) VALUES (1,'call','تماس','customer',?,'done',?,?,?)").run(id, at, at, a)).lastInsertRowid);
}

describe("profile reads", () => {
  it("returns plain scoped details and only active contacts, primary first", async () => {
    for (const [name, primary, active] of [["secondary", 0, 1], ["primary", 1, 1], ["inactive", 0, 0]] as const) {
      await db.prepare("INSERT INTO contacts (organization_id,customer_id,name,is_primary,active,created_at,updated_at) VALUES (1,?,?,?,?,?,?)").run(own, name, primary, active, NOW, NOW);
    }
    const p = (await profileFor(session, own))!;
    expect(p.contacts.map(c => c.name)).toEqual(["primary", "secondary"]);
    expect(p.canWrite).toBe(true);
    expect(p.canManage).toBe(false);
    expect(p.reps).toEqual([]);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(await profileFor(session, other)).toBeNull();
    expect(await profileFor({ ...session, organizationId: 999 }, own)).toBeNull();
    expect(await profileFor(session, pool)).not.toBeNull();
  });
  it("reads existing optional business fields and returns empty history", async () => {
    await db.prepare("UPDATE customers SET website = 'https://example.test', secondary_phone = '09120001234' WHERE id = ?").run(pool);
    expect((await profileFor(session, pool))!.business).toMatchObject({ website: "https://example.test", secondary_phone: "09120001234" });
    expect(await timelineFor(session, pool)).toEqual({ items: [], nextBefore: null });
    expect(await timelineFor(session, other)).toBeNull();
  });
});

describe("stable timeline", async () => {
  const c = await customer(a);
  const linked = await task(c);
  await activity(c, NOW, linked);
  await task(c);
  for (let i = 0; i < 5; i++) await activity(c);
  await activity(c, "2026-09-10T08:00:00.000Z");

  it("pages tied timestamps and cross-table IDs without skips or duplicates", async () => {
    const all = (await timelineFor(session, c))!.items;
    expect(all).toHaveLength(8);
    const keys: string[] = [];
    let before: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: TimelinePage = (await timelineFor(session, c, { limit: 1, before }))!;
      keys.push(...page.items.map(x => `${x.kind}:${x.id}`));
      before = page.nextBefore;
      if (!before) break;
    }
    expect(keys).toEqual(all.map(x => `${x.kind}:${x.id}`));
    expect(new Set(keys).size).toBe(8);
    expect(all.filter(x => x.kind === "task")).toHaveLength(1);
  });
  it("filters kinds and rejects malformed cursors and limits", async () => {
    expect((await timelineFor(session, c, { kind: "activity" }))!.items).toHaveLength(7);
    await expect((async () => await timelineFor(session, c, { before: "bad" }))()).rejects.toThrow();
    await expect((async () => await timelineFor(session, c, { limit: Number.NaN }))()).rejects.toThrow();
  });
  it("includes payments, marks voids, and preserves ties across all four sources", async () => {
    const mixed = await customer(a);
    await activity(mixed, "2026-09-11");
    await task(mixed, "2026-09-11");
    await db.prepare("INSERT INTO orders (organization_id,order_no,customer_id,salesperson_user_id,group_id,status,order_date,created_by,created_at,updated_at) VALUES (1,'profile-mixed',?,?,?,'DRAFT','2026-09-11',?,?,?)")
      .run(mixed, a, group, a, NOW, NOW);
    for (const voided of [null, NOW]) {
      await db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at,voided_at) VALUES (1,?,50000,'CASH','2026-09-11',?,?,?)")
        .run(mixed, a, NOW, voided);
    }
    const all = (await timelineFor(session, mixed))!.items;
    expect(all).toHaveLength(5);
    expect(new Set(all.map(x => x.kind)).size).toBe(4);
    expect(all.filter(x => x.kind === "payment").map(x => x.tone).sort()).toEqual(["good", "muted"]);
    let before: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const page: TimelinePage = (await timelineFor(session, mixed, { limit: 2, before }))!;
      seen.push(...page.items.map(x => `${x.kind}:${x.id}`));
      before = page.nextBefore;
      if (!before) break;
    }
    expect(seen).toEqual(all.map(x => `${x.kind}:${x.id}`));
  });
  it("does not include another salesperson's orders in a visible business", async () => {
    for (const seller of [a, b]) {
      await db.prepare("INSERT INTO orders (organization_id,order_no,customer_id,salesperson_user_id,group_id,status,order_date,created_by,created_at,updated_at) VALUES (1,?,?,?,?,'DRAFT',?,?,?,?)")
        .run(`profile-order-${seller}`, c, seller, group, "2026-09-11", a, NOW, NOW);
    }
    const orders = (await timelineFor(session, c, { kind: "order" }))!.items;
    expect(orders).toHaveLength(1);
    expect(orders[0].title).toContain(`profile-order-${a}`);
  });
});
