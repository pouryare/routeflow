/** Where a company's files go and how they come back (docs/storage.md section 4).
 *
 *  saveFile picks the storage from the company's rules, writes every encoding there, and, when the
 *  storage cannot be reached, holds the file on the app server and retries (decision 5). readFile
 *  answers from the 7-day cache, then the file's storage, then its mirror. Routes keep doing their
 *  own company and role checks before they call either. */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { objectKey, isStem, monthOf, type FileKind, type StorageDriver } from "./driver";
import { localDriver, devStorageAllowed } from "./local";
import { s3Client, s3Driver, s3ErrorReason, readableWithoutKey, type S3Sender, type S3Settings } from "./s3";
import { checkEndpoint } from "./endpoint";
import { cacheGet, cachePut, cacheDrop } from "./cache";
import {
  addUsage, claimNearFull, fileByStem, insertStoredFile, listRules, listStorages, logStorageEvent, notifyOwners, queueJob,
  recentEvent, secretOf, updateStoredFile, type StorageRow, type StoredFileRow,
} from "@/lib/repo/storages";

export const NOT_SET_UP = "فضای ذخیره‌سازی تنظیم نشده؛ به مالک شرکت بگویید";

/** Thrown when a company has no storage yet (decision 6). Routes answer 409 with the message. */
export class StorageNotSetUp extends Error {
  constructor() {
    super(NOT_SET_UP);
  }
}

export interface Variant {
  ext: string;
  body: Buffer;
  contentType: string;
}

export const HELD_DIR = process.env.ROUTEFLOW_HELD_DIR ?? path.join(process.cwd(), "data", "held");
const heldPath = (stem: string, ext: string) => path.join(HELD_DIR, `${stem}.${ext}`);

// ---- drivers ----

let makeClient: (s: S3Settings) => S3Sender = s3Client;
/** Tests swap the S3 client for a fake. */
export function setS3ClientFactory(f: ((s: S3Settings) => S3Sender) | null): void {
  makeClient = f ?? s3Client;
  clients.clear();
}
const clients = new Map<string, S3Sender>();

export function settingsOf(s: StorageRow): S3Settings {
  const secret = secretOf(s);
  if (!secret) throw new Error("کلید مخفی این فضا خوانده نمی‌شود؛ آن را دوباره وارد کنید");
  return { endpoint: s.endpoint ?? "", region: s.region ?? "", bucket: s.bucket ?? "", accessKeyId: s.access_key_id ?? "", secretAccessKey: secret };
}

/** The driver for a storage row; null is the dev-only server disk. */
export function driverFor(s: StorageRow | null): StorageDriver {
  if (!s || s.kind === "local") {
    if (!devStorageAllowed()) throw new StorageNotSetUp();
    return localDriver();
  }
  const k = `${s.id}:${s.updated_at}`;
  let c = clients.get(k);
  if (!c) {
    c = makeClient(settingsOf(s));
    clients.set(k, c);
  }
  return s3Driver(s.bucket ?? "", c);
}

export const keyFor = (s: StorageRow | null, f: Pick<StoredFileRow, "file_kind" | "month" | "stem">, ext: string) =>
  objectKey(s?.path_prefix ?? "routeflow/", f.file_kind, f.month, f.stem, ext);

const variantsOf = (f: StoredFileRow) => f.variants.split(",");
const isFull = (s: StorageRow) => s.plan_bytes != null && s.used_bytes >= s.plan_bytes;

// ---- choosing a storage ----

export interface Target {
  storage: StorageRow | null;
  mirror: StorageRow | null;
}

/** The storage a new file of this kind goes to, from the rules (decision 3). */
export async function targetFor(orgId: number, kind: FileKind): Promise<Target> {
  const rules = await listRules(orgId);
  const rule = rules.find((r) => r.file_kind === kind) ?? rules.find((r) => r.file_kind === "*");
  if (!rule) {
    if (devStorageAllowed()) return { storage: null, mirror: null };
    throw new StorageNotSetUp();
  }
  const all = await listStorages(orgId);
  const active = (id: number | null) => all.find((s) => s.id === id && s.state === "active") ?? null;
  const storage = active(rule.storage_id) ?? active(rules.find((r) => r.file_kind === "*")?.storage_id ?? null) ?? all.find((s) => s.state === "active") ?? null;
  if (!storage) throw new StorageNotSetUp();
  const mirror = active(rule.mirror_storage_id);
  return { storage, mirror: mirror && mirror.id !== storage.id ? mirror : null };
}

