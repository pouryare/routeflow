import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-dcode-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = () => (getDb().prepare("PRAGMA table_info(districts)").all() as { name: string }[]).map((c) => c.name);
const geo = JSON.stringify({ type: "Polygon", coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]] });
const NOW = new Date().toISOString();
const ins = (name: string, isCustom = 0, code: string | null = null) =>
  getDb()
    .prepare(
      `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
       VALUES (?, 'mahalle', '', ?, ?, 'unknown', ?, ?)`
    )
    .run(name, geo, code, isCustom, NOW);

/** A code a rep can say out loud, and a natural key for a place.
 *
 *  code is PARTIAL-unique, not unique, because a hand-drawn district has none until an
 *  operator assigns one and a hard UNIQUE would fail the moment two of them sat blank --
 *  which is the state a freshly drawn district is in by definition. */
describe("district code columns", () => {
  it("adds code and parent_no", () => {
    expect(cols()).toEqual(expect.arrayContaining(["code", "parent_no"]));
  });

  it("lets two uncoded districts coexist", () => {
    ins("custom a", 1);
    ins("custom b", 1);
    const n = (getDb().prepare("SELECT COUNT(*) c FROM districts WHERE code IS NULL").get() as { c: number }).c;
    expect(n).toBe(2);
  });

  it("rejects two districts claiming the same code", () => {
    ins("a", 0, "P1");
    expect(() => ins("b", 0, "P1")).toThrow();
  });

  it("accepts the same code again once the first row goes", () => {
    // A code freed by a deleted district is available again. That is why the index is on
    // code alone and not on (name, code): the name uniqueness is a separate constraint.
    getDb().prepare("DELETE FROM districts WHERE code = 'P1'").run();
    expect(() => ins("c", 0, "P1")).not.toThrow();
  });

  it("indexes code so the search prefix query is not a table scan", () => {
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'districts'")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("ix_districts_code");
  });
});
