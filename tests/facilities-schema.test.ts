import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-facilities-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

// Dynamic: getDb reads ROUTEFLOW_DB_PATH at module load, so a static import would bind
// the real database rather than this file's.
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("facilities schema", () => {
  it("allows a facility with no location", async () => {
    const db = getDb();
    const info = await db.prepare("PRAGMA table_info(facilities)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(info.find((c) => c.name === "lat")?.notnull).toBe(0);
    expect(info.find((c) => c.name === "lng")?.notnull).toBe(0);
  });

  it("stores a facility whose location is unknown", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO organizations (id, slug, name, created_at) VALUES (9001, 'org-9001', 't', '2026-10-04')").run();
    const id = Number(
      (await db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
           VALUES ('not-placed', 'warehouse', 'هنوز نامشخص', NULL, NULL, 0, 9001, '2026-10-04', '2026-10-04')`
        )
        .run()).lastInsertRowid
    );
    expect(await db.prepare("SELECT lat, lng FROM facilities WHERE id = ?").get(id)).toEqual({
      lat: null,
      lng: null,
    });
  });

  it("keeps NOT NULL off all three DDL copies in lib/db.ts", () => {
    // facilities_van_new, facilities, and facilities_tn_new. The last one is the trap:
    // it re-creates the table on every tenant bootstrap, so a NOT NULL there puts the
    // constraint back for anyone whose data survives the rebuild. Changing only the
    // newest copy would look correct and then fail on a fresh tenant.
    const src = fs.readFileSync(path.join(process.cwd(), "lib/db.ts"), "utf8");
    expect(src.match(/lat REAL NOT NULL/g) ?? []).toHaveLength(0);
  });

  it("still refuses a facility with no name", async () => {
    // Nullable lat must not have relaxed anything else. This asserts the actual NOT NULL --
    // a missing name -- and NOT that an empty one is rejected, because the schema never said
    // that. Emptiness is the API's business (it trims and refuses), not the table's, and a
    // test asserting it here would be asserting something the column does not promise.
    const db = getDb();
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, created_at) VALUES (9004, 'org-9004', 't', '2026-10-04')"
    ).run();
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
           VALUES ('nameless', 'warehouse', NULL, NULL, NULL, 0, 9004, '2026-10-04', '2026-10-04')`
        )
        .run())()).rejects.toThrow();
  });

  it("accepts all nine kinds, including van", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO organizations (id, slug, name, created_at) VALUES (9005, 'org-9005', 't', '2026-10-04')").run();
    const { FACILITY_KINDS } = await import("@/lib/facilityTypes");
    expect(FACILITY_KINDS).toHaveLength(9);
    for (const kind of FACILITY_KINDS) {
      const id = Number(
        (await db
          .prepare(
            `INSERT INTO facilities (slug, kind, name, icon_key, lat, lng, is_default_origin, organization_id, created_at, updated_at)
             VALUES (?, ?, ?, NULL, NULL, NULL, 0, 9005, '2026-10-04', '2026-10-04')`
          )
          .run(`k-${kind}`, kind, kind)).lastInsertRowid
      );
      expect(id).toBeGreaterThan(0);
    }
  });

  it("stores the icon a person chose, independent of the kind", async () => {
    // Two warehouses can wear different shapes. That is the whole point of icon_key: the
    // kind narrows the field, the person picks within it.
    const db = getDb();
    await db.prepare("INSERT INTO organizations (id, slug, name, created_at) VALUES (9006, 'org-9006', 't', '2026-10-04')").run();
    await db.prepare(
      `INSERT INTO facilities (slug, kind, name, icon_key, lat, lng, is_default_origin, organization_id, created_at, updated_at)
       VALUES ('wh-silo', 'warehouse', 'انبار سیلویی', 'silo', 35.5, 51.7, 0, 9006, '2026-10-04', '2026-10-04')`
    ).run();
    const row = await db
      .prepare("SELECT kind, icon_key FROM facilities WHERE slug = 'wh-silo'")
      .get() as { kind: string; icon_key: string };
    expect(row).toEqual({ kind: "warehouse", icon_key: "silo" });
  });

  });