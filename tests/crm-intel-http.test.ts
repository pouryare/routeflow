import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-intel-http-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { POST: intelPOST } = await import("@/app/api/crm/businesses/[id]/intel/route");
const { PUT: tagsPUT } = await import("@/app/api/crm/businesses/[id]/tags/route");
const { GET: bizGET } = await import("@/app/api/crm/businesses/[id]/route");

const db = getDb();
const now = new Date().toISOString();
afterAll(async () => { await db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });

const g = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('ig','ig',?,1)").run(now)).lastInsertRowid);
const uid = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('igowner','x','igowner','owner',?,?,1)").run(g, now)).lastInsertRowid);
const rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('igrep','x','igrep','phone_sales',?,?,1)").run(g, now)).lastInsertRowid);
const token = (role: string, id_: number) => createSessionToken({ uid: id_, role: role as "owner", gid: g, oid: 1, tv: 0, name: role });
const req = (p: string, method: string, body: unknown, actor: string) =>
  new NextRequest(`http://test.local${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: `${COOKIE_NAME}=${actor}` } });
const ctx = (id_: number) => ({ params: Promise.resolve({ id: String(id_) }) }) as never;
const id = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id) VALUES ('ig-1','کافه دود',?,?,?,1)").run(uid, g, now)).lastInsertRowid);
const answers = () => [
  { step: "size", option: "medium" }, { step: "supply", option: "distributor" }, { step: "uses", option: "ok" },
  { step: "when", option: "afternoon" }, { step: "note", option: "ok", value: "سراغ مدیر" },
];

describe("intel + tags HTTP surface (handlers, temp DB)", () => {
  it("rejects anonymous and out-of-scope callers before touching data", async () => {
    expect((await intelPOST(req("/x", "POST", { answers: answers() }, "bad-token"), ctx(id))).status).toBe(401);
    expect((await intelPOST(req("/x", "POST", { answers: answers() }, token("phone_sales", rep)), ctx(id))).status).toBe(404);
    expect((await tagsPUT(req("/x", "PUT", { tags: [] }, "bad-token"), ctx(id))).status).toBe(401);
    expect(await db.prepare("SELECT count(*) n FROM activities WHERE customer_id = ?").get(id)).toEqual({ n: 0 });
  });

  it("saves intel, replays the same client_uuid once, and rejects malformed answers", async () => {
    const first = await intelPOST(req("/x", "POST", { answers: answers(), client_uuid: "http-intel-1" }, token("owner", uid)), ctx(id));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { ok: boolean; activityId: number };
    const again = await intelPOST(req("/x", "POST", { answers: answers(), client_uuid: "http-intel-1" }, token("owner", uid)), ctx(id));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { activityId: number }).activityId).toBe(firstBody.activityId);
    expect((await intelPOST(req("/x", "POST", { answers: [{ step: "size", option: "huge" }] }, token("owner", uid)), ctx(id))).status).toBe(400);
    const profile = await bizGET(req("/x", "GET", undefined, token("owner", uid)), ctx(id));
    expect(((await profile.json()) as { profile: { business: { visit_window: string } } }).profile.business.visit_window).toBe("afternoon");
  });

  it("replaces tags and returns them on the profile", async () => {
    const put = await tagsPUT(req("/x", "PUT", { tags: [" ویژه ", "ویژه", "بازدید"] }, token("owner", uid)), ctx(id));
    expect(put.status).toBe(200);
    expect((await tagsPUT(req("/x", "PUT", { tags: [3] }, token("owner", uid)), ctx(id))).status).toBe(400);
    const profile = await bizGET(req("/x", "GET", undefined, token("owner", uid)), ctx(id));
    expect(((await profile.json()) as { profile: { tags: string[] } }).profile.tags).toEqual(["بازدید", "ویژه"]);
  });
});
