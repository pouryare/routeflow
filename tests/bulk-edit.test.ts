import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bulkPlanProblem, bulkPreviewText } from "@/lib/bulkEdit";

const testDbPath = path.join(os.tmpdir(), `rf-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.ROUTEFLOW_WORKER = "off";

const { getDb } = await import("@/lib/db");
const be = await import("@/lib/repo/bulkEdit");
const jobs = await import("@/lib/repo/bulkJobs");
const ex = await import("@/lib/repo/exportJobs");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("bulk edit rules", () => {
  it("refuses empty, huge, odd and unknown input, and words the preview", () => {
    expect(bulkPlanProblem({ ids: [], field: "owner", value: 1 })).toMatch(/انتخاب/);
    expect(bulkPlanProblem({ ids: [1, "x"], field: "owner", value: 1 })).toMatch(/درست/);
    expect(bulkPlanProblem({ ids: [1], field: "price", value: 1 })).toMatch(/چیزی/);
    expect(bulkPlanProblem({ ids: [1], field: "owner", value: null })).toBeNull();
    expect(bulkPreviewText(42, 3, 0)).toBe("۴۲ مشتری تغییر می‌کند؛ ۳ مورد همین الان همین‌طور است");
  });
});

describe("T4 bulk edit of customers", () => {
  let owner = 0, gm = 0, rep = 0, rep2 = 0, g1 = 0, g2 = 0; const cust: number[] = [];
  const actor = (role: "owner" | "group_manager", userId: number, groupId: number | null) => ({ organizationId: 1, userId, role, groupId });
  beforeAll(async () => {
    const db = getDb(); const now = new Date().toISOString();
    g1 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('b1','b1',?,1)").run(now)).lastInsertRowid);
    g2 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('b2','b2',?,1)").run(now)).lastInsertRowid);
    const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
    owner = Number((await u.run("bk-o", "x", "مالک", "owner", null, now)).lastInsertRowid);
    gm = Number((await u.run("bk-gm", "x", "مدیر", "group_manager", g1, now)).lastInsertRowid);
    rep = Number((await u.run("bk-r", "x", "فروشنده", "phone_sales", g1, now)).lastInsertRowid);
    rep2 = Number((await u.run("bk-r2", "x", "دیگر", "phone_sales", g2, now)).lastInsertRowid);
    for (let i = 0; i < 4; i++) {
      cust.push(Number((await db.prepare("INSERT INTO customers (organization_id, customer_code, business_name, group_id, synced_at) VALUES (1, ?, ?, ?, ?)").run(`bk-${i}`, `مشتری ${i}`, i < 3 ? g1 : g2, now)).lastInsertRowid));
    }
  });

  it("previews, then moves only what the actor may reach, with one timeline line each", async () => {
    const plan = { ids: cust, field: "owner" as const, value: rep };
    expect(await be.previewBulkEdit(actor("group_manager", gm, g1), plan)).toEqual({ count: 3, same: 0, refused: 1 });
    expect(await jobs.startBulkEdit(actor("group_manager", gm, g1), plan)).toEqual({ queued: false, changed: 3 });
    const lines = (await getDb().prepare("SELECT COUNT(*) AS n FROM activities WHERE type = 'owner_change' AND customer_id IN (?,?,?,?)").get(...cust)) as { n: number };
    expect(Number(lines.n)).toBe(3);
    expect(await be.previewBulkEdit(actor("group_manager", gm, g1), plan)).toEqual({ count: 0, same: 3, refused: 1 });
    expect(await getDb().prepare("SELECT owner_user_id FROM customers WHERE id = ?").get(cust[3])).toMatchObject({ owner_user_id: null });
  });
  it("a group manager cannot change groups or hand to another group; the owner can", async () => {
    await expect(be.previewBulkEdit(actor("group_manager", gm, g1), { ids: cust, field: "group", value: g2 })).rejects.toThrow(/مالک/);
    await expect(be.previewBulkEdit(actor("group_manager", gm, g1), { ids: cust, field: "owner", value: rep2 })).rejects.toThrow(/گروه خودتان/);
    await expect(be.previewBulkEdit(actor("owner", owner, null), { ids: cust, field: "group", value: 999999 })).rejects.toThrow(/گروه پیدا نشد/);
    expect(await jobs.startBulkEdit(actor("owner", owner, null), { ids: cust, field: "group", value: g2 })).toEqual({ queued: false, changed: 3 });
  });
  it("more than 100 customers run as a job that finishes and notifies", async () => {
    const ids = [...cust, ...Array.from({ length: 101 }, (_, i) => 900000 + i)];
    const r = await jobs.startBulkEdit(actor("owner", owner, null), { ids, field: "owner", value: rep });
    expect(r.queued).toBe(true);
    const id = (r as { jobId: number }).jobId;
    for (let i = 0; i < 50 && (await ex.getExportJob(1, id))?.status !== "done"; i++) await new Promise((r2) => setTimeout(r2, 100));
    expect((await ex.getExportJob(1, id))?.status).toBe("done");
    expect(await getDb().prepare("SELECT owner_user_id FROM customers WHERE id = ?").get(cust[0])).toMatchObject({ owner_user_id: rep });
  });
});
