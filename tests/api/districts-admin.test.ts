import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-districts-admin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { DELETE: deleteDistrict } = await import("@/app/api/districts/[id]/route");
const { PATCH: patchBulk } = await import("@/app/api/districts/bulk/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let ownerId = 0, ownGroup = 0, foreignGroup = 0, ownDistrict = 0, foreignDistrict = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO organizations (id, name, slug, active, created_at) VALUES (2, 'other', 'other', 1, ?) ON CONFLICT DO NOTHING").run(now);
  const g = db.prepare("INSERT INTO groups (name, slug, active, created_at, organization_id) VALUES (?, ?, 1, ?, ?)");
  ownGroup = Number((await g.run("own", "own", now, 1)).lastInsertRowid);
  foreignGroup = Number((await g.run("foreign", "foreign", now, 2)).lastInsertRowid);
  ownerId = Number(
    (await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('o', 'x:y', 'o', 'owner', 1, ?, 1)").run(now)).lastInsertRowid
  );
  const d = db.prepare("INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, group_id, updated_at) VALUES (?, 'mahalle', '', '{}', 'unknown', 1, ?, ?)");
  ownDistrict = Number((await d.run("mine", ownGroup, now)).lastInsertRowid);
  foreignDistrict = Number((await d.run("theirs", foreignGroup, now)).lastInsertRowid);
});

type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
function as(url: string, init: ReqInit = {}) {
  const token = createSessionToken({ uid: ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "t" });
  return new NextRequest(url, { ...init, headers: { ...(init.headers ?? {}), "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` } });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const exists = async (id: number) => !!await getDb().prepare("SELECT 1 FROM districts WHERE id = ?").get(id);

describe("DELETE /api/districts/[id]", () => {
  it("does not delete another company's custom district", async () => {
    const res = await deleteDistrict(as(`http://localhost/api/districts/${foreignDistrict}`, { method: "DELETE" }), ctx(foreignDistrict));
    expect(res.status).toBe(404);
    expect(await exists(foreignDistrict)).toBe(true);
  });
  it("deletes the caller's own custom district", async () => {
    const res = await deleteDistrict(as(`http://localhost/api/districts/${ownDistrict}`, { method: "DELETE" }), ctx(ownDistrict));
    expect(res.status).toBe(200);
    expect(await exists(ownDistrict)).toBe(false);
  });
});

describe("PATCH /api/districts/bulk", () => {
  it("refuses to hand territory to another company's group", async () => {
    const d = Number((await getDb().prepare("INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, group_id, updated_at) VALUES ('free', 'mahalle', '', '{}', 'unknown', NULL, ?)").run(new Date().toISOString())).lastInsertRowid);
    const res = await patchBulk(as("http://localhost/api/districts/bulk", { method: "PATCH", body: JSON.stringify({ ids: [d], group_id: foreignGroup }) }));
    expect(res.status).toBe(400);
    expect((await getDb().prepare("SELECT group_id FROM districts WHERE id = ?").get(d) as { group_id: number | null }).group_id).toBeNull();
  });
});
