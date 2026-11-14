import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-seg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { listBusinesses } = await import("@/lib/repo/crm/businesses");
const { saveSegment, listSegments, segmentSpec, deleteSegment } = await import("@/lib/repo/customerSegments");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let owner = 0;
const session = () => ({ organizationId: 1, role: "owner", roles: ["owner"], groupId: null, user: { id: owner, organization_id: 1 }, hasRole: (r: string) => r === "owner" }) as never;

beforeAll(async () => {
  const db = getDb();
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('sg-o','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  const add = (code: string, name: string, city: string, last: string | null) =>
    db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id,city,last_purchase_date) VALUES (?,?,'RESTAURANT','active','2026-01-01',1,?,?)").run(code, name, city, last);
  await add("S1", "نانوایی الف", "تهران", "2020-01-01");
  await add("S2", "نانوایی ب", "تهران", "2999-01-01");
  await add("S3", "قنادی ج", "کرج", "2020-01-01");
});

describe("customer segments and typed filters", () => {
  it("filters the list by what is typed in the search box, and keeps the other words as the search", async () => {
    const names = async (q: string) => (await listBusinesses(session(), { view: "all", q })).rows.map((r) => r.business_name).sort();
    expect(await names("شهر:تهران")).toEqual(["نانوایی الف", "نانوایی ب"]);
    expect(await names("شهر:تهران روز_از_خرید>30")).toEqual(["نانوایی الف"]);
    expect(await names("شهر:تهران قنادی")).toEqual([]);
  });
  it("saves a segment under a name, replaces a same-named one, refuses a bad filter, and the list can use it", async () => {
    expect(await saveSegment(1, owner, "تهرانی‌های ساکت", { op: "and", items: [{ field: "city", op: "contains", value: "تهران" }, { field: "since_purchase", op: "gt", value: 30 }] })).toBeNull();
    expect(await saveSegment(1, owner, "بد", { field: "password_hash", op: "eq", value: "x" })).toMatch(/فیلد/);
    const [seg] = await listSegments(1);
    const spec = await segmentSpec(1, seg.id);
    expect((await listBusinesses(session(), { view: "all", segment: spec })).rows.map((r) => r.business_name)).toEqual(["نانوایی الف"]);
    await saveSegment(1, owner, "تهرانی‌های ساکت", { field: "city", op: "contains", value: "کرج" });
    expect((await listSegments(1)).length).toBe(1);
    await deleteSegment(1, seg.id);
    expect(await listSegments(1)).toEqual([]);
  });
});
