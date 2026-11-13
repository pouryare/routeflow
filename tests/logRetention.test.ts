import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-retention-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { retentionPreview, purgeLogs, setKeepDays } = await import("@/lib/repo/logRetention");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("FB41 log retention", () => {
  it("previews what the purge deletes, then deletes exactly that; in-use sync rows stay", async () => {
    const db = getDb();
    const uid = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ret','x','r','owner',1,'2026-01-01T00:00:00.000Z',1)").run()).lastInsertRowid);
    const now = new Date("2026-11-13T00:00:00.000Z");
    const old = "2026-01-01T00:00:00.000Z";
    const fresh = "2026-11-10T00:00:00.000Z";
    for (const t of [old, old, fresh]) {
      await db.prepare("INSERT INTO login_events (organization_id,user_id,result,created_at) VALUES (1,?,'success',?)").run(uid, t);
    }
    const preview = await retentionPreview(now);
    expect(preview.find((r) => r.id === "login_events")).toMatchObject({ days: 90, rows: 2 });

    expect(await setKeepDays("login_events", 3)).toBe(false); // below the minimum
    expect(await setKeepDays("nope", 30)).toBe(false);
    expect(await setKeepDays("login_events", 365)).toBe(true);
    expect((await retentionPreview(now)).find((r) => r.id === "login_events")!.rows).toBe(0);
    expect(await setKeepDays("login_events", 90)).toBe(true);

    const out = await purgeLogs(now);
    expect(out.login_events).toBe(2);
    const left = (await db.prepare("SELECT count(*) AS n FROM login_events WHERE user_id = ?").get(uid)) as { n: string | number };
    expect(Number(left.n)).toBe(1);
  });
});
