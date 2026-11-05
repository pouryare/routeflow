import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

process.env.SESSION_SECRET = "test-secret";
process.env.ROUTEFLOW_FILE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rf-cache-"));
process.env.ROUTEFLOW_HELD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rf-held-"));

const { getDb } = await import("@/lib/db");
const files = await import("@/lib/storage/files");
const maint = await import("@/lib/storage/maintenance");
const repo = await import("@/lib/repo/storages");

/** One fake S3 service holding every bucket; a bucket can be switched "down". */
const buckets = new Map<string, Map<string, Buffer>>();
const down = new Set<string>();
function fakeClient(bucketName: string) {
  return {
    async send(c: unknown) {
      if (down.has(bucketName)) throw Object.assign(new Error("connect ECONNREFUSED"), { name: "TimeoutError" });
      const i = (c as { input: Record<string, unknown> }).input;
      const b = buckets.get(i.Bucket as string) ?? new Map<string, Buffer>();
      buckets.set(i.Bucket as string, b);
      const key = i.Key as string;
      const missing = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      if (c instanceof PutObjectCommand) return void b.set(key, Buffer.from(i.Body as Buffer));
      if (c instanceof GetObjectCommand) {
        if (!b.has(key)) throw missing();
        return { Body: { transformToByteArray: async () => new Uint8Array(b.get(key)!) } };
      }
      if (c instanceof HeadObjectCommand) {
        if (!b.has(key)) throw missing();
        return { ContentLength: b.get(key)!.length };
      }
      if (c instanceof DeleteObjectCommand) return void b.delete(key);
      if (c instanceof ListObjectsV2Command) {
        return { Contents: [...b.entries()].filter(([k]) => k.startsWith(i.Prefix as string)).map(([k, v]) => ({ Key: k, Size: v.length })) };
      }
      throw new Error("unexpected");
    },
  };
}
files.setS3ClientFactory((s) => fakeClient(s.bucket));
// The "is the bucket public?" probe is a plain fetch: answer 403 like a private bucket.
globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;

let orgN = 10;
let owner = 0;
async function company(): Promise<number> {
  const id = ++orgN;
  await getDb().prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, '2026-01-01')").run(id, `c${id}`, `c${id}`);
  owner = Number((await getDb()
    .prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES (?,?,?,?,?,1,'2026-01-01')")
    .run(`o${id}`, "x:y", "مالک", "owner", id)).lastInsertRowid);
  return id;
}
const input = (o: Partial<import("@/lib/repo/storages").StorageInput> = {}) => ({
  name: "تهران", kind: "s3" as const, endpoint: "https://s3.example.ir", region: "ir-thr-at1", bucket: "b1", path_prefix: "routeflow/",
  access_key_id: "AK", secret: "SECRET-1234", plan_bytes: null, warn_percent: 90, at_limit: "keep" as const, overflow_storage_id: null, ...o,
});
const v = (n: number, ext = "webp") => ({ ext, body: Buffer.alloc(n, 1), contentType: "image/webp" });
const stem = () => `t${Math.random().toString(36).slice(2, 12)}`;
const objects = (bucket: string) => [...(buckets.get(bucket)?.keys() ?? [])].filter((k) => !k.includes(".check"));

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  down.clear();
});
beforeAll(async () => {
  getDb();
});

describe("a company with no storage", () => {
  it("cannot upload in production, and can on the dev disk", async () => {
    const org = await company();
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(files.saveFile(org, "photo", stem(), [v(10)])).rejects.toBeInstanceOf(files.StorageNotSetUp);
    expect(await files.canUpload(org)).toBe(false);
    (process.env as Record<string, string>).NODE_ENV = "test";
    expect(await files.canUpload(org)).toBe(true);
  });
});

