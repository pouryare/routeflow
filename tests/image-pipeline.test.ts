import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { encodeImage, encodeThumb, AVATAR_MAX_EDGE, PHOTO_MAX_EDGE, THUMB_MAX_EDGE } from "@/lib/imagePipeline";

/** An image built in memory so the test needs no fixture file. */
async function sample(w = 4, h = 3): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe("encodeImage", () => {
  it("produces BOTH avif and webp from one input", async () => {
    const out = await encodeImage(await sample(), PHOTO_MAX_EDGE);
    expect(out.avif.length).toBeGreaterThan(0);
    expect(out.webp.length).toBeGreaterThan(0);
  });

  it("the avif buffer really is avif and the webp buffer really is webp", async () => {
    const out = await encodeImage(await sample(), PHOTO_MAX_EDGE);
    expect(await sharp(out.avif).metadata()).toMatchObject({ format: "heif" });
    expect(await sharp(out.webp).metadata()).toMatchObject({ format: "webp" });
  });

  it("never enlarges a small image", async () => {
    const out = await encodeImage(await sample(), PHOTO_MAX_EDGE);
    const meta = await sharp(out.webp).metadata();
    expect(meta.width).toBe(4);
    expect(meta.height).toBe(3);
  });

  it("resizes a large image down to the given max edge", async () => {
    const out = await encodeImage(await sample(3000, 2000), PHOTO_MAX_EDGE);
    const meta = await sharp(out.webp).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(PHOTO_MAX_EDGE);
  });

  it("an avatar is capped smaller than a photo", () => {
    expect(AVATAR_MAX_EDGE).toBeLessThan(PHOTO_MAX_EDGE);
  });

  it("rejects a buffer sharp cannot read", async () => {
    await expect(encodeImage(Buffer.from("not an image"), PHOTO_MAX_EDGE)).rejects.toThrow();
  });
});

describe("encodeThumb", () => {
  it("makes a grid-sized WebP that is much smaller than the stored photo, and never enlarges", async () => {
    const big = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
    const stored = (await encodeImage(big, PHOTO_MAX_EDGE)).webp;
    const thumb = await encodeThumb(stored);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMB_MAX_EDGE);
    expect(thumb.length).toBeLessThan(stored.length / 2);
    const small = await encodeThumb((await encodeImage(await sample(40, 30), PHOTO_MAX_EDGE)).webp);
    expect((await sharp(small).metadata()).width).toBe(40);
  });
});
