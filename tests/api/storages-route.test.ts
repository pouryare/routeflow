import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
process.env.ROUTEFLOW_FILE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rf-cache-"));

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const { trustCookieFor } = await import("@/lib/repo/stepUp");
const files = await import("@/lib/storage/files");
const storagesRoute = await import("@/app/api/storages/route");
const oneRoute = await import("@/app/api/storages/[id]/route");
const rulesRoute = await import("@/app/api/storages/rules/route");
const trashRoute = await import("@/app/api/storages/trash/route");
const trashOne = await import("@/app/api/storages/trash/[id]/route");
const statusRoute = await import("@/app/api/storages/status/route");
const problemsRoute = await import("@/app/api/storages/problems/route");

const objects = new Map<string, Buffer>();
files.setS3ClientFactory(() => ({
  async send(c: unknown) {
    const i = (c as { input: Record<string, unknown> }).input;
    const k = `${i.Bucket}/${i.Key}`;
    const missing = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    if (c instanceof PutObjectCommand) return void objects.set(k, Buffer.from(i.Body as Buffer));
    if (c instanceof GetObjectCommand) {
      if (!objects.has(k)) throw missing();
      return { Body: { transformToByteArray: async () => new Uint8Array(objects.get(k)!) } };
    }
    if (c instanceof HeadObjectCommand) {
      if (!objects.has(k)) throw missing();
      return { ContentLength: objects.get(k)!.length };
    }
    if (c instanceof DeleteObjectCommand) return void objects.delete(k);
    if (c instanceof ListObjectsV2Command) return { Contents: [] };
    throw new Error("unexpected");
  },
}));
globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;

let owner = 0;
let manager = 0;
let platform = 0;
let customer = 0;
const ORG = 41;

