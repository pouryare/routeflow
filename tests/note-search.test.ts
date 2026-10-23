import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-note-search-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { searchNotes } = await import("@/lib/repo/search");
const { parseRecent } = await import("@/lib/searchModel");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("searchNotes (F98)", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  const groupA = Number((await g.run("A", "a", now)).lastInsertRowid);
  const groupB = Number((await g.run("B", "b", now)).lastInsertRowid);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
  const owner = Number((await u.run("o", "x", "م", "owner", null, now)).lastInsertRowid);
  const mgrA = Number((await u.run("m", "x", "مد", "group_manager", groupA, now)).lastInsertRowid);
  const rep = Number((await u.run("s", "x", "ف", "phone_sales", groupA, now)).lastInsertRowid);
  const c = db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,owner_user_id,organization_id) VALUES (?,?,'active',?,?,?,1)");
  const mine = Number((await c.run("N1", "سوپر یاس", now, groupA, rep)).lastInsertRowid);
  const other = Number((await c.run("N2", "بقالی نرگس", now, groupB, null)).lastInsertRowid);
  const a = db.prepare("INSERT INTO activities (organization_id,customer_id,user_id,type,note,occurred_at,created_at) VALUES (1,?,?,'call',?,?,?)");
  await a.run(mine, rep, "مغازه برای تعمیرات تا آخر ماه بسته است", "2026-10-20T08:00:00Z", now);
  await a.run(other, owner, "به خاطر تعميرات بسته است", "2026-10-21T08:00:00Z", now); // Arabic yeh, as imported text has it
  await a.run(mine, rep, "صبح‌ها زنگ بزنید", "2026-10-19T08:00:00Z", now);

  it("finds the phrase whatever the letter forms, newest first, and links to the customer", async () => {
    const hits = await searchNotes(db, sess(owner, "owner", null), "تعمیرات");
    expect(hits.map((h) => h.label)).toEqual(["بقالی نرگس", "سوپر یاس"]);
    expect(hits[1]).toMatchObject({ kind: "note", href: `/crm/${mine}` });
    expect(hits[1].sub).toContain("تعمیرات");
  });

  it("a manager sees notes in their group only, a rep on their own customers only", async () => {
    expect((await searchNotes(db, sess(mgrA, "group_manager", groupA), "تعمیرات")).map((h) => h.label)).toEqual(["سوپر یاس"]);
    expect((await searchNotes(db, sess(rep, "phone_sales", groupA), "تعمیرات")).map((h) => h.label)).toEqual(["سوپر یاس"]);
    expect(await searchNotes(db, sess(owner, "delivery_driver", null), "تعمیرات")).toEqual([]);
  });

  it("needs three letters, and a note hit survives as a recent", async () => {
    expect(await searchNotes(db, sess(owner, "owner", null), "صب")).toEqual([]);
    const [hit] = await searchNotes(db, sess(owner, "owner", null), "صبح");
    expect(parseRecent(JSON.stringify([hit]))).toEqual([hit]);
  });
});
