import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { getPrefs, setPrefs } = await import("@/lib/repo/prefs");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let uid = 0;
beforeAll(() => {
  const db = getDb();
  uid = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`pref${Date.now()}`, "x", "م", "group_manager", new Date().toISOString()).lastInsertRowid
  );
});

describe("prefs repo", () => {
  it("defaults to an empty object for an unknown or unset user", () => {
    expect(getPrefs(-999)).toEqual({});
    expect(getPrefs(uid)).toEqual({});
  });

  it("merge-patches and persists across calls", () => {
    setPrefs(uid, { board_mobile_mode: "stack" });
    expect(getPrefs(uid).board_mobile_mode).toBe("stack");
    setPrefs(uid, { board_default_view: "time" });
    expect(getPrefs(uid)).toEqual({ board_mobile_mode: "stack", board_default_view: "time" });
    setPrefs(uid, { board_mobile_mode: "pager" });
    expect(getPrefs(uid)).toEqual({ board_mobile_mode: "pager", board_default_view: "time" });
  });

  it("rejects an unknown key", () => {
    expect(() => setPrefs(uid, { hacked: 1 } as never)).toThrow();
  });

  it("rejects a bad value", () => {
    expect(() => setPrefs(uid, { board_mobile_mode: "spiral" } as never)).toThrow();
    expect(() => setPrefs(uid, { board_default_view: "kanban" } as never)).toThrow();
  });

  it("survives a corrupt blob", () => {
    getDb().prepare("UPDATE users SET prefs_json = 'not json' WHERE id = ?").run(uid);
    expect(getPrefs(uid)).toEqual({});
  });
});