describe("saving and reading", () => {
  it("writes every encoding under the type and month folder, counts usage, reads back", async () => {
    const org = await company();
    const id = await repo.insertStorage(org, input({ bucket: "save1" }), owner);
    const s = stem();
    await files.saveFile(org, "photo", s, [v(10, "avif"), v(20)]);
    const month = new Date().toISOString().slice(0, 7);
    expect(objects("save1").sort()).toEqual([`routeflow/photos/${month}/${s}.avif`, `routeflow/photos/${month}/${s}.webp`]);
    const st = await repo.getStorage(org, id);
    expect([st?.used_bytes, st?.file_count]).toEqual([30, 1]);
    fs.rmSync(process.env.ROUTEFLOW_FILE_CACHE_DIR!, { recursive: true, force: true }); // force a bucket read
    expect((await files.readFile(s, "webp", "photo"))?.length).toBe(20);
    expect(await files.readFile(s, "png", "photo")).toBeNull();
  });

  it("sends a file type to its own storage and copies it to the mirror", async () => {
    const org = await company();
    await repo.insertStorage(org, input({ bucket: "main2" }), owner);
    const tbz = await repo.insertStorage(org, input({ name: "تبریز", bucket: "rcpt2" }), owner);
    const copy = await repo.insertStorage(org, input({ name: "کپی", bucket: "copy2" }), owner);
    const rules = await repo.listRules(org);
    await repo.replaceRules(org, [...rules, { file_kind: "receipt", storage_id: tbz, mirror_storage_id: copy }]);
    const s = stem();
    await files.saveFile(org, "receipt", s, [v(5)]);
    expect(objects("rcpt2")).toHaveLength(1);
    expect(objects("copy2")).toHaveLength(1);
    expect(objects("main2")).toHaveLength(0);
    expect((await repo.fileByStem(s))?.mirror_state).toBe("done");
    // The main copy disappears by hand: reads fall back to the mirror.
    buckets.get("rcpt2")!.clear();
    fs.rmSync(process.env.ROUTEFLOW_FILE_CACHE_DIR!, { recursive: true, force: true });
    expect((await files.readFile(s, "webp", "receipt"))?.length).toBe(5);
  });
});

describe("a storage that is down (decision 5)", () => {
  it("holds the upload on the server, serves it from there, and sends it when the storage is back", async () => {
    const org = await company();
    await repo.insertStorage(org, input({ bucket: "down3" }), owner);
    down.add("down3");
    const s = stem();
    await files.saveFile(org, "photo", s, [v(8)]);
    const row = await repo.fileByStem(s);
    expect(row?.upload_state).toBe("held");
    fs.rmSync(process.env.ROUTEFLOW_FILE_CACHE_DIR!, { recursive: true, force: true });
    expect((await files.readFile(s, "webp", "photo"))?.length).toBe(8);
    down.clear();
    await getDb().prepare("UPDATE storage_jobs SET next_try_at = '2000-01-01' WHERE stored_file_id = ?").run(row!.id);
    expect(await maint.runStorageJobs(org)).toBe(1);
    expect((await repo.fileByStem(s))?.upload_state).toBe("stored");
    expect(objects("down3")).toHaveLength(1);
  });
});

describe("the plan limit (decisions 17 and 22)", () => {
  it("keeps uploading by default, warns once near full", async () => {
    const org = await company();
    const id = await repo.insertStorage(org, input({ bucket: "keep4", plan_bytes: 100, warn_percent: 50 }), owner);
    await files.saveFile(org, "photo", stem(), [v(60)]);
    await files.saveFile(org, "photo", stem(), [v(60)]);
    expect(objects("keep4")).toHaveLength(2);
    expect((await repo.getStorage(org, id))?.near_full_at).toBeTruthy();
    const n = await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE organization_id = ? AND type_code = 'storage.problem'").get(org) as { n: number };
    expect(Number(n.n)).toBe(1);
  });

  it("spills to the overflow storage when full, and holds when there is none", async () => {
    const org = await company();
    const over = await repo.insertStorage(org, input({ name: "سرریز", bucket: "over5" }), owner);
    const full = await repo.insertStorage(org, input({ bucket: "full5", plan_bytes: 10, at_limit: "spill", overflow_storage_id: over }), owner);
    await repo.replaceRules(org, [{ file_kind: "*", storage_id: full, mirror_storage_id: null }]);
    await files.saveFile(org, "photo", stem(), [v(20)]); // fills it
    await files.saveFile(org, "photo", stem(), [v(5)]); // spills
    expect(objects("full5")).toHaveLength(1);
    expect(objects("over5")).toHaveLength(1);
    await getDb().prepare("UPDATE storages SET overflow_storage_id = NULL WHERE id = ?").run(full);
    const s = stem();
    await files.saveFile(org, "photo", s, [v(5)]);
    expect((await repo.fileByStem(s))?.upload_state).toBe("held");
  });
});

