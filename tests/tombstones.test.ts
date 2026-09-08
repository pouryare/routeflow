import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-tombstones-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { tombstone, tombstonesSince } = await import("@/lib/repo/tombstones");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM deleted_rows");
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
});

describe("tombstones", () => {
  it("records a deletion and reads it back", () => {
    tombstone(1, "order_line", 55);
    const rows = tombstonesSince(1, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: "order_line", entity_id: 55 });
  });

  it("excludes tombstones at or before the watermark", async () => {
    tombstone(1, "order_line", 1);
    const mid = new Date(Date.now() + 5).toISOString();
    await new Promise((r) => setTimeout(r, 10));
    tombstone(1, "order_line", 2);
    const after = tombstonesSince(1, mid);
    expect(after.map((t) => t.entity_id)).toEqual([2]);
  });

  it("does not cross tenants", () => {
    tombstone(2, "customer", 9);
    expect(tombstonesSince(1, null)).toEqual([]);
    expect(tombstonesSince(2, null).map((t) => t.entity_id)).toEqual([9]);
  });
});
