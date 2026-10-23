import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const SCRIPT = path.join(process.cwd(), "scripts", "backup.mjs");

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, encoding: "utf8" });
}

describe("scripts/backup.mjs", () => {
  it("snapshots a WAL database, checks it and writes an ok status file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-backup-"));
    const db = new DatabaseSync(path.join(dir, "live.db"));
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1), (2);");
    fs.mkdirSync(path.join(dir, "photos"));
    fs.writeFileSync(path.join(dir, "photos", "a.txt"), "x");

    const r = run({ ROUTEFLOW_DB_PATH: path.join(dir, "live.db"), COVERAGE_BACKUP_DIR: path.join(dir, "out"), ROUTEFLOW_PHOTOS_DIR: path.join(dir, "photos") });
    db.close();
    expect(r.status).toBe(0);
    const status = JSON.parse(fs.readFileSync(path.join(dir, "out", "backup-status.json"), "utf8"));
    expect(status.ok).toBe(true);
    expect(status.database.check).toBe("ok");
    expect(status.photos.check).toBe("ok");

    // The snapshot is a real copy, rows and all, even though the rows were still in the WAL.
    const copy = new DatabaseSync(path.join(dir, "out", status.database.file), { readOnly: true });
    expect((copy.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n).toBe(2);
    copy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records a failure and exits non-zero when there is nothing to back up", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-backup-"));
    const r = run({ ROUTEFLOW_DB_PATH: path.join(dir, "missing.db"), COVERAGE_BACKUP_DIR: path.join(dir, "out"), ROUTEFLOW_PHOTOS_DIR: path.join(dir, "none") });
    expect(r.status).toBe(1);
    const status = JSON.parse(fs.readFileSync(path.join(dir, "out", "backup-status.json"), "utf8"));
    expect(status.ok).toBe(false);
    expect(status.error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
