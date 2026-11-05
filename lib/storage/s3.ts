import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ListedObject, StorageDriver } from "./driver";

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** What the driver needs from an S3 client: `send`. Tests pass a fake. */
export interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

/** Arvan's two regions (decision 14): one tap in the add-storage sheet. */
export const ARVAN_PRESETS = [
  { key: "arvan-thr", label: "آروان، تهران", endpoint: "https://s3.ir-thr-at1.arvanstorage.ir", region: "ir-thr-at1" },
  { key: "arvan-tbz", label: "آروان، تبریز", endpoint: "https://s3.ir-tbz-sh1.arvanstorage.ir", region: "ir-tbz-sh1" },
] as const;

export function s3Client(s: S3Settings): S3Client {
  return new S3Client({
    endpoint: s.endpoint,
    region: s.region || "us-east-1",
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // Path-style URLs work on Arvan, MinIO and Garage alike; virtual-host style needs DNS per bucket.
    forcePathStyle: true,
    // Newer SDKs add CRC checksums by default, which several S3-compatible services reject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
}

const status = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const isMissing = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  return name === "NoSuchKey" || name === "NotFound" || status(e) === 404;
};

export function s3Driver(bucket: string, client: S3Sender): StorageDriver {
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : Buffer.alloc(0);
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async head(key) {
      try {
        const out = (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))) as { ContentLength?: number };
        return out.ContentLength ?? 0;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    },
    async *list(prefix): AsyncIterable<ListedObject> {
      let token: string | undefined;
      do {
        const out = (await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        )) as { Contents?: { Key?: string; Size?: number }[]; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const o of out.Contents ?? []) if (o.Key) yield { key: o.Key, bytes: o.Size ?? 0 };
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

/** Whether a stranger with no key can list the bucket or read `key` in it (decision 7: a public
 *  bucket is refused). Path-style URL, no signature. A network error counts as "not public". */
export async function readableWithoutKey(endpoint: string, bucket: string, key: string): Promise<boolean> {
  const base = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`;
  const urls = [`${base}/?list-type=2&max-keys=1`, `${base}/${key.split("/").map(encodeURIComponent).join("/")}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) return true;
    } catch {
      /* unreachable anonymously is what we want */
    }
  }
  return false;
}

/** A Persian reason for an S3 failure, for the owner (decision 7: each failed step says why). */
export function s3ErrorReason(e: unknown): string {
  const name = (e as { name?: string; Code?: string })?.name ?? "";
  const code = status(e);
  if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || code === 403 && /Signature|AccessKey/.test(name)) {
    return "کلید دسترسی یا کلید مخفی درست نیست";
  }
  if (name === "AccessDenied" || code === 403) return "این کلید اجازهٔ دسترسی به این باکت را ندارد";
  if (name === "NoSuchBucket") return "باکتی با این نام پیدا نشد";
  if (name === "RequestTimeTooSkewed") return "ساعت سرور با ساعت فضای ذخیره‌سازی هماهنگ نیست";
  if (name === "QuotaExceeded" || name === "EntityTooLarge" || code === 507) return "فضای این باکت پر شده است";
  if (name === "TimeoutError" || name === "ENOTFOUND" || name === "ECONNREFUSED" || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(String((e as Error)?.message))) {
    return "نشانی فضای ذخیره‌سازی در دسترس نیست";
  }
  return "فضای ذخیره‌سازی خطا داد" + (name ? ` (${name})` : "");
}
