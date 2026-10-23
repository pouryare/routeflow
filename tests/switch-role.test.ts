import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-switch-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setRoles } = await import("@/lib/repo/userRoles");
const { createSessionToken, COOKIE_NAME, parseSessionToken } = await import("@/lib/auth");
const { POST } = await import("@/app/api/me/role/route");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/* Fixtures learned in A-Task 3: organizations.slug is UNIQUE so it must vary per org, and
 * `groups` has no organization_id column. */
async function mkUser(username: string, primary: string, roles: string[], org = 8): Promise<number> {
  const db = getDb();
  await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (${org},'O-${org}','o-${org}','2026-01-01') ON CONFLICT DO NOTHING`);
  await db.exec(
    `INSERT INTO groups (id,name,slug,color,active,created_at) VALUES (${100 + org},'G','g${org}','#000000',1,'2026-01-01') ON CONFLICT DO NOTHING`
  );
  await db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, ?, ?, 1, 0, '2026-01-01')`
  ).run(username, username, primary, 100 + org, org);
  const id = (await db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  await setRoles(id, roles as never);
  return id;
}

const req = (uid: number, active: string, body: unknown, org = 8) =>
  new NextRequest("http://localhost/api/me/role", {
    method: "POST",
    headers: { cookie: `${COOKIE_NAME}=${createSessionToken({ uid, role: active as never, gid: 100 + org, oid: org, tv: 0, name: "t" })}` },
    body: JSON.stringify(body),
  });

describe("switching role", () => {
  it("refuses a role the person does not hold", async () => {
    const id = await mkUser("r1", "phone_sales", ["phone_sales"]);
    const res = await POST(req(id, "phone_sales", { role: "field_rep" }) as never);
    expect(res.status).toBe(403);
  });

  it("accepts a role they do hold, and re-issues the cookie", async () => {
    const id = await mkUser("r2", "delivery_driver", ["field_rep", "delivery_driver"]);
    const res = await POST(req(id, "field_rep", { role: "delivery_driver" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(COOKIE_NAME);
  });

  it("the re-issued cookie really carries the new role as its claim", async () => {
    // The status code alone proves nothing — the whole point is that proxy.ts, which cannot
    // reach the database, reads the CLAIM. Assert the claim itself.
    const id = await mkUser("r2b", "delivery_driver", ["field_rep", "delivery_driver"]);
    const res = await POST(req(id, "field_rep", { role: "delivery_driver" }) as never);
    const cookie = res.headers.get("set-cookie")!;
    const token = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    expect(parseSessionToken(token)?.role).toBe("delivery_driver");
  });

  it("does not log the person out — token_version is untouched", async () => {
    const id = await mkUser("r3", "delivery_driver", ["field_rep", "delivery_driver"]);
    const before = (await getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(id) as { token_version: number }).token_version;
    await POST(req(id, "field_rep", { role: "delivery_driver" }) as never);
    const after = (await getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(id) as { token_version: number }).token_version;
    expect(after).toBe(before);
  });

  it("rejects a name that is not a role at all", async () => {
    // The set is checked, so this would 403 anyway — but an unknown string should be a 400,
    // because "you may not have that" and "that is not a thing" are different answers.
    const id = await mkUser("r4", "phone_sales", ["phone_sales"]);
    const res = await POST(req(id, "phone_sales", { role: "superuser" }) as never);
    expect(res.status).toBe(400);
  });

  it("preserves the act claim, so an owner's Login-As survives a role switch", async () => {
    // Phase A §5.0: while impersonating, the banner must keep attributing actions to the
    // target. Dropping `act` would silently end the impersonation mid-session and hand the
    // impersonated user's browser the owner's own permissions on the next refresh.
    const db = getDb();
    const owner = await mkUser("impowner", "owner", ["owner"], 12);
    const target = await mkUser("imptarget", "delivery_driver", ["field_rep", "delivery_driver"], 12);
    const withAct = createSessionToken({
      uid: target, role: "field_rep", gid: 112, oid: 12, tv: 0, name: "t", act: owner,
    });
    const res = await POST(
      new NextRequest("http://localhost/api/me/role", {
        method: "POST",
        headers: { cookie: `${COOKIE_NAME}=${withAct}` },
        body: JSON.stringify({ role: "delivery_driver" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const token = decodeURIComponent(res.headers.get("set-cookie")!.split(";")[0].split("=").slice(1).join("="));
    expect(parseSessionToken(token)?.act).toBe(owner);
    void db;
  });

  it("requires a session", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/me/role", {
        method: "POST",
        body: JSON.stringify({ role: "owner" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });
});
