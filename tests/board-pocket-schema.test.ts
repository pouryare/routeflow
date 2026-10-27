import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-board-pocket-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("board & pocket schema", () => {
  it("tasks has nullable stage + started_at columns", async () => {
    const cols = await tableInfo("tasks") as { name: string; notnull: number }[];
    for (const name of ["stage", "started_at"]) {
      const c = cols.find((x) => x.name === name);
      expect(c, name).toBeTruthy();
      expect(c!.notnull, name).toBe(0);
    }
  });

  it("users has a nullable prefs_json column", async () => {
    const cols = await tableInfo("users") as { name: string }[];
    expect(cols.some((c) => c.name === "prefs_json")).toBe(true);
  });

  it("task_recurrences is registered as a tenant table", () => {
    expect((TENANT_TABLES as readonly string[]).includes("task_recurrences")).toBe(true);
  });

  it("rejects a bad priority on task_recurrences", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await expect((async () =>
      await db
        .prepare(
          "INSERT INTO task_recurrences (organization_id,title,kind,priority,rrule,created_at,updated_at) VALUES (1,'x','admin','WHENEVER','daily',?,?)"
        )
        .run(now, now))()).rejects.toThrow();
  });

});
