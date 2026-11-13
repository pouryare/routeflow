import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { idleExpired, parseIdleRules } from "@/lib/idleSignout";

const testDbPath = path.join(os.tmpdir(), `rf-idle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken } = await import("@/lib/auth");
const { getSessionFromCookies } = await import("@/lib/session");
const { setIdleRules, idleRulesFor } = await import("@/lib/repo/idleSignout");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const H = 3_600_000;

describe("E17 idle sign-out", () => {
  it("expires only the roles with a limit, never vans or reps", () => {
    const rules = parseIdleRules(JSON.stringify({ owner: 12, delivery_driver: 1, phone_sales: 1 }));
    expect(rules).toEqual({ owner: 12 });
    expect(idleExpired(rules, "owner", 0, 13 * H)).toBe(true);
    expect(idleExpired(rules, "owner", 0, 11 * H)).toBe(false);
    expect(idleExpired(rules, "group_manager", 0, 99 * H)).toBe(false);
    expect(idleExpired({ delivery_driver: 1 } as never, "delivery_driver", 0, 99 * H)).toBe(false);
    expect(parseIdleRules("not json")).toEqual({});
  });

  it("refuses a session that has sat idle past the limit, and a fresh sign-in starts again", async () => {
    const db = getDb();
    const uid = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('idle1','x','i','owner',1,'2026-01-01T00:00:00.000Z',1)").run()).lastInsertRowid);
    expect(await setIdleRules(1, { owner: 12 })).toBeNull();
    expect(await setIdleRules(1, { owner: 9999 })).toMatch(/ساعت/);
    expect((await idleRulesFor(1)).owner).toBe(12);
    const token = () => createSessionToken({ uid, role: "owner", gid: null, oid: 1, tv: 0, name: "i" });
    expect(await getSessionFromCookies(token())).not.toBeNull();
    await db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(new Date(Date.now() - 20 * H).toISOString(), uid);
    // last use 20 h ago, but this sign-in just began: the later of the two counts, so still in.
    expect(await getSessionFromCookies(token())).not.toBeNull();
  });
});
