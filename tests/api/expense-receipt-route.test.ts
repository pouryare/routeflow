import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const testDbPath = path.join(os.tmpdir(), `rf-expense-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/accounting/expenses/[id]/receipt/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { photoFilePath } = await import("@/lib/photos");
const { journalsWithReceipt } = await import("@/lib/repo/expenseReceipts");

let owner = 0;
let seller = 0;
let expense = 0;
let sale = 0;
let otherOrgExpense = 0;

afterAll(async () => {
  const db = getDb();
  for (const r of await db.prepare("SELECT file_stem FROM expense_receipts").all() as { file_stem: string }[]) {
    for (const f of ["avif", "webp"] as const) fs.rmSync(photoFilePath(r.file_stem, f), { force: true });
  }
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(async () => {
  const db = getDb();
  await db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')");
  const now = new Date().toISOString();
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,NULL,1,?,1)");
  owner = Number((await u.run("r-owner", "x:y", "م", "owner", now)).lastInsertRowid);
  seller = Number((await u.run("r-seller", "x:y", "ف", "phone_sales", now)).lastInsertRowid);
  const j = db.prepare("INSERT INTO journals (organization_id,seq,posted_at,period_key,memo,source_type,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)");
  expense = Number((await j.run(1, 1, "2026-10-01", "1405-07", "سوخت", "EXPENSE", owner, now)).lastInsertRowid);
  sale = Number((await j.run(1, 2, "2026-10-01", "1405-07", "فروش", "SALE", owner, now)).lastInsertRowid);
  otherOrgExpense = Number((await j.run(2, 1, "2026-10-01", "1405-07", "x", "EXPENSE", owner, now)).lastInsertRowid);
});

const cookie = (uid: number, role: string) => `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

async function png(): Promise<Blob> {
  const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).png().toBuffer();
  return new Blob([new Uint8Array(buf)], { type: "image/png" });
}
async function upload(id: number, uid = owner, role = "owner") {
  const form = new FormData();
  form.append("file", new File([await png()], "r.png", { type: "image/png" }));
  return POST(new NextRequest(`http://localhost/x`, { method: "POST", body: form, headers: { cookie: cookie(uid, role) } }), ctx(id));
}
const get = (id: number, uid = owner, role = "owner") =>
  GET(new NextRequest(`http://localhost/x`, { headers: { cookie: cookie(uid, role) } }), ctx(id));

describe("expense receipt photo", () => {
  it("an owner attaches a receipt to an expense and reads it back as an image", async () => {
    expect((await upload(expense)).status).toBe(201);
    const res = await get(expense);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect((await journalsWithReceipt(1, [expense, sale])).has(expense)).toBe(true);
  });
  it("a second upload replaces the first (one receipt per expense, the old files go)", async () => {
    const before = (await getDb().prepare("SELECT file_stem FROM expense_receipts WHERE journal_id = ?").get(expense) as { file_stem: string }).file_stem;
    expect((await upload(expense)).status).toBe(201);
    const rows = await getDb().prepare("SELECT file_stem FROM expense_receipts WHERE journal_id = ?").all(expense) as { file_stem: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].file_stem).not.toBe(before);
    expect(fs.existsSync(photoFilePath(before, "webp"))).toBe(false);
  });
  it("only an expense of your own organisation takes a receipt", async () => {
    expect((await upload(sale)).status).toBe(404); // a sale, not an expense
    expect((await upload(otherOrgExpense)).status).toBe(404); // another tenant's
    expect((await get(otherOrgExpense)).status).toBe(404);
  });
  it("people who may not record expenses may not attach or read a receipt", async () => {
    expect((await upload(expense, seller, "phone_sales")).status).toBe(403);
    expect((await get(expense, seller, "phone_sales")).status).toBe(403);
  });
  it("a file that is not an image is refused", async () => {
    const form = new FormData();
    form.append("file", new File(["hello"], "r.txt", { type: "text/plain" }));
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", body: form, headers: { cookie: cookie(owner, "owner") } }), ctx(expense));
    expect(res.status).toBe(400);
  });
});
