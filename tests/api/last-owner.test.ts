import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* "Would this change leave the organisation with no active owner?" must count THIS organisation's
 * owners. It counted every company's, so a company's only owner could deactivate or delete
 * themselves whenever any other company had an owner, stranding the organisation. */

const testDbPath = path.join(os.tmpdir(), `rf-last-owner-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("../helpers/twoOrgs");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const { PATCH, DELETE } = await import("@/app/api/admin/users/[id]/route");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let secondOwnerB = 0;

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  secondOwnerB = Number(
    getDb()
      .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES ('owner-b2', 'x:y', 'b2', 'owner', NULL, 1, '2026-01-01', 2)")
      .run().lastInsertRowid
  );
  getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'owner')").run(secondOwnerB);
});

const req = (actor: number, oid: number, target: number, method: "PATCH" | "DELETE", body?: unknown) =>
  new NextRequest(`http://localhost/api/admin/users/${target}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      cookie: `${COOKIE_NAME}=${createSessionToken({ uid: actor, role: "owner", gid: null, oid, tv: 0, name: "t" })}`,
    },
  });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

describe("the last-owner guard is per organisation", () => {
  it("refuses to deactivate an organisation's only owner even though another company has owners", async () => {
    // Org A has exactly one owner (a.ownerId); org B has two.
    const res = await PATCH(req(a.ownerId, 1, a.ownerId, "PATCH", { active: false }), ctx(a.ownerId));
    expect(res.status).toBe(409);
    expect((getDb().prepare("SELECT active FROM users WHERE id = ?").get(a.ownerId) as { active: number }).active).toBe(1);
  });

  it("refuses to delete an organisation's only owner too", async () => {
    const res = await DELETE(req(a.ownerId, 1, a.ownerId, "DELETE"), ctx(a.ownerId));
    expect(res.status).toBe(409);
  });

  it("still lets an organisation with a second owner deactivate one", async () => {
    const res = await PATCH(req(b.ownerId, 2, secondOwnerB, "PATCH", { active: false }), ctx(secondOwnerB));
    expect(res.status).toBe(200);
    // ...and now b.ownerId is org B's only active owner, so the guard bites there as well.
    const again = await PATCH(req(b.ownerId, 2, b.ownerId, "PATCH", { active: false }), ctx(b.ownerId));
    expect(again.status).toBe(409);
  });
});
