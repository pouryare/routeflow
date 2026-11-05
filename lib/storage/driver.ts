/** One place files are kept: a company's S3 bucket, or (development only) the server's own disk.
 *  Everything above this interface (rules, mirror, moves, cache) is the same for both. Design:
 *  docs/storage.md. */

export interface ListedObject {
  key: string;
  bytes: number;
}

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the object is not there. Any other failure throws. */
  get(key: string): Promise<Buffer | null>;
  /** The object's size, or null when it is not there. */
  head(key: string): Promise<number | null>;
  /** Removing an object that is not there is not an error. */
  remove(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<ListedObject>;
}

/** The kinds of file a company keeps, and the folder each goes in (decision 11). */
export const FILE_KINDS = ["photo", "receipt", "avatar", "document"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const FOLDER: Record<FileKind, string> = {
  photo: "photos",
  receipt: "receipts",
  avatar: "avatars",
  document: "documents",
};

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  photo: "عکس‌ها",
  receipt: "رسیدها",
  avatar: "عکس کاربران",
  document: "مدارک",
};

const STEM = /^[A-Za-z0-9_-]{1,64}$/;
const EXT = /^[a-z0-9]{1,8}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** `routeflow/photos/2026-11/k3f9x2.webp`. The stem is random, so no customer or person name
 *  ever reaches the bucket. Refuses anything that is not a bare token: the key reaches a path. */
export function objectKey(prefix: string, kind: FileKind, month: string, stem: string, ext: string): string {
  if (!STEM.test(stem) || !EXT.test(ext) || !MONTH.test(month) || !(kind in FOLDER)) {
    throw new Error("نام فایل نامعتبر است");
  }
  return `${prefix}${FOLDER[kind]}/${month}/${stem}.${ext}`;
}

export const isStem = (s: unknown): s is string => typeof s === "string" && STEM.test(s);

/** The month folder for a file stored now, in UTC (the folder is for browsing, not for dates). */
export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/** A storage prefix: empty, or ends in one slash, letters, digits, `-`, `_` and `/` only. */
export function normalPrefix(raw: unknown): string | null {
  if (raw == null || raw === "") return "routeflow/";
  if (typeof raw !== "string") return null;
  const p = raw.trim().replace(/^\/+/, "");
  if (p === "") return "";
  if (!/^[A-Za-z0-9_\-/]{1,100}$/.test(p) || p.includes("//") || p.includes("..")) return null;
  return p.endsWith("/") ? p : `${p}/`;
}
