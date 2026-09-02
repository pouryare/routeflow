import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-reason-codes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { listReasonCodes, createReasonCode, deactivateReasonCode, ReasonCodeError } = await import(
  "@/lib/repo/reasonCodes"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'B', 'b', ?)").run(
    new Date().toISOString()
  );
});

describe("reason_codes", () => {
  it("seeds the system defaults with a NULL organization", () => {
    const rows = getDb()
      .prepare("SELECT domain, code FROM reason_codes WHERE organization_id IS NULL")
      .all() as { domain: string; code: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(rows.find((r) => r.code === "CUSTOMER_ABSENT")?.domain).toBe("delivery_fail");
  });

  it("does not re-seed on a second getDb pass", () => {
    getDb();
    getDb();
    const n = getDb()
      .prepare("SELECT COUNT(*) AS n FROM reason_codes WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(n.n).toBe(13);
  });

  it("lists system defaults plus the tenant's own, filtered by domain", () => {
    createReasonCode(1, { domain: "delivery_fail", code: "LIFT_BROKEN", label_fa: "آسانسور خراب بود" });
    const fails = listReasonCodes(1, "delivery_fail");
    expect(fails.some((r) => r.code === "CUSTOMER_ABSENT")).toBe(true); // system
    expect(fails.some((r) => r.code === "LIFT_BROKEN")).toBe(true); // tenant
    expect(fails.every((r) => r.domain === "delivery_fail")).toBe(true);
  });

  it("keeps one tenant's reason codes out of another's list", () => {
    createReasonCode(2, { domain: "order_cancel", code: "B_ONLY", label_fa: "فقط ب" });
    expect(listReasonCodes(1, "order_cancel").some((r) => r.code === "B_ONLY")).toBe(false);
    expect(listReasonCodes(2, "order_cancel").some((r) => r.code === "B_ONLY")).toBe(true);
    // both still see the shared system defaults
    expect(listReasonCodes(2, "order_cancel").some((r) => r.code === "DUPLICATE")).toBe(true);
  });

  it("refuses a duplicate code in the same domain for the same tenant", () => {
    expect(() =>
      createReasonCode(1, { domain: "delivery_fail", code: "LIFT_BROKEN", label_fa: "دوباره" })
    ).toThrow(ReasonCodeError);
  });

  it("refuses an unknown domain", () => {
    expect(() =>
      // @ts-expect-error deliberately wrong
      createReasonCode(1, { domain: "nonsense", code: "X", label_fa: "y" })
    ).toThrow(ReasonCodeError);
  });

  it("lets a tenant hide its own code but the system rows survive", () => {
    const id = createReasonCode(1, {
      domain: "order_return",
      code: "TEMP",
      label_fa: "موقت",
    });
    deactivateReasonCode(1, id);
    expect(listReasonCodes(1, "order_return").some((r) => r.code === "TEMP")).toBe(false);
    expect(listReasonCodes(1, "order_return").some((r) => r.code === "WRONG_ITEM")).toBe(true);
  });
});
