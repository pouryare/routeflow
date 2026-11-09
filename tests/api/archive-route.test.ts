import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-archive-route-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
process.env.SWEEP_TOKEN = "t".repeat(32);

const { getDb } = await import("@/lib/db");
const { PUT, POST } = await import("@/app/api/admin/archive/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { archiveHotMonths } = await import("@/lib/repo/historyArchive");

const ids: Record<string, number> = {};
beforeAll(async () => {
  const now = new Date().toISOString();
  for (const role of ["owner", "platform_owner"]) {
    ids[role] = Number((await getDb().prepare(
      "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
    ).run(`${role}${Date.now()}`, "x:y", "م", role, now)).lastInsertRowid);
  }
});

const cookie = (role: string) => `${COOKIE_NAME}=${createSessionToken({ uid: ids[role], role: role as never, gid: null, oid: 1, tv: 0, name: "t" })}`;
const put = (role: string, months: unknown) =>
  PUT(new NextRequest("http://localhost/api/admin/archive", { method: "PUT", headers: { cookie: cookie(role), "content-type": "application/json" }, body: JSON.stringify({ months }) }));

describe("/api/admin/archive", () => {
  it("lets only the platform owner set the months, within 3 to 120", async () => {
    expect((await put("owner", 6)).status).toBe(403);
    expect((await put("platform_owner", 2)).status).toBe(400);
    expect((await put("platform_owner", 6)).status).toBe(200);
    expect(await archiveHotMonths()).toBe(6);
  });

  it("runs the move for the nightly timer's token, and refuses a company owner", async () => {
    const owner = await POST(new NextRequest("http://localhost/api/admin/archive", { method: "POST", headers: { cookie: cookie("owner") } }));
    expect(owner.status).toBe(403);
    const res = await POST(new NextRequest("http://localhost/api/admin/archive", { method: "POST", headers: { "x-sweep-token": "t".repeat(32) } }));
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toHaveProperty("order_events");
  });
});