/** Whether this company can take an upload right now (for disabling photo buttons). */
export async function canUpload(orgId: number): Promise<boolean> {
  if (devStorageAllowed()) return true;
  return (await listRules(orgId)).length > 0;
}

/** At the plan limit (decisions 17 and 22): keep writing, spill to the overflow storage, or hold. */
export async function applyLimit(orgId: number, storage: StorageRow | null): Promise<{ storage: StorageRow | null; hold: boolean; spilledFrom: StorageRow | null }> {
  if (!storage || storage.at_limit === "keep" || !isFull(storage)) return { storage, hold: false, spilledFrom: null };
  const over = storage.overflow_storage_id
    ? (await listStorages(orgId)).find((s) => s.id === storage.overflow_storage_id && s.state === "active")
    : undefined;
  if (over && !(over.at_limit === "spill" && isFull(over))) return { storage: over, hold: false, spilledFrom: storage };
  return { storage, hold: true, spilledFrom: null };
}

async function warnIfNearFull(orgId: number, s: StorageRow | undefined): Promise<void> {
  if (!s || !await claimNearFull(orgId, s.id)) return;
  await logStorageEvent(orgId, s.id, "near_full", `${s.used_bytes} از ${s.plan_bytes} بایت`);
  await notifyOwners(orgId, `فضای «${s.name}» نزدیک به پر شدن است`, "اندازهٔ طرح را بالا ببرید یا فضای دیگری برای سرریز انتخاب کنید.", `storage.near_full.${s.id}`);
}

// ---- writing ----

async function holdLocally(stem: string, variants: Variant[]): Promise<void> {
  await fs.mkdir(HELD_DIR, { recursive: true });
  for (const v of variants) await fs.writeFile(heldPath(stem, v.ext), v.body);
}

/** Stores a new file. Throws StorageNotSetUp when the company has no storage (decision 6); every
 *  other failure holds the file on the server, so the person's upload still succeeds (decision 5). */
export async function saveFile(orgId: number, kind: FileKind, stem: string, variants: Variant[]): Promise<void> {
  if (!isStem(stem) || variants.length === 0) throw new Error("نام فایل نامعتبر است");
  const target = await targetFor(orgId, kind);
  const pick = await applyLimit(orgId, target.storage);
  const month = monthOf();
  const file = { file_kind: kind, month, stem };
  const bytes = variants.reduce((n, v) => n + v.body.length, 0);

  let held = pick.hold;
  let reason = held ? "فضا پر است و فضای سرریز ندارد" : "";
  if (!held) {
    try {
      const d = driverFor(pick.storage);
      for (const v of variants) await d.put(keyFor(pick.storage, file, v.ext), v.body, v.contentType);
    } catch (e) {
      if (e instanceof StorageNotSetUp) throw e;
      held = true;
      reason = s3ErrorReason(e);
    }
  }
  if (held) await holdLocally(stem, variants);
  for (const v of variants) await cachePut(stem, v.ext, v.body);

  const id = await insertStoredFile({
    organization_id: orgId,
    file_kind: kind,
    stem,
    variants: variants.map((v) => v.ext).join(","),
    month,
    storage_id: pick.storage?.id ?? null,
    bytes,
    mirror_storage_id: target.mirror?.id ?? null,
    mirror_state: target.mirror ? "pending" : "none",
    upload_state: held ? "held" : "stored",
    held_since: held ? new Date().toISOString() : null,
  });

  if (held) {
    await queueJob(orgId, "upload", id, null, 60_000);
    if (!await recentEvent(orgId, pick.storage?.id ?? null, "held", 60)) {
      await logStorageEvent(orgId, pick.storage?.id ?? null, "held", reason);
    }
    return;
  }
  if (pick.storage) await warnIfNearFull(orgId, await addUsage(orgId, pick.storage.id, bytes, 1));
  if (pick.spilledFrom && !await recentEvent(orgId, pick.spilledFrom.id, "spilled", 24 * 60)) {
    await logStorageEvent(orgId, pick.spilledFrom.id, "spilled", `فایل‌های تازه به «${pick.storage?.name}» می‌روند`);
    await notifyOwners(orgId, `فضای «${pick.spilledFrom.name}» پر شد`, `فایل‌های تازه به «${pick.storage?.name}» می‌روند.`, `storage.spilled.${pick.spilledFrom.id}`);
  }
  if (target.mirror) {
    const row = await fileByStem(stem);
    if (row) await copyToMirror(row, variants).catch(() => queueJob(orgId, "mirror", id, null, 60_000));
  }
}

