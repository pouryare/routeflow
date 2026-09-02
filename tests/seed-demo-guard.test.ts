import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO = path.resolve(__dirname, "..");
const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-seedguard-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(() => {
  const db = getDb();
  db.exec(
    "INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES ('seed-owner','x','م','owner',1,1,'2026-01-01')"
  );
  const c = db.prepare(
    "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active','2026-01-01',1)"
  );
  for (let i = 1; i <= 14; i++) c.run(`SEED-C${i}`, `مشتری ${i}`);
});

function runSeed(args: string[], nodeEnv: "test" | "production" = "test") {
  return execFileSync("node", ["scripts/seed-demo.mjs", ...args], {
    cwd: REPO,
    env: { ...process.env, COVERAGE_DB_PATH: testDbPath, NODE_ENV: nodeEnv },
    stdio: "pipe",
  });
}

const n = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;

describe("seed-demo guard", () => {
  it("refuses to seed a production DB without --force", () => {
    expect(() => runSeed([], "production")).toThrow();
    expect(n("SELECT COUNT(*) n FROM products WHERE sku LIKE 'DEMO-%'")).toBe(0);
  });

  it("seeds a demo representative and --remove clears every marked row without touching real ones", () => {
    runSeed([]);
    expect(n("SELECT COUNT(*) n FROM products WHERE sku LIKE 'DEMO-%'")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) n FROM representative_profiles WHERE rep_code LIKE 'DEMO-%'")).toBe(1);
    expect(n("SELECT COUNT(*) n FROM representative_onboarding_steps")).toBeGreaterThan(0);
    // The enrichment rows: Board/Pocket tasks, monthly targets, cheques, complaints.
    expect(n("SELECT COUNT(*) n FROM tasks")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) n FROM task_recurrences")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) n FROM targets")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) n FROM cheques WHERE cheque_no LIKE 'DEMO-CHK-%'")).toBeGreaterThan(0);
    // A reseed onto the now-populated DB must not throw or double up the tasks.
    const tasksAfterFirst = n("SELECT COUNT(*) n FROM tasks");
    runSeed([]);
    expect(n("SELECT COUNT(*) n FROM tasks")).toBe(tasksAfterFirst);

    // A real rep + its real customer that --remove must leave alone.
    const db = getDb();
    const realCust = Number(
      db
        .prepare(
          "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('REAL-1','واقعی','WHOLESALE','active','2026-01-01',1)"
        )
        .run().lastInsertRowid
    );
    db.prepare(
      "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (1,?,'REAL-REP','active',0,'2026-01-01','2026-01-01')"
    ).run(realCust);

    runSeed(["--remove"]);

    expect(n("SELECT COUNT(*) n FROM products WHERE sku LIKE 'DEMO-%'")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM users WHERE username LIKE 'demo.%'")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM representative_profiles WHERE rep_code LIKE 'DEMO-%'")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM representative_onboarding_steps")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM representative_profiles WHERE rep_code = 'REAL-REP'")).toBe(1);
    // Enrichment rows gone too, and nothing left dangling.
    expect(n("SELECT COUNT(*) n FROM tasks")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM task_recurrences")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM targets")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM cheques WHERE cheque_no LIKE 'DEMO-CHK-%'")).toBe(0);
    expect(getDb().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
