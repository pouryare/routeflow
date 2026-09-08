import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sync-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
});

function cols(t: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
}

describe("offline-first schema", () => {
  it("adds client_uuid + a partial unique index to every offline-writable table", () => {
    const db = getDb();
    for (const t of ["orders", "payments", "deliveries", "customers"]) {
      expect(cols(t), t).toContain("client_uuid");
      const idx = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name = ?")
        .get(`ix_${t}_client_uuid`) as { sql: string } | undefined;
      expect(idx?.sql ?? "", t).toContain("UNIQUE INDEX");
      expect(idx?.sql ?? "", t).toContain("WHERE client_uuid IS NOT NULL");
    }
  });

  it("creates sync_mutations and deleted_rows", () => {
    const db = getDb();
    for (const t of ["sync_mutations", "deleted_rows"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
      expect((TENANT_TABLES as readonly string[]).includes(t)).toBe(true);
    }
  });

  it("rejects an unknown sync_mutations status", () => {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO sync_mutations (organization_id, client_uuid, op, payload_json, occurred_at, received_at, status) VALUES (1,'x','y','{}',?,?,'weird')"
        )
        .run(new Date().toISOString(), new Date().toISOString())
    ).toThrow();
  });

  it("keeps (organization_id, client_uuid) unique per tenant but shareable across tenants", () => {
    const db = getDb();
    const ins = db.prepare(
      "INSERT INTO sync_mutations (organization_id, client_uuid, op, payload_json, occurred_at, received_at) VALUES (?, 'SHARED', 'payment.record', '{}', ?, ?)"
    );
    const now = new Date().toISOString();
    expect(() => ins.run(1, now, now)).not.toThrow();
    expect(() => ins.run(2, now, now)).not.toThrow(); // other org, same uuid: fine
    expect(() => ins.run(1, now, now)).toThrow(); // same org, same uuid: refused
  });

  it("leaves the client_uuid partial index tolerant of many NULLs", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const c1 = Number(
      db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES ('n1','a',?,1)").run(now).lastInsertRowid
    );
    const c2 = Number(
      db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES ('n2','b',?,1)").run(now).lastInsertRowid
    );
    expect(c1).not.toBe(c2); // both NULL client_uuid, both inserted
  });
});
