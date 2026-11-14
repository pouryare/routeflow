import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-export-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.ROUTEFLOW_WORKER = "off";

const { getDb } = await import("@/lib/db");
const ex = await import("@/lib/repo/exportJobs");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("E7 background export", () => {
  it("builds the file off the request, keeps it for a day, tells the person, and hides it from other companies", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ex-o','x:y','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const other = Number((await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES ('دیگر','ex-other','2026-01-01')").run()).lastInsertRowid);
    const id = await ex.createExportJob({ organizationId: 1, userId: user, kind: "orders", scope: { sql: " AND o.organization_id = ?", params: [1] }, total: 0 });
    for (let i = 0; i < 50 && (await ex.getExportJob(1, id))?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    expect((await ex.getExportJob(1, id))?.status).toBe("done");
    const f = await ex.exportFile(1, id);
    expect(f!.file.subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip
    expect(f!.filename).toMatch(/^orders-\d{4}-\d\d-\d\d\.xlsx$/);
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND group_key = ?").get(user, `export:${id}`)) as { n: number };
    expect(Number(n.n)).toBe(1);
    expect(await ex.getExportJob(other, id)).toBeUndefined();
    expect(await ex.exportFile(other, id)).toBeUndefined();
    await ex.runExportJob(id); // a second run does nothing
    expect(await ex.purgeExpiredExports(new Date(Date.now() + 23 * 3_600_000))).toBe(0);
    expect(await ex.purgeExpiredExports(new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect(await ex.getExportJob(1, id)).toBeUndefined();
  });
});
