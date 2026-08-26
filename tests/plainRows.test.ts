import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-plain-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, plain } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb()
    .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
    .run("C1", "رستوران نمونه", new Date().toISOString());
});

describe("rows straight from node:sqlite", () => {
  it("have a null prototype, which is the whole problem", () => {
    // Documenting the behaviour this helper exists for. React refuses to serialise a
    // null-prototype object across the server/client boundary: "Only plain objects, and
    // a few built-ins, can be passed to Client Components". The page renders a 500 and
    // nothing in the types or the unit tests sees it coming.
    const row = getDb().prepare("SELECT * FROM customers LIMIT 1").get() as object;
    expect(Object.getPrototypeOf(row)).toBeNull();
  });
});

describe("plain", () => {
  it("gives a row an ordinary prototype", () => {
    const rows = getDb().prepare("SELECT * FROM customers").all();
    const [row] = plain(rows);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  it("keeps every value", () => {
    const rows = getDb().prepare("SELECT customer_code, business_name FROM customers").all();
    expect(plain(rows)).toEqual([{ customer_code: "C1", business_name: "رستوران نمونه" }]);
  });

  it("handles an empty result", () => {
    expect(plain([])).toEqual([]);
  });

  it("survives a JSON round trip, which is what serialising actually does", () => {
    const rows = getDb().prepare("SELECT customer_code FROM customers").all();
    expect(JSON.parse(JSON.stringify(plain(rows)))).toEqual([{ customer_code: "C1" }]);
  });
});
