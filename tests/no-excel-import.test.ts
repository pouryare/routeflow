import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-noexcel-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("the Excel customer-import subsystem stays removed", () => {
  it("has no importExcel / oneDriveFetch / /api/import references", () => {
    const hits = execSync(
      "grep -rln 'importExcel\\|oneDriveFetch\\|importCustomersFromWorkbook\\|/api/import\\|ONEDRIVE_SALES_FILE_URL' app lib components || true",
      { encoding: "utf8" }
    ).trim();
    expect(hits, `still referenced in:\n${hits}`).toBe("");
  });

  it("has no import_log / import_snapshots tables after migration", () => {
    const rows = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('import_log','import_snapshots')"
      )
      .all();
    expect(rows).toEqual([]);
  });

  it("has no delivery-parse subsystem", () => {
    const hits = execSync(
      "grep -rln 'deliveryParse\\|DeliveryImportPanel\\|/api/deliveries/parse' app lib components || true",
      { encoding: "utf8" }
    ).trim();
    expect(hits, `still referenced in:\n${hits}`).toBe("");
  });
});
