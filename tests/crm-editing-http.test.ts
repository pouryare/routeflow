import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-editing-http-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { GET: bizGET, PATCH: bizPATCH } = await import("@/app/api/crm/businesses/[id]/route");
const { POST: verifyPOST } = await import("@/app/api/crm/businesses/[id]/verify/route");
const { GET: contactsGET, POST: contactsPOST } = await import("@/app/api/crm/businesses/[id]/contacts/route");
const { PATCH: contactPATCH, DELETE: contactDELETE } = await import("@/app/api/crm/businesses/[id]/contacts/[contactId]/route");
const { GET: timelineGET } = await import("@/app/api/crm/businesses/[id]/timeline/route");

const db = getDb();
const now = new Date().toISOString();
afterAll(() => { db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });

const g = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('http','http',?,1)").run(now).lastInsertRowid);
const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('http','x','http','owner',?,?,1)").run(g, now).lastInsertRowid);
const rep = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('httprep','x','httprep','salesperson',?,?,1)").run(g, now).lastInsertRowid);
const token = (role: string, id_: number) => createSessionToken({ uid: id_, role: role as "owner", gid: g, oid: 1, tv: 0, name: role });
const ownerToken = () => token("owner", uid), repToken = token("salesperson", rep);
const req = (path: string, method: string, body: unknown, actor: string) =>
  new NextRequest(`http://test.local${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: `${COOKIE_NAME}=${actor}` } });
const ctx = (id_: number, extra?: Record<string, string>) => ({ params: Promise.resolve({ id: String(id_), ...(extra ?? {}) }) }) as never;
const id = Number(db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id) VALUES ('http-1','کافه دود',?,?,?,1)").run(uid, g, now).lastInsertRowid);

describe("editing HTTP surface (handlers, temp DB)", () => {
  it("rejects anonymous writes and bad phones, then edits and persists", async () => {
    const anon = await bizPATCH(req(`/api/crm/businesses/${id}`, "PATCH", { address: "x" }, "bad-token"), ctx(id));
    expect(anon.status).toBe(401);
    const bad = await bizPATCH(req("/x", "PATCH", { phone: "abc" }, ownerToken()), ctx(id));
    expect(bad.status).toBe(400);
    const patch = await bizPATCH(req("/x", "PATCH", { phone: "09121234567" }, ownerToken()), ctx(id));
    expect(patch.status).toBe(200);
    expect(db.prepare("SELECT phone_norm FROM customers WHERE id = ?").get(id)).toEqual({ phone_norm: "9121234567" });
    const verify = await verifyPOST(req("/x", "POST", { confirmed: true }, ownerToken()), ctx(id));
    expect(verify.status).toBe(200);
    expect(db.prepare("SELECT verification FROM customers WHERE id = ?").get(id)).toEqual({ verification: "verified" });
    const noConfirm = await verifyPOST(req("/x", "POST", {}, ownerToken()), ctx(id));
    expect(noConfirm.status).toBe(400);
  });

  it("serves profile, contacts and timeline with cursor validation", async () => {
    const profile = await bizGET(req("/x", "GET", undefined, ownerToken()), ctx(id));
    expect(profile.status).toBe(200);
    const contacts = await contactsPOST(req("/x", "POST", { name: "علی", role: "PURCHASING", phone: "09123334455" }, ownerToken()), ctx(id));
    expect(contacts.status).toBe(201);
    const cid = ((await contacts.json()) as { contact: { id: number } }).contact.id;
    expect((await contactPATCH(req("/x", "PATCH", { is_primary: true }, ownerToken()), ctx(id, { contactId: String(cid) }))).status).toBe(200);
    expect((await contactDELETE(req("/x", "DELETE", undefined, ownerToken()), ctx(id, { contactId: String(cid) }))).status).toBe(200);
    expect((await contactPATCH(req("/x", "PATCH", { name: "x" }, ownerToken()), ctx(id + 100, { contactId: String(cid) }))).status).toBe(404);
    expect((await contactsGET(req("/x", "GET", undefined, ownerToken()), ctx(id))).status).toBe(200);
    expect((await timelineGET(req("/x?limit=1", "GET", undefined, ownerToken()), ctx(id))).status).toBe(200);
    expect((await timelineGET(req("/x?before=broken", "GET", undefined, ownerToken()), ctx(id))).status).toBe(400);
  });

  it("rejects a salesperson editing a business owned by someone else", async () => {
    const response = await bizPATCH(req("/x", "PATCH", { address: "nope" }, repToken), ctx(id));
    expect(response.status).toBe(404);
    expect(db.prepare("SELECT address FROM customers WHERE id = ?").get(id)).not.toMatchObject({ address: "nope" });
  });
});

