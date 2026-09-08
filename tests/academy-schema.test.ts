import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-academy-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("academy schema", () => {
  it("creates objection_cards and lesson_progress, tenant-scoped", () => {
    const db = getDb();
    for (const t of ["objection_cards", "lesson_progress"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toBeTruthy();
      expect((TENANT_TABLES as readonly string[]).includes(t), t).toBe(true);
    }
  });

  it("seeds eight NULL-org starter cards, once", () => {
    const n = () =>
      (getDb().prepare("SELECT COUNT(*) n FROM objection_cards WHERE organization_id IS NULL").get() as { n: number }).n;
    expect(n()).toBe(8);
    getDb();
    getDb();
    expect(n()).toBe(8);
    expect(
      (getDb().prepare("SELECT outcome_code FROM objection_cards WHERE organization_id IS NULL AND outcome_code='PRICE_OBJECTION'").get() as { outcome_code: string }).outcome_code
    ).toBe("PRICE_OBJECTION");
  });

  it("lesson_progress is unique per (org, user, lesson)", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const uid = Number(
      db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('lp','x','م','salesperson',?,1)").run(now).lastInsertRowid
    );
    const ins = db.prepare("INSERT INTO lesson_progress (organization_id,user_id,lesson_slug,completed_at) VALUES (1,?,'01-market-and-customer',?)");
    expect(() => ins.run(uid, now)).not.toThrow();
    expect(() => ins.run(uid, now)).toThrow();
  });

  it("has the MDX skeleton + manifest on disk", () => {
    const root = path.join(process.cwd(), "content", "academy");
    expect(fs.existsSync(path.join(root, "_manifest.json"))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "_manifest.json"), "utf8"));
    expect(manifest).toHaveLength(2);
    expect(manifest.every((m: { status: string }) => m.status === "stub")).toBe(true);
    expect(fs.existsSync(path.join(root, "01-market-and-customer", "index.mdx"))).toBe(true);
  });
});
