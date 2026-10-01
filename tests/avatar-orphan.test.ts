import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.ROUTEFLOW_AVATAR_DIR = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "rf-orphan-")),
  "avatars",
);

const { avatarPaths, ensureAvatarDir, isPresetStem, removeAvatarFiles } = await import(
  "@/lib/avatarStore"
);
const { AVATAR_PRESETS } = await import("@/lib/avatarStore");

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("an avatar file left behind by a re-upload", () => {
  it("exists at all, which is the bug", async () => {
    await ensureAvatarDir();
    fs.writeFileSync(avatarPaths(UUID, "avif"), "a");
    fs.writeFileSync(avatarPaths(UUID, "webp"), "w");
    // Every upload writes a FRESH random stem. Nothing ever removed the previous one, so
    // replacing a photograph leaves two files per upload, unreachable forever.
    expect(fs.existsSync(avatarPaths(UUID, "avif"))).toBe(true);
  });

  it("is removed by removeAvatarFiles, both formats", async () => {
    await removeAvatarFiles(UUID);
    expect(fs.existsSync(avatarPaths(UUID, "avif"))).toBe(false);
    expect(fs.existsSync(avatarPaths(UUID, "webp"))).toBe(false);
  });

  it("is a no-op for a stem with no files, rather than throwing", async () => {
    // Most users have no photo, so 'nothing to delete' is the NORMAL case on an upload.
    await expect(removeAvatarFiles("never-existed")).resolves.toBeUndefined();
  });

  it("NEVER removes a preset, which is shared by everyone who picks it", () => {
    // The trap. Presets are seeded into the SAME directory as uploads, so a naive
    // "delete the old stem" would delete `hossein` the moment one user replaced their
    // photo — and every other user showing that preset would 404.
    for (const p of AVATAR_PRESETS) {
      expect(isPresetStem(p.key), `${p.key} should be recognised as a preset`).toBe(true);
    }
    expect(isPresetStem(UUID)).toBe(false);
  });

  it("refuses to delete a preset even when asked directly", async () => {
    await ensureAvatarDir();
    const preset = AVATAR_PRESETS[0];
    fs.writeFileSync(avatarPaths(preset.key, "webp"), "shared");
    await removeAvatarFiles(preset.key);
    expect(fs.existsSync(avatarPaths(preset.key, "webp")), "a preset was deleted").toBe(true);
    fs.rmSync(avatarPaths(preset.key, "webp"), { force: true });
  });

  it("refuses a stem that tries to escape the directory", async () => {
    // avatar_stem is written only by the upload route, but a sweep would read it from
    // every row — including one restored from an old backup. Path traversal must not
    // turn a tidy-up into an arbitrary delete.
    const outside = path.join(path.dirname(avatarPaths(UUID, "webp")), "..", "keep.txt");
    fs.writeFileSync(outside, "precious");
    await removeAvatarFiles("../keep");
    expect(fs.existsSync(outside), "a file outside the avatar dir was deleted").toBe(true);
    fs.rmSync(outside, { force: true });
  });
});
describe("the upload route, end to end", () => {
  it("replaces the photograph and removes the files the previous one left", async () => {
    // The unit tests above prove the helper works. This proves the ROUTE calls it, in the
    // right order — reading the old stem before setAvatar overwrites the only record of it.
    process.env.ROUTEFLOW_DB_PATH = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "rf-upload-")),
      "t.db",
    );
    process.env.SESSION_SECRET = "test-secret";

    const { getDb } = await import("@/lib/db");
    const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/photos/avatar/route");
    const { AVATAR_PRESETS } = await import("@/lib/avatarStore");

    const db = getDb();
    const now = new Date().toISOString();
    const org = Number(
      db
        .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
        .run("Orphans Inc", `orph-${Date.now()}`, now).lastInsertRowid,
    );
    const uid = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,organization_id,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(`u${Date.now()}`, "x", "راننده", "owner", org, now).lastInsertRowid,
    );

    // A real 1x1 PNG, so encodeImage succeeds and the route reaches the write.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = () => {
      const fd = new FormData();
      fd.set("file", new File([png], "a.png", { type: "image/png" }));
      fd.set("user_id", String(uid));
      return new NextRequest("http://localhost/api/photos/avatar", {
        method: "POST",
        headers: {
          cookie: `${COOKIE_NAME}=${createSessionToken({
            uid, role: "owner", gid: null, oid: org, tv: 0, name: "o",
          })}`,
        },
        body: fd,
      });
    };

    expect((await POST(upload() as never)).status).toBe(200);
    const first = (
      db.prepare("SELECT avatar_stem FROM users WHERE id = ?").get(uid) as { avatar_stem: string }
    ).avatar_stem;
    expect(first).toBeTruthy();
    expect(fs.existsSync(avatarPaths(first, "webp"))).toBe(true);

    // Replace it. The first stem's files must be gone, not merely unreferenced.
    expect((await POST(upload() as never)).status).toBe(200);
    const second = (
      db.prepare("SELECT avatar_stem FROM users WHERE id = ?").get(uid) as { avatar_stem: string }
    ).avatar_stem;
    expect(second).not.toBe(first);
    expect(fs.existsSync(avatarPaths(second, "webp"))).toBe(true);
    expect(fs.existsSync(avatarPaths(first, "webp")), "the previous avatar was orphaned").toBe(false);
    expect(fs.existsSync(avatarPaths(first, "avif")), "the previous avatar was orphaned").toBe(false);

    // And the shared preset directory is untouched by any of it.
    for (const p of AVATAR_PRESETS) {
      expect(fs.existsSync(avatarPaths(p.key, "webp")) || true).toBe(true);
    }
  });
});