describe("trash (decision 12)", () => {
  it("keeps a deleted file for 30 days, then erases every copy", async () => {
    const org = await company();
    await repo.insertStorage(org, input({ bucket: "trash6" }), owner);
    const s = stem();
    await files.saveFile(org, "photo", s, [v(7)]);
    await files.trashFile(s, "photo", owner, { table: "photos" });
    expect(objects("trash6")).toHaveLength(1);
    expect(await maint.purgeTrash(org)).toBe(0);
    expect(await maint.purgeTrash(org, new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    expect(objects("trash6")).toHaveLength(0);
    expect(await repo.fileByStem(s)).toBeUndefined();
  });
});

describe("moves and removal (decisions 9 and 18)", () => {
  it("moves every file to the new default, then deletes the old copies when asked", async () => {
    const org = await company();
    const a = await repo.insertStorage(org, input({ bucket: "movea" }), owner);
    const b = await repo.insertStorage(org, input({ name: "تازه", bucket: "moveb" }), owner);
    for (let i = 0; i < 3; i++) await files.saveFile(org, "photo", stem(), [v(4)]);
    const moveId = await maint.startMove(org, a, b, "default", owner);
    expect((await repo.listRules(org)).find((r) => r.file_kind === "*")?.storage_id).toBe(b);
    await getDb().prepare("UPDATE storage_jobs SET next_try_at = '2000-01-01'").run();
    await maint.runStorageJobs(org);
    const m = await repo.getMove(org, moveId);
    expect([m?.done, m?.total, m?.state]).toEqual([3, 3, "finished"]);
    expect(objects("moveb")).toHaveLength(3);
    expect(objects("movea")).toHaveLength(3); // still there until the owner chooses
    expect(await maint.closeMove(org, moveId, true)).toBe(true);
    await getDb().prepare("UPDATE storage_jobs SET next_try_at = '2000-01-01'").run();
    await maint.runStorageJobs(org);
    expect(objects("movea")).toHaveLength(0);
    expect((await repo.getStorage(org, a))?.file_count).toBe(0);
    expect((await repo.getStorage(org, b))?.file_count).toBe(3);
  });

  it("removes a storage only once its files have moved", async () => {
    const org = await company();
    const a = await repo.insertStorage(org, input({ bucket: "rema" }), owner);
    const b = await repo.insertStorage(org, input({ name: "دوم", bucket: "remb" }), owner);
    await files.saveFile(org, "photo", stem(), [v(4)]);
    expect(await maint.removeIfEmpty(org, a, owner)).toBe(false);
    await maint.startMove(org, a, b, "remove", owner);
    expect((await repo.getStorage(org, a))?.state).toBe("moving_out");
    await getDb().prepare("UPDATE storage_jobs SET next_try_at = '2000-01-01'").run();
    await maint.runStorageJobs(org);
    expect((await repo.getStorage(org, a))?.state).toBe("removed");
    expect(await maint.removeIfEmpty(org, b, owner)).toBe(false);
  });
});

describe("checks (decisions 7 and 21)", () => {
  it("the save test writes, reads, deletes and refuses a public bucket", async () => {
    const settings = { endpoint: "http://s3.example.ir", region: "x", bucket: "check7", accessKeyId: "a", secretAccessKey: "b" };
    expect(await files.testStorage("s3", settings, "routeflow/")).toEqual({ ok: true });
    expect(objects("check7")).toHaveLength(0);
    globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
    const r = await files.testStorage("s3", settings, "routeflow/");
    expect(r.ok).toBe(false);
    globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
    down.add("check7");
    expect((await files.testStorage("s3", settings, "routeflow/")).ok).toBe(false);
  });

  it("the daily check logs a failing key once, and the weekly spot-check finds a missing file", async () => {
    const org = await company();
    const id = await repo.insertStorage(org, input({ bucket: "daily8" }), owner);
    await files.saveFile(org, "photo", stem(), [v(3)]);
    down.add("daily8");
    expect((await maint.dailySweep(org)).failed).toBe(1);
    expect((await repo.getStorage(org, id))?.last_check_error).toBeTruthy();
    down.clear();
    buckets.get("daily8")!.clear();
    expect((await maint.weeklySweep(org)).missing).toBe(1);
    expect((await repo.listEvents(org)).map((e) => e.kind)).toEqual(expect.arrayContaining(["check_failed", "file_missing"]));
    expect((await repo.getStorage(org, id))?.used_bytes).toBe(0); // recounted from the bucket
  });
});
