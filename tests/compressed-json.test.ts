import { describe, expect, it } from "vitest";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { NextRequest } from "next/server";
import { compressedJson } from "@/lib/httpCache";

const ask = (enc?: string) => new NextRequest("http://x/api/y", { headers: enc ? { "accept-encoding": enc } : {} });
const big = { rows: Array.from({ length: 300 }, (_, i) => ({ id: i, name: "مشتری شمارهٔ " + i })) };

describe("compressedJson", () => {
  it("brotli when the browser takes it, and the body reads back the same", async () => {
    const res = await compressedJson(ask("gzip, br"), big);
    expect(res.headers.get("content-encoding")).toBe("br");
    const raw = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(brotliDecompressSync(raw).toString())).toEqual(big);
    expect(raw.length).toBeLessThan(JSON.stringify(big).length / 3);
  });
  it("gzip when only gzip is offered", async () => {
    const res = await compressedJson(ask("gzip"), big);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())).toEqual(big);
  });
  it("sends a small body, or a client with no encoding, as it is", async () => {
    expect((await compressedJson(ask("br"), { ok: true })).headers.get("content-encoding")).toBeNull();
    const plain = await compressedJson(ask(), big);
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(JSON.parse(await plain.text())).toEqual(big);
  });
  it("keeps the status and extra headers", async () => {
    const res = await compressedJson(ask("br"), { ok: false }, { status: 400, headers: { "X-A": "1" } });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-a")).toBe("1");
  });
});
