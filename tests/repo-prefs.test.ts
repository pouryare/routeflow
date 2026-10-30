import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { getPrefs, setPrefs } = await import("@/lib/repo/prefs");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let uid = 0;
beforeAll(async () => {
  const db = getDb();
  uid = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`pref${Date.now()}`, "x", "م", "group_manager", new Date().toISOString())).lastInsertRowid
  );
});

describe("prefs repo", () => {
  it("defaults to an empty object for an unknown or unset user", async () => {
    expect(await getPrefs(-999)).toEqual({});
    expect(await getPrefs(uid)).toEqual({});
  });

  it("merge-patches and persists across calls", async () => {
    await setPrefs(uid, { board_mobile_mode: "stack" });
    expect((await getPrefs(uid)).board_mobile_mode).toBe("stack");
    await setPrefs(uid, { board_default_view: "time" });
    expect(await getPrefs(uid)).toEqual({ board_mobile_mode: "stack", board_default_view: "time" });
    await setPrefs(uid, { board_mobile_mode: "pager" });
    expect(await getPrefs(uid)).toEqual({ board_mobile_mode: "pager", board_default_view: "time" });
  });


  it("rejects an unknown key", async () => {
    await expect((async () => await setPrefs(uid, { hacked: 1 } as never))()).rejects.toThrow();
  });

  it("keeps the sound switch (F117) and refuses anything but on or off", async () => {
    await setPrefs(uid, { sound: "off" });
    expect((await getPrefs(uid)).sound).toBe("off");
    await expect((async () => await setPrefs(uid, { sound: "loud" } as never))()).rejects.toThrow();
  });

  it("rejects a bad value", async () => {
    await expect((async () => await setPrefs(uid, { board_mobile_mode: "spiral" } as never))()).rejects.toThrow();
    await expect((async () => await setPrefs(uid, { board_default_view: "kanban" } as never))()).rejects.toThrow();
  });

  it("survives a corrupt blob", async () => {
    await getDb().prepare("UPDATE users SET prefs_json = 'not json' WHERE id = ?").run(uid);
    expect(await getPrefs(uid)).toEqual({});
  });
});

describe("company sound skin", () => {
  it("is bubble until the owner picks, then the pick, and the database refuses a skin that is not offered", async () => {
    const { soundSkinFor, setSoundSkin } = await import("@/lib/repo/soundSkin");
    expect(await soundSkinFor(1)).toBe("bubble");
    await setSoundSkin(1, "press");
    expect(await soundSkinFor(1)).toBe("press");
    await expect((async () => await setSoundSkin(1, "plain" as never))()).rejects.toThrow();
    await setSoundSkin(1, "bubble");
  });
});
