import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tmp = path.join("/tmp", `avatar-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.ROUTEFLOW_AVATAR_DIR = tmp;

const { AVATAR_PRESETS, avatarPaths, safePresetKey, readAvatarBytes } = await import(
  "@/lib/avatarStore"
);

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("avatar store", () => {
  it("declares the five presets that were sitting unreferenced in public/avatars", () => {
    expect(AVATAR_PRESETS.map((p) => p.key).sort()).toEqual([
      "hossein", "maryam", "reza", "saeed", "zahra",
    ]);
  });

  it("every preset key is a safe bare token", () => {
    for (const p of AVATAR_PRESETS) expect(p.key).toMatch(/^[a-z0-9-]+$/);
  });

  it("every preset has a source file to seed from", () => {
    // A preset key with no `public/avatars/driver.<key>.jpg` behind it is a button that
    // 404s on first press. The catalogue and the seed source are one contract.
    for (const p of AVATAR_PRESETS) {
      expect(
        fs.existsSync(path.join(process.cwd(), "public", "avatars", `driver.${p.key}.jpg`)),
        `no seed source for preset "${p.key}"`,
      ).toBe(true);
    }
  });

  it("safePresetKey rejects traversal, separators and empty", () => {
    expect(safePresetKey("reza")).toBe("reza");
    for (const bad of ["../etc/passwd", "a/b", "a\\b", "", ".", "..", "re%2Fza"]) {
      expect(safePresetKey(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("avatarPaths puts a stem inside the avatar dir and nowhere else", () => {
    const p = avatarPaths("abc123", "webp");
    expect(p.startsWith(tmp)).toBe(true);
    expect(path.basename(p)).toBe("abc123.webp");
  });

  it("readAvatarBytes returns the bytes that were written", async () => {
    const fake = Buffer.from("RIFF....WEBP");
    fs.writeFileSync(avatarPaths("seed1", "webp"), fake);
    await expect(readAvatarBytes("seed1", "webp")).resolves.toEqual(fake);
  });

  it("readAvatarBytes is null for a missing stem, not a throw", async () => {
    await expect(readAvatarBytes("nope", "webp")).resolves.toBeNull();
  });

  it("a preset key cannot escape via the stem", () => {
    const key = safePresetKey("../../../etc/passwd") ?? "fallback";
    expect(avatarPaths(key, "webp").startsWith(tmp)).toBe(true);
  });
});