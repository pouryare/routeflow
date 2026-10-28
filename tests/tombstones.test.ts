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
const { tombstone, tombstonesSinceXid } = await import("@/lib/repo/tombstones");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM deleted_rows");
  await db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?) ON CONFLICT DO NOTHING").run(
    new Date().toISOString()
  );
});

describe("tombstones", () => {
  it("records a deletion and reads it back", async () => {
    await tombstone(1, "order_line", 55);
    const rows = await tombstonesSinceXid(1, "0");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: "order_line", entity_id: 55 });
  });

  it("excludes tombstones written before the watermark", async () => {
    await tombstone(1, "order_line", 1);
    // One past the first tombstone's own transaction: a fixed bound, unlike the xmin pullSince
    // hands out, which other files' open transactions hold back.
    const { x } = (await getDb().prepare("SELECT CAST(CAST(sync_xid AS text) AS bigint) + 1 AS x FROM deleted_rows WHERE entity_id = 1").get()) as { x: number };
    await tombstone(1, "order_line", 2);
    const after = await tombstonesSinceXid(1, String(x));
    expect(after.map((t) => t.entity_id)).toEqual([2]);
  });

  it("does not cross tenants", async () => {
    await tombstone(2, "customer", 9);
    expect(await tombstonesSinceXid(1, "0")).toEqual([]);
    expect((await tombstonesSinceXid(2, "0")).map((t) => t.entity_id)).toEqual([9]);
  });
});
