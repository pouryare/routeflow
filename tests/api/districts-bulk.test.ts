import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { PATCH } = await import("@/app/api/districts/bulk/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

function seedDistrict(status = "unknown") {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, updated_at)
       VALUES (?, 'mahalle', '', ?, ?, NULL, 0, ?)`
    )
    .run(`Test District ${Math.random()}`, JSON.stringify({ type: "Polygon", coordinates: [] }), status, now);
  return Number(result.lastInsertRowid);
}

// The route requires a real session now. These cases are about the bulk-update
// mechanics, not authorisation, so they all run as an owner -- the scoping rules
// themselves are covered in tests/api/scoping.test.ts.
let ownerId = 0;

function bulkReq(body: unknown) {
  const token = createSessionToken({ uid: ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "مالک" });
  return new NextRequest("http://localhost/api/districts/bulk", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` },
  });
}

afterAll(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
});

beforeAll(() => {
  const db = getDb(); // ensure schema is created before any test seeds rows
  ownerId = Number(
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, ?, ?, 'owner', NULL, 1, ?, 1)"
    ).run("bulk-owner", "x:y", "مالک", new Date().toISOString()).lastInsertRowid
  );
});

describe("PATCH /api/districts/bulk", () => {
  it("updates coverage_status for every selected district and logs one activity row each", async () => {
    const id1 = seedDistrict();
    const id2 = seedDistrict();

    const res = await PATCH(bulkReq({ ids: [id1, id2], coverage_status: "visited" }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.updated).toBe(2);

    const db = getDb();
    const rows = db
      .prepare(`SELECT coverage_status FROM districts WHERE id IN (${id1}, ${id2})`)
      .all() as { coverage_status: string }[];
    expect(rows.every((r) => r.coverage_status === "visited")).toBe(true);

    const activity = db.prepare("SELECT * FROM activity_log WHERE entity_id IN (?, ?)").all(id1, id2);
    expect(activity).toHaveLength(2);
  });

  it("does not log activity or change status when the district already has the target status", async () => {
    const id = seedDistrict("visited");
    await PATCH(bulkReq({ ids: [id], coverage_status: "visited" }));
    const db = getDb();
    const activity = db.prepare("SELECT * FROM activity_log WHERE entity_id = ?").all(id);
    expect(activity).toHaveLength(0);
  });

  it("rejects an invalid status", async () => {
    const res = await PATCH(bulkReq({ ids: [1], coverage_status: "not-a-real-status" }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty or non-array id list", async () => {
    expect((await PATCH(bulkReq({ ids: [], coverage_status: "visited" }))).status).toBe(400);
    expect((await PATCH(bulkReq({ ids: "not-an-array", coverage_status: "visited" }))).status).toBe(400);
  });

  it("rejects a request with neither a status nor an assignment change", async () => {
    const res = await PATCH(bulkReq({ ids: [1] }));
    expect(res.status).toBe(400);
  });

  it("skips ids that don't exist, still updating the ones that do", async () => {
    const id = seedDistrict();
    const res = await PATCH(bulkReq({ ids: [id, 999999], coverage_status: "needs_coverage" }));
    const data = await res.json();
    expect(data.updated).toBe(1);
  });

  it("refuses a request that names no change at all", async () => {
    // assigned_to used to be the other thing this route could set. Responsibility for an
    // area is a group's now, so a body carrying only that field changes nothing and must
    // not report success.
    const id = seedDistrict();
    const res = await PATCH(bulkReq({ ids: [id], assigned_to: "Ali" }));
    expect(res.status).toBe(400);
  });
});
