import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `avatar-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

let owner = 0;
let manager = 0;
let driver = 0;
let org = 0;
let group = 0;

/** The claims lib/auth.ts actually signs. Anything else fails the MAC check, and a 401
 *  for a malformed cookie would make this whole file pass for the wrong reason. `tv` must
 *  equal users.token_version, which the schema defaults to 0. */
const tokenFor = (uid: number, role: "owner" | "group_manager" | "delivery_driver") =>
  createSessionToken({ uid, role, gid: null, oid: org, tv: 0, name: "t" });

function req(token: string, body: unknown, id = driver): InstanceType<typeof NextRequest> {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` },
    body: JSON.stringify(body),
  });
}

const avatarOf = (id: number) =>
  (getDb().prepare("SELECT avatar_url FROM users WHERE id = ?").get(id) as {
    avatar_url: string | null;
  }).avatar_url;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  org = Number(
    db
      .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
      .run("Avatars Inc", `avatars-${Date.now()}`, now).lastInsertRowid,
  );
  // The route refuses to edit a non-owner who has no group (route.ts:117), so the driver
  // needs one. Without it every assertion here would be measuring THAT 400, not this task.
  group = Number(
    db
      .prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)")
      .run("گروه", `g-${Date.now()}`, now).lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,organization_id,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "مالک", "owner", null, org, now).lastInsertRowid);
  manager = Number(u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", group, org, now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x", "راننده", "delivery_driver", group, org, now).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("avatar_url on the admin user PATCH", () => {
  it("an owner can set an avatar", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: "/api/users/7/avatar" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(avatarOf(driver)).toBe("/api/users/7/avatar");
  });

  it("a NON-owner is refused", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(manager, "group_manager");
    const res = await PATCH(req(token, { avatar_url: "/api/users/9/avatar" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(403);
  });

  it("an empty string clears the photo, and clearing is not the same as failing", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    expect(avatarOf(driver)).toBe("/api/users/7/avatar");
    const res = await PATCH(req(token, { avatar_url: "" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(avatarOf(driver)).toBeNull();
  });

  it("a preset key is allowed", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: "/api/users/7/avatar?key=chef-2" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(avatarOf(driver)).toBe("/api/users/7/avatar?key=chef-2");
  });

  /**
   * This column is rendered as an <img src> on every page that shows a person, so an
   * arbitrary URL would make every reader's browser fetch a third party on login, and a
   * `javascript:` value would turn the admin screen into an XSS sink. The door is the
   * cheap place to refuse it.
   */
  it.each([
    ["https://evil.example/pixel.png", "an off-site URL"],
    ["javascript:alert(1)", "a javascript: URL"],
    ["//evil.example/p.png", "a protocol-relative URL"],
    ["/api/users/abc/avatar", "a non-numeric id"],
    ["/uploads/../../etc/passwd", "a traversal"],
  ])("refuses %s (%s)", async (bad) => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: bad }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(400);
    // and the refused value must not have been written
    expect(avatarOf(driver)).toBe("/api/users/7/avatar?key=chef-2");
  });
});
