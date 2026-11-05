import { describe, it, expect, afterEach } from "vitest";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0";

const { objectKey, normalPrefix, monthOf } = await import("@/lib/storage/driver");
const { s3Driver, s3ErrorReason } = await import("@/lib/storage/s3");
const { localDriver } = await import("@/lib/storage/local");
const { checkEndpoint, isPrivateAddress } = await import("@/lib/storage/endpoint");
const { sealSecret, openSecret } = await import("@/lib/auth");

/** A fake S3 that keeps objects in a Map and pages lists two at a time. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const err = (name: string, code: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: code } });
  return {
    objects,
    async send(c: unknown) {
      const i = (c as { input: Record<string, unknown> }).input;
      const key = i.Key as string;
      if (c instanceof PutObjectCommand) return void objects.set(key, Buffer.from(i.Body as Buffer));
      if (c instanceof GetObjectCommand) {
        const b = objects.get(key);
        if (!b) throw err("NoSuchKey", 404);
        return { Body: { transformToByteArray: async () => new Uint8Array(b) } };
      }
      if (c instanceof HeadObjectCommand) {
        const b = objects.get(key);
        if (!b) throw err("NotFound", 404);
        return { ContentLength: b.length };
      }
      if (c instanceof DeleteObjectCommand) return void objects.delete(key);
      if (c instanceof ListObjectsV2Command) {
        const all = [...objects.keys()].filter((k) => k.startsWith(i.Prefix as string)).sort();
        const start = Number(i.ContinuationToken ?? 0);
        const page = all.slice(start, start + 2);
        const more = start + 2 < all.length;
        return { Contents: page.map((k) => ({ Key: k, Size: objects.get(k)!.length })), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
      }
      throw new Error("unexpected command");
    },
  };
}

describe("object keys", () => {
  it("puts a file under its kind and month, with the random stem as its name", () => {
    expect(objectKey("routeflow/", "photo", "2026-11", "k3f9x2", "webp")).toBe("routeflow/photos/2026-11/k3f9x2.webp");
    expect(objectKey("", "receipt", "2026-01", "a-b_c", "avif")).toBe("receipts/2026-01/a-b_c.avif");
    expect(monthOf(new Date("2026-11-05T10:00:00Z"))).toBe("2026-11");
  });
  it("refuses a stem or extension that could walk out of the folder", () => {
    expect(() => objectKey("routeflow/", "photo", "2026-11", "../x", "webp")).toThrow();
    expect(() => objectKey("routeflow/", "photo", "2026-11", "x", "we/bp")).toThrow();
  });
  it("normalises a prefix and refuses odd ones", () => {
    expect(normalPrefix(undefined)).toBe("routeflow/");
    expect(normalPrefix("/rf")).toBe("rf/");
    expect(normalPrefix("a/../b")).toBeNull();
    expect(normalPrefix("a b")).toBeNull();
  });
});

describe("S3 driver", () => {
  it("writes, reads, sizes, lists across pages and deletes", async () => {
    const s3 = fakeS3();
    const d = s3Driver("b", s3);
    for (const n of ["1", "2", "3"]) await d.put(`p/${n}.webp`, Buffer.from(`x${n}`), "image/webp");
    expect((await d.get("p/2.webp"))?.toString()).toBe("x2");
    expect(await d.head("p/3.webp")).toBe(2);
    const listed = [];
    for await (const o of d.list("p/")) listed.push(o.key);
    expect(listed).toEqual(["p/1.webp", "p/2.webp", "p/3.webp"]);
    await d.remove("p/1.webp");
    await d.remove("p/missing.webp");
    expect(await d.get("p/1.webp")).toBeNull();
    expect(await d.head("p/1.webp")).toBeNull();
  });
  it("turns S3 errors into a reason an owner can act on", () => {
    expect(s3ErrorReason({ name: "InvalidAccessKeyId", $metadata: { httpStatusCode: 403 } })).toMatch("کلید");
    expect(s3ErrorReason({ name: "NoSuchBucket" })).toMatch("باکت");
    expect(s3ErrorReason({ name: "RequestTimeTooSkewed" })).toMatch("ساعت");
  });
});

describe("dev disk driver", () => {
  it("keeps the old flat layout and refuses hidden or odd names", async () => {
    const d = localDriver();
    const key = `routeflow/photos/2026-11/storage-layer-test-${Date.now()}.webp`;
    await d.put(key, Buffer.from("hi"), "image/webp");
    expect((await d.get(key))?.toString()).toBe("hi");
    expect(await d.head(key)).toBe(2);
    await d.remove(key);
    expect(await d.get(key)).toBeNull();
    await expect(d.get("routeflow/photos/2026-11/.env")).rejects.toThrow();
  });
});

describe("endpoint check", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("knows private and loopback addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["185.143.233.1", "8.8.8.8", "2a01:4f8::1"]) expect(isPrivateAddress(ip)).toBe(false);
  });
  it("in production refuses http, paths and internal addresses", async () => {
    process.env.ROUTEFLOW_DEV_STORAGE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect((await checkEndpoint("http://s3.example.com")).ok).toBe(false);
    expect((await checkEndpoint("https://s3.example.com/bucket")).ok).toBe(false);
    expect((await checkEndpoint("https://127.0.0.1")).ok).toBe(false);
    expect((await checkEndpoint("https://10.0.0.5:9000")).ok).toBe(false);
    expect(await checkEndpoint("https://185.143.233.1")).toEqual({ ok: true, url: "https://185.143.233.1" });
  });
});

describe("sealed secrets", () => {
  it("round-trips and reads a damaged value as null", () => {
    const s = sealSecret("storage-secret", "abc123");
    expect(s).not.toContain("abc123");
    expect(openSecret("storage-secret", s)).toBe("abc123");
    expect(openSecret("other-purpose", s)).toBeNull();
    expect(openSecret("storage-secret", "x.y.z")).toBeNull();
  });
});
