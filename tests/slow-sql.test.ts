import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { instrumentSlowSql, slowSqlThresholdMs } from "@/lib/slowSql";

afterEach(() => vi.restoreAllMocks());

const SLOW = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 300000) SELECT COUNT(*) AS n FROM c";

describe("slow SQL log", () => {
  it("reads the threshold from the environment; off unless it is a positive number", () => {
    expect(slowSqlThresholdMs({})).toBe(0);
    expect(slowSqlThresholdMs({ ROUTEFLOW_SLOW_SQL_MS: "" })).toBe(0);
    expect(slowSqlThresholdMs({ ROUTEFLOW_SLOW_SQL_MS: "abc" })).toBe(0);
    expect(slowSqlThresholdMs({ ROUTEFLOW_SLOW_SQL_MS: "-5" })).toBe(0);
    expect(slowSqlThresholdMs({ ROUTEFLOW_SLOW_SQL_MS: "200" })).toBe(200);
  });

  it("warns once per statement slower than the threshold, with its text and a duration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new DatabaseSync(":memory:");
    instrumentSlowSql(db, 1);
    expect((db.prepare(SLOW).get() as { n: number }).n).toBe(300000);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toMatch(/^\[slow-sql\] \d+ms /);
    expect(line).toContain("WITH RECURSIVE");
  });

  it("stays quiet for a fast statement and still returns the results", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new DatabaseSync(":memory:");
    instrumentSlowSql(db, 10_000);
    db.exec("CREATE TABLE t (a INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(7);
    expect(db.prepare("SELECT a FROM t").all()).toEqual([{ a: 7 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("also times db.exec, which is how migrations and backfills run", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new DatabaseSync(":memory:");
    instrumentSlowSql(db, 1);
    db.exec(`${SLOW};`);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("[slow-sql]");
  });

  it("truncates long statements and collapses whitespace", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new DatabaseSync(":memory:");
    instrumentSlowSql(db, 1);
    db.prepare(`${SLOW.replace(/ /g, "\n   ")} /* ${"x".repeat(1000)} */`).get();
    const line = String(warn.mock.calls[0][0]);
    expect(line.length).toBeLessThan(400);
    expect(line).not.toContain("\n");
  });
});
