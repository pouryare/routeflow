import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-all-writes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const { POST: createGroup } = await import("@/app/api/admin/groups/route");
const { GET: listGroups } = await import("@/app/api/admin/groups/route");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let founderId = 0;

beforeAll(async () => {
  const db = getDb();
  founderId = Number(
    (await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, token_version, created_at, organization_id) VALUES ('f', 'x:y', 'F', 'platform_owner', 1, 0, '2026-01-01', 1)").run()).lastInsertRowid
  );
  await db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'platform_owner')").run(founderId);
});

const req = (method: string, acting?: number) => {
  const token = createSessionToken({ uid: founderId, role: "platform_owner", gid: null, oid: 1, tv: 0, name: "F", ...(acting ? { ao: acting } : {}) });
  return new NextRequest("http://localhost/api/admin/groups", {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify({ name: "گروه آزمایشی" }) }),
  });
};

describe("a platform_owner with «all companies» selected", () => {
  it("can read", async () => {
    expect((await listGroups(req("GET"))).status).toBe(200);
  });
  it("cannot create or change records: nobody chose the company", async () => {
    const res = await createGroup(req("POST"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("سازمان");
    expect(await getDb().prepare("SELECT 1 FROM groups WHERE name = 'گروه آزمایشی'").get()).toBeUndefined();
  });
  it("can write once a company is chosen, and the record lands in that company", async () => {
    const res = await createGroup(req("POST", 1));
    expect(res.status).toBe(200);
    expect((await getDb().prepare("SELECT organization_id o FROM groups WHERE name = 'گروه آزمایشی'").get() as { o: number }).o).toBe(1);
  });
});
