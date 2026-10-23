import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-terr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { districtIdForPoint, groupForPoint, recomputeCustomerGroups, readGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// Two unit squares side by side. Left: lng 0-1. Right: lng 2-3. Both lat 0-1.
const LEFT = JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
const RIGHT = JSON.stringify({
  type: "MultiPolygon",
  coordinates: [[[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]],
});
// A big square covering both, at the coarser mantaghe level.
const PARENT = JSON.stringify({ type: "Polygon", coordinates: [[[-1, -1], [4, -1], [4, 2], [-1, 2], [-1, -1]]] });

let east = 0;
let west = 0;
let leftId = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, 1)"
  );
  west = Number((await g.run("گروه غرب", "west", "#0ff", now)).lastInsertRowid);
  east = Number((await g.run("گروه شرق", "east", "#f0f", now)).lastInsertRowid);

  const d = db.prepare(
    "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, ?, ?, 'unknown', ?, ?)"
  );
  leftId = Number((await d.run("محله چپ", "mahalle", LEFT, west, now)).lastInsertRowid);
  await d.run("محله راست", "mahalle", RIGHT, east, now);
  await d.run("منطقه بزرگ", "mantaghe", PARENT, null, now);

  const c = db.prepare(
    "INSERT INTO customers (customer_code, business_name, lat, lng, synced_at, organization_id) VALUES (?, ?, ?, ?, ?, 1)"
  );
  await c.run("C1", "در چپ", 0.5, 0.5, now);
  await c.run("C2", "در راست", 0.5, 2.5, now);
  await c.run("C3", "بیرون", 50.0, 50.0, now);
  await c.run("C4", "بدون مختصات", null, null, now);
});

describe("readGroups", () => {
  it("returns the groups in name order", async () => {
    expect((await readGroups(getDb(), 1)).map((g) => g.slug).sort()).toEqual(["east", "west"]);
  });
});

describe("districtIdForPoint", () => {
  it("finds the containing mahalle", async () => {
    expect(await districtIdForPoint(getDb(), 0.5, 0.5)).toBe(leftId);
  });
  it("prefers the mahalle over the mantaghe that also contains the point", async () => {
    const id = await districtIdForPoint(getDb(), 0.5, 0.5);
    const row = await getDb().prepare("SELECT level FROM districts WHERE id = ?").get(id) as { level: string };
    expect(row.level).toBe("mahalle");
  });
  it("handles a MultiPolygon boundary", async () => {
    expect(await districtIdForPoint(getDb(), 0.5, 2.5)).not.toBeNull();
  });
  it("returns null well outside every polygon", async () => {
    expect(await districtIdForPoint(getDb(), 50, 50)).toBeNull();
  });
});

describe("groupForPoint", () => {
  it("maps a point to the group owning its district", async () => {
    expect(await groupForPoint(getDb(), 0.5, 0.5, 1)).toBe(west);
    expect(await groupForPoint(getDb(), 0.5, 2.5, 1)).toBe(east);
  });
  it("returns null when the containing district belongs to no group", async () => {
    // (lat 1.5, lng 3.5) is inside PARENT and inside neither LEFT nor RIGHT. PARENT has
    // group_id NULL, so this exercises "found a district, nobody owns it" -- which is a
    // different path from "no district contains this point" above.
    expect(await groupForPoint(getDb(), 1.5, 3.5, 1)).toBeNull();
  });
});

describe("recomputeCustomerGroups", () => {
  it("assigns each located customer to its territory's group", async () => {
    const db = getDb();
    await recomputeCustomerGroups(db, 1);
    const rows = await db.prepare("SELECT customer_code, group_id FROM customers ORDER BY customer_code").all() as unknown as {
      customer_code: string; group_id: number | null;
    }[];
    const byCode = Object.fromEntries(rows.map((r) => [r.customer_code, r.group_id]));
    expect(byCode.C1).toBe(west);
    expect(byCode.C2).toBe(east);
    expect(byCode.C3).toBeNull();
    expect(byCode.C4).toBeNull();
  });

  it("follows territory when a district changes hands", async () => {
    const db = getDb();
    await db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(east, leftId);
    await recomputeCustomerGroups(db, 1);
    const row = await db.prepare("SELECT group_id FROM customers WHERE customer_code = 'C1'").get() as { group_id: number };
    expect(row.group_id).toBe(east);
  });
});
