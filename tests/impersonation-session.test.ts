import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-loginas-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken } = await import("@/lib/auth");
const { getSessionFromCookies } = await import("@/lib/session");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

type Row = { id: number; role: string; group_id: number | null; organization_id: number; token_version: number; display_name: string };

let owner: Row, seller: Row;

const row = (id: number) =>
  getDb().prepare("SELECT id, role, group_id, organization_id, token_version, display_name FROM users WHERE id = ?").get(id) as Row;

/** The token the Login-As route mints: the target's session, carrying the owner as `act`. */
const actingAs = (target: Row, actor: number) =>
  createSessionToken({
    uid: target.id,
    role: target.role as never,
    gid: target.group_id,
    oid: target.organization_id,
    tv: target.token_version,
    name: target.display_name,
    act: actor,
  });

beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)",
  );
  const tag = Date.now();
  owner = row(Number(u.run(`o${tag}`, "x", "مالک", "owner", null, now).lastInsertRowid));
  seller = row(Number(u.run(`s${tag}`, "x", "فروشنده", "phone_sales", null, now).lastInsertRowid));
});

describe("a Login-As session", () => {
  it("is the target's session, and says who is behind it", () => {
    const s = getSessionFromCookies(actingAs(seller, owner.id));
    expect(s?.user.id).toBe(seller.id);
    expect(s?.role).toBe("phone_sales");
    expect(s?.actorId).toBe(owner.id);
  });

  it("an ordinary session has no actor", () => {
    const t = createSessionToken({ uid: seller.id, role: "phone_sales", gid: null, oid: 1, tv: seller.token_version, name: "x" });
    expect(getSessionFromCookies(t)?.actorId).toBeUndefined();
  });

  it("ends the moment the owner behind it is deactivated", () => {
    getDb().prepare("UPDATE users SET active = 0 WHERE id = ?").run(owner.id);
    expect(getSessionFromCookies(actingAs(seller, owner.id))).toBeNull();
  });

  it("ends if the actor is no longer an owner", () => {
    getDb().prepare("UPDATE users SET role = 'group_manager' WHERE id = ?").run(owner.id);
    expect(getSessionFromCookies(actingAs(seller, owner.id))).toBeNull();
  });

  it("refuses an actor from another organisation", () => {
    /* slug is UNIQUE NOT NULL: without it the row is silently skipped and the UPDATE
       below fails on the foreign key instead of testing the rule. */
    getDb()
      .prepare("INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (2, 'دیگر', 'other-org', ?)")
      .run(new Date().toISOString());
    getDb().prepare("UPDATE users SET organization_id = 2 WHERE id = ?").run(owner.id);
    expect(getSessionFromCookies(actingAs(seller, owner.id))).toBeNull();
  });

  it("refuses an actor that does not exist", () => {
    expect(getSessionFromCookies(actingAs(seller, 999_999))).toBeNull();
  });
});
