import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("notification schema", () => {
  it("seeds the NULL-org catalogue and every seed row has a valid shape", () => {
    const db = getDb();
    const rows = db
      .prepare("SELECT code, directedness, priority, group_scope FROM notification_types WHERE organization_id IS NULL")
      .all() as { code: string; directedness: string; priority: string; group_scope: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.map((r) => r.code)).toContain("task.assigned");
    for (const r of rows) {
      expect(["directed", "ambient"]).toContain(r.directedness);
      expect(["CRITICAL", "HIGH", "NORMAL", "LOW"]).toContain(r.priority);
      expect(["entity", "type_day"]).toContain(r.group_scope);
    }
  });

  it("re-running seedNotificationTypes does not duplicate rows", async () => {
    const { seedNotificationTypes } = await import("@/lib/db");
    const db = getDb();
    seedNotificationTypes(db);
    seedNotificationTypes(db);
    const n = (db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    const distinct = (db.prepare("SELECT COUNT(DISTINCT code) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    expect(n).toBe(distinct);
  });
});
