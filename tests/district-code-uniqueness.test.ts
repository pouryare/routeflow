import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { indexesOn, tableInfo } from "./helpers/schema";

const testDbPath = path.join(os.tmpdir(), `rf-dcode-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = async () => (await tableInfo("districts") as { name: string }[]).map((c) => c.name);
const geo = JSON.stringify({ type: "Polygon", coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]] });
const NOW = new Date().toISOString();
const ins = async (name: string, isCustom = 0, code: string | null = null) =>
  await getDb()
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
  it("adds code and parent_no", async () => {
    expect(await cols()).toEqual(expect.arrayContaining(["code", "parent_no"]));
  });

  it("lets two uncoded districts coexist", async () => {
    await ins("custom a", 1);
    await ins("custom b", 1);
    const n = (await getDb().prepare("SELECT COUNT(*) c FROM districts WHERE code IS NULL").get() as { c: number }).c;
    expect(n).toBe(2);
  });

  it("rejects two districts claiming the same code", async () => {
    await ins("a", 0, "P1");
    await expect((async () => await ins("b", 0, "P1"))()).rejects.toThrow();
  });

  it("accepts the same code again once the first row goes", async () => {
    // A code freed by a deleted district is available again. That is why the index is on
    // code alone and not on (name, code): the name uniqueness is a separate constraint.
    await getDb().prepare("DELETE FROM districts WHERE code = 'P1'").run();
    await (async () => await ins("c", 0, "P1"))();
  });

  it("indexes code so the search prefix query is not a table scan", async () => {
    expect(await indexesOn("districts")).toContain("ix_districts_code");
  });
});