/** Writes the mirror copy; `bodies` saves a read when the caller has them. */
export async function copyToMirror(f: StoredFileRow, bodies?: Variant[]): Promise<void> {
  if (!f.mirror_storage_id) return;
  const mirror = (await listStorages(f.organization_id)).find((s) => s.id === f.mirror_storage_id);
  if (!mirror) return;
  const from = await storageOf(f);
  const to = driverFor(mirror);
  for (const ext of variantsOf(f)) {
    const body = bodies?.find((b) => b.ext === ext)?.body ?? (await driverFor(from).get(keyFor(from, f, ext)));
    if (!body) throw new Error("فایل اصلی پیدا نشد");
    await to.put(keyFor(mirror, f, ext), body, contentTypeOf(ext));
  }
  await updateStoredFile(f.id, { mirror_state: "done" });
  await addUsage(f.organization_id, mirror.id, f.bytes, 1);
}

export const contentTypeOf = (ext: string) =>
  ({ webp: "image/webp", avif: "image/avif", jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" })[ext] ?? "application/octet-stream";

async function storageOf(f: StoredFileRow): Promise<StorageRow | null> {
  if (f.storage_id == null) return null;
  return (await listStorages(f.organization_id, true)).find((s) => s.id === f.storage_id) ?? null;
}

/** Sends a held file to its storage once it can be reached; false when it must wait again. */
export async function sendHeld(f: StoredFileRow): Promise<boolean> {
  const target = await targetFor(f.organization_id, f.file_kind);
  const pick = await applyLimit(f.organization_id, target.storage);
  if (pick.hold) return false;
  const d = driverFor(pick.storage);
  for (const ext of variantsOf(f)) {
    const body = await fs.readFile(heldPath(f.stem, ext));
    await d.put(keyFor(pick.storage, f, ext), body, contentTypeOf(ext));
  }
  await updateStoredFile(f.id, { upload_state: "stored", held_since: null, storage_id: pick.storage?.id ?? null });
  if (pick.storage) await warnIfNearFull(f.organization_id, await addUsage(f.organization_id, pick.storage.id, f.bytes, 1));
  for (const ext of variantsOf(f)) await fs.rm(heldPath(f.stem, ext), { force: true });
  if (f.mirror_storage_id) await queueJob(f.organization_id, "mirror", f.id);
  return true;
}

// ---- reading ----

/** The bytes of one encoding, or null. `kind` only matters for files from before storages
 *  (dev disk), whose folder depends on it. */
export async function readFile(stem: string, ext: string, kind: FileKind): Promise<Buffer | null> {
  if (!isStem(stem) || !/^[a-z0-9]{1,8}$/.test(ext)) return null;
  const cached = await cacheGet(stem, ext);
  if (cached) return cached;
  const f = await fileByStem(stem);
  let body: Buffer | null = null;
  if (!f) {
    if (!devStorageAllowed()) return null;
    body = await localDriver().get(objectKey("routeflow/", kind, "2000-01", stem, ext)).catch(() => null);
  } else {
    if (!variantsOf(f).includes(ext)) return null;
    if (f.upload_state === "held") {
      body = await fs.readFile(heldPath(stem, ext)).catch(() => null);
    } else {
      const s = await storageOf(f);
      body = await driverFor(s).get(keyFor(s, f, ext)).catch(() => null);
      if (!body && f.mirror_storage_id && f.mirror_state === "done") {
        const m = (await listStorages(f.organization_id, true)).find((x) => x.id === f.mirror_storage_id) ?? null;
        body = await driverFor(m).get(keyFor(m, f, ext)).catch(() => null);
      }
    }
  }
  if (body) await cachePut(stem, ext, body);
  return body;
}

// ---- deleting ----

/** Moves a file to the 30-day trash (decision 12). `ref` is what restoring needs to put it back
 *  (for a photo: what it was a photo of). Nothing is removed from the bucket until the purge. */
export async function trashFile(stem: string | null | undefined, kind: FileKind, userId: number | null, ref: Record<string, unknown> | null = null): Promise<void> {
  if (!isStem(stem)) return;
  const f = await fileByStem(stem);
  if (!f) {
    // From before storages: the dev disk only, removed at once as before.
    if (devStorageAllowed()) {
      for (const ext of ["avif", "webp"]) await localDriver().remove(objectKey("routeflow/", kind, "2000-01", stem, ext)).catch(() => {});
      await cacheDrop(stem, ["avif", "webp"]);
    }
    return;
  }
  if (f.deleted_at) return;
  await getDb()
    .prepare("UPDATE stored_files SET deleted_at = ?, deleted_by = ?, trash_ref = ? WHERE id = ?")
    .run(new Date().toISOString(), userId, ref ? JSON.stringify(ref).slice(0, 1000) : null, f.id);
}

/** Removes every copy of a file for good: its storage, its mirror, the held copy and the cache. */
export async function eraseFile(f: StoredFileRow): Promise<void> {
  const all = await listStorages(f.organization_id, true);
  const byId = (id: number | null) => all.find((s) => s.id === id) ?? null;
  const exts = variantsOf(f);
  const main = byId(f.storage_id);
  for (const ext of exts) await driverFor(main).remove(keyFor(main, f, ext));
  if (main && f.upload_state === "stored") await addUsage(f.organization_id, main.id, -f.bytes, -1);
  if (f.mirror_storage_id && f.mirror_state === "done") {
    const m = byId(f.mirror_storage_id);
    for (const ext of exts) await driverFor(m).remove(keyFor(m, f, ext));
    if (m) await addUsage(f.organization_id, m.id, -f.bytes, -1);
  }
  for (const ext of exts) await fs.rm(heldPath(f.stem, ext), { force: true });
  await cacheDrop(f.stem, exts);
}

// ---- testing a storage ----

export type TestResult = { ok: true } | { ok: false; reason: string };

/** Decision 7: write, read back and delete a tiny file, and refuse a bucket a stranger can read. */
export async function testStorage(kind: "s3" | "local", settings: S3Settings | null, prefix: string): Promise<TestResult> {
  if (kind === "local") return devStorageAllowed() ? { ok: true } : { ok: false, reason: "دیسک سرور فقط در حالت توسعه در دسترس است" };
  if (!settings) return { ok: false, reason: "تنظیمات ناقص است" };
  const ep = await checkEndpoint(settings.endpoint);
  if (!ep.ok) return ep;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(settings.bucket)) return { ok: false, reason: "نام باکت نامعتبر است (حروف کوچک انگلیسی، عدد، نقطه و خط تیره)" };
  const d = s3Driver(settings.bucket, makeClient({ ...settings, endpoint: ep.url }));
  const key = `${prefix}.check/${crypto.randomUUID()}.txt`;
  const body = Buffer.from("routeflow storage check");
  try {
    await d.put(key, body, "text/plain");
  } catch (e) {
    return { ok: false, reason: `نوشتن ناموفق بود: ${s3ErrorReason(e)}` };
  }
  try {
    const back = await d.get(key);
    if (!back || !back.equals(body)) return { ok: false, reason: "فایل آزمایشی نوشته شد ولی همان فایل برنگشت" };
    if (await readableWithoutKey(ep.url, settings.bucket, key)) {
      return { ok: false, reason: "این باکت عمومی است و هر کسی فایل‌ها را می‌بیند؛ در پنل آن را خصوصی کنید" };
    }
  } catch (e) {
    return { ok: false, reason: `خواندن ناموفق بود: ${s3ErrorReason(e)}` };
  } finally {
    await d.remove(key).catch(() => {});
  }
  return { ok: true };
}

/** Takes back a file just saved whose record could not be written (no trash: nothing pointed at it). */
export async function discardFile(stem: string): Promise<void> {
  const f = await fileByStem(stem);
  if (!f) return;
  await eraseFile(f);
  await getDb().prepare("DELETE FROM stored_files WHERE id = ?").run(f.id);
}

/** A route's answer when saveFile refused: 409 with the reason for "no storage yet". */
export function storageRefusal(e: unknown): { error: string; status: number } | null {
  return e instanceof StorageNotSetUp ? { error: e.message, status: 409 } : null;
}
