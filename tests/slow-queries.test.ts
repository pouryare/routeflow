import { describe, expect, it } from "vitest";
import { isAppQuery, readableMs, shortSql } from "@/lib/slowQueries";

describe("slow queries card", () => {
  it("leaves out the adapter's housekeeping and its own read", () => {
    expect(isAppQuery("SAVEPOINT rf_stmt")).toBe(false);
    expect(isAppQuery("RELEASE SAVEPOINT rf_stmt; SAVEPOINT rf_stmt")).toBe(false);
    expect(isAppQuery("SELECT set_config('rf.scope', $1, false)")).toBe(false);
    expect(isAppQuery("SELECT queryid FROM pg_stat_statements")).toBe(false);
    expect(isAppQuery('SELECT $2 FROM ONLY "public"."users" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x')).toBe(false);
    expect(isAppQuery("SELECT id FROM orders WHERE organization_id = $1")).toBe(true);
  });
  it("folds the SQL to one short line", () => {
    expect(shortSql("SELECT  a\n   FROM t")).toBe("SELECT a FROM t");
    const long = shortSql("x".repeat(500), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith("…")).toBe(true);
  });
  it("reads milliseconds the way people say them", () => {
    expect(readableMs(0.43)).toEqual({ value: 0.4, unit: "ms" });
    expect(readableMs(0.004)).toEqual({ value: 0.1, unit: "ms", under: true });
    expect(readableMs(145.2)).toEqual({ value: 145, unit: "ms" });
    expect(readableMs(7_200)).toEqual({ value: 7.2, unit: "s" });
    expect(readableMs(186_000)).toEqual({ value: 3.1, unit: "min" });
  });
});