const cookieFor = (uid: number, role: string, oid = ORG) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid, tv: 0, name: "t" })}`;
async function req(url: string, uid: number, role: string, method = "GET", body?: unknown, trusted = true) {
  let cookie = cookieFor(uid, role);
  if (trusted) {
    const t = await trustCookieFor(uid);
    cookie += `; ${t.name}=${t.value}`;
  }
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie },
  });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const form = (o: Record<string, unknown> = {}) => ({
  name: "تهران", preset: "arvan-thr", bucket: "pakhsh-photos", access_key_id: "AK1", secret: "SECRET-AB12", plan_gb: 5, ...o,
});

beforeAll(async () => {
  const db = getDb();
  await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'پخش', 'pakhsh41', '2026-01-01')").run(ORG);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,1,0,'2026-01-01')");
  owner = Number((await u.run("o41", "x:y", "مالک", "owner", ORG)).lastInsertRowid);
  manager = Number((await u.run("m41", "x:y", "مدیر", "group_manager", ORG)).lastInsertRowid);
  platform = Number((await u.run("p41", "x:y", "سکو", "platform_owner", ORG)).lastInsertRowid);
  customer = Number((await db
    .prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('S41', 'فروشگاه', '2026-01-01', ?)")
    .run(ORG)).lastInsertRowid);
});

describe("storage settings routes", () => {
  it("only an owner may open them, and saving asks for the authenticator code", async () => {
    expect((await storagesRoute.GET(await req("/api/storages", manager, "group_manager"))).status).toBe(403);
    const untrusted = await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form(), false));
    expect(untrusted.status).toBe(403);
    expect((await untrusted.json()).step_up.action).toBe("storage_change");
  });

  it("adds a storage after testing it, and never sends the secret back", async () => {
    const res = await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form()));
    expect(res.status).toBe(201);
    const list = await (await storagesRoute.GET(await req("/api/storages", owner, "owner"))).json();
    expect(list.storages).toHaveLength(1);
    expect(list.storages[0]).toMatchObject({ endpoint: "https://s3.ir-thr-at1.arvanstorage.ir", secret_last4: "AB12", plan_bytes: 5 * 1024 ** 3 });
    expect(JSON.stringify(list)).not.toContain("SECRET-AB12");
    expect(list.storages[0].secret_enc).toBeUndefined();
    expect(list.rules).toEqual([{ file_kind: "*", storage_id: list.storages[0].id, mirror_storage_id: null }]);
  });

  it("refuses a bad bucket, a public bucket, and spill with no overflow", async () => {
    expect((await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form({ bucket: "Bad Name" })))).status).toBe(400);
    expect((await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form({ at_limit: "spill" })))).status).toBe(400);
    globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
    const pub = await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form({ bucket: "public-one" })));
    globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
    expect(pub.status).toBe(422);
    expect((await pub.json()).error).toMatch("عمومی");
  });

  it("swaps a key, sets a rule with a mirror, and removes a storage only through a move", async () => {
    const second = await (await storagesRoute.POST(await req("/api/storages", owner, "owner", "POST", form({ name: "تبریز", preset: "arvan-tbz", bucket: "pakhsh-copy" })))).json();
    const list = await (await storagesRoute.GET(await req("/api/storages", owner, "owner"))).json();
    const first = list.storages[0].id;
    const swap = await oneRoute.PATCH(await req(`/api/storages/${first}`, owner, "owner", "PATCH", form({ secret: "NEW-KEY-9999" })), ctx(first));
    expect(swap.status).toBe(200);
    const after = await (await storagesRoute.GET(await req("/api/storages", owner, "owner"))).json();
    expect(after.storages[0].secret_last4).toBe("9999");
    expect(after.events.map((e: { kind: string }) => e.kind)).toContain("key_swapped");

    const rules = await rulesRoute.PUT(await req("/api/storages/rules", owner, "owner", "PUT", {
      rules: [{ file_kind: "*", storage_id: first }, { file_kind: "receipt", storage_id: first, mirror_storage_id: second.id }],
    }));
    expect(rules.status).toBe(200);

    await files.saveFile(ORG, "photo", "routefile1", [{ ext: "webp", body: Buffer.from("x"), contentType: "image/webp" }]);
    const refused = await oneRoute.DELETE(await req(`/api/storages/${first}`, owner, "owner", "DELETE"), ctx(first));
    expect(refused.status).toBe(409);
    const moving = await oneRoute.DELETE(await req(`/api/storages/${first}?to=${second.id}`, owner, "owner", "DELETE"), ctx(first));
    expect((await moving.json()).move_id).toBeGreaterThan(0);
  });
});

describe("trash", () => {
  it("lists a deleted photo and puts it back where it was", async () => {
    await files.saveFile(ORG, "photo", "trashme1", [{ ext: "webp", body: Buffer.from("pic"), contentType: "image/webp" }]);
    await files.trashFile("trashme1", "photo", owner, { table: "photos", entity_type: "customer", entity_id: customer, caption: "ویترین", taken_at: "2026-11-01" });
    const list = await (await trashRoute.GET(await req("/api/storages/trash", owner, "owner"))).json();
    const item = list.files.find((f: { stem: string }) => f.stem === "trashme1");
    expect(item.restorable).toBe(true);
    expect((await trashOne.GET(await req(`/api/storages/trash/${item.id}`, owner, "owner"), ctx(item.id))).status).toBe(200);
    expect((await trashOne.POST(await req(`/api/storages/trash/${item.id}`, owner, "owner", "POST", {}), ctx(item.id))).status).toBe(200);
    const photo = await getDb().prepare("SELECT entity_id, caption FROM photos WHERE file_stem = 'trashme1'").get() as { entity_id: number; caption: string };
    expect(photo).toEqual({ entity_id: customer, caption: "ویترین" });
  });
});

describe("status and the platform owner's list", () => {
  it("says whether uploads work, and lists every company's problems for the platform owner only", async () => {
    expect((await (await statusRoute.GET(await req("/api/storages/status", manager, "group_manager"))).json()).can_upload).toBe(true);
    expect((await problemsRoute.GET(await req("/api/storages/problems", owner, "owner"))).status).toBe(403);
    await getDb().prepare("UPDATE storages SET last_check_error = 'کلید درست نیست', last_check_at = '2026-11-05' WHERE organization_id = ?").run(ORG);
    const res = await problemsRoute.GET(await req("/api/storages/problems", platform, "platform_owner"));
    const body = await res.json();
    expect(body.problems.some((p: { problem: string; organization_id: number }) => p.problem === "check_failed" && p.organization_id === ORG)).toBe(true);
  });
});
