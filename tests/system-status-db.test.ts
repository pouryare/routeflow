import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-status-"));
process.env.ROUTEFLOW_DB_PATH = path.join(dir, "t.db");
process.env.COVERAGE_BACKUP_DIR = path.join(dir, "backups");
process.env.SESSION_SECRET = "test-secret";
const { statusFacts, readBackupStatus } = await import("@/lib/repo/systemStatus");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("statusFacts", () => {
  it("reads every fact without error on an empty database", () => {
    const f = statusFacts(1);
    expect(f.backup).toBeNull();
    expect(f.failedSignIns24h).toBe(0);
    expect(f.dbBytes).toBeGreaterThan(0);
  });

  it("reads the backup script's status file", () => {
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "backups", "backup-status.json"),
      JSON.stringify({ ok: true, finishedAt: "2026-10-23T01:00:00.000Z", database: null, photos: null, error: null })
    );
    expect(readBackupStatus()?.ok).toBe(true);
  });
});
