import { describe, it, expect } from "vitest";

process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { duplicatePairs, mergeBusinesses } = await import("@/lib/repo/crm/duplicates");
type Session = import("@/lib/session").Session;

const NOW = "2026-10-30T06:00:00.000Z";
const db = getDb();
const g1 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW)).lastInsertRowid);
const mgr = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('mgr','x','mgr','group_manager',?,?,1)").run(g1, NOW)).lastInsertRowid);
const cust = async (name: string, extra: Record<string, unknown> = {}) => {
  const row = { customer_code: name, business_name: name, owner_user_id: mgr, group_id: g1, synced_at: NOW, organization_id: 1,
    verification: "unverified", sales_stage: "unknown", contact_status: "not_contacted", temperature: "cold", ...extra };
  const k = Object.keys(row);
  return Number((await db.prepare(`INSERT INTO customers (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]))).lastInsertRowid);
};

// A chain: one head office and two branches on the same Instagram page, and a real duplicate.
const head = await cust("نان سحر مرکزی", { instagram: "nan_sahar" });
const branch1 = await cust("نان سحر ونک", { instagram: "nan_sahar", parent_customer_id: head });
const branch2 = await cust("نان سحر تجریش", { instagram: "nan_sahar", parent_customer_id: head });
const twinA = await cust("کافه آبی", { phone: "09120007777", phone_norm: "9120007777" });
const twinB = await cust("کافه ابی", { phone: "09120007777", phone_norm: "9120007777" });

const M: Session = { user: { id: mgr } as Session["user"], role: "group_manager", groupId: g1, organizationId: 1, roles: ["group_manager"], hasRole: (x) => x === "group_manager" };
const pairIds = async () => (await duplicatePairs(M)).map((p) => [p.keep.id, p.drop.id].sort((a, b) => a - b));

describe("duplicate deck and branches of one business", () => {
  it("offers a real duplicate but never a branch with its head office or a sister branch", async () => {
    const pairs = await pairIds();
    expect(pairs).toContainEqual([twinA, twinB]);
    for (const [a, b] of [[head, branch1], [head, branch2], [branch1, branch2]]) expect(pairs).not.toContainEqual([a, b]);
  });
  it("refuses to merge a branch into its head office", async () => {
    await expect(mergeBusinesses(M, head, branch1)).rejects.toThrow("شعبه");
    await expect(mergeBusinesses(M, branch2, branch1)).rejects.toThrow("شعبه");
    const row = await db.prepare("SELECT merged_into_id FROM customers WHERE id = ?").get(branch1) as { merged_into_id: number | null };
    expect(row.merged_into_id).toBeNull();
  });
});
