import { describe, it, expect } from "vitest";
import { compileFilter, filterProblem, parseTyped, allOf, condLabel } from "@/lib/filterSpec";
import { CUSTOMER_FILTER_MENU as M } from "@/lib/customerFilterMenu";

const ctx = { today: "2026-11-14", userId: 7 };

describe("typed filters (A17)", () => {
  it("turns «شهر:تهران روز_از_خرید>۳۰ مسئول:من» into conditions and keeps the other words as the search text", () => {
    const { conds, rest } = parseTyped("نان شهر:تهران روز_از_خرید>۳۰ مسئول:من قنادی", M);
    expect(conds).toEqual([
      { field: "city", op: "contains", value: "تهران" },
      { field: "since_purchase", op: "gt", value: 30 },
      { field: "owner", op: "eq", value: "من" },
    ]);
    expect(rest).toBe("نان قنادی");
    expect(condLabel(conds[1], M)).toBe("روز از خرید > 30");
  });
  it("leaves a word that is not a filter alone (unknown field, bad number, text with >)", () => {
    expect(parseTyped("بدهی>100 شهر>تهران سقف_اعتبار>abc", M)).toEqual({ conds: [], rest: "بدهی>100 شهر>تهران سقف_اعتبار>abc" });
  });
});

describe("one filter shape", () => {
  it("compiles to parameterised SQL in the order of its placeholders", () => {
    const q = compileFilter(allOf(parseTyped("شهر:تهران روز_از_خرید>30 سقف_اعتبار<=500", M).conds), M, ctx);
    expect(q.sql).toBe(" AND (c.city LIKE ? ESCAPE '\\' AND c.last_purchase_date IS NOT NULL AND (CAST(? AS date) - CAST(c.last_purchase_date AS date)) > ? AND c.credit_limit_toman <= ?)");
    expect(q.params).toEqual(["%تهران%", "2026-11-14", 30, 500]);
  });
  it("supports nested OR, and escapes LIKE wildcards in a value", () => {
    const q = compileFilter({ op: "or", items: [{ field: "lifecycle", op: "eq", value: "lead" }, { op: "and", items: [{ field: "city", op: "contains", value: "50%_" }, { field: "owner", op: "eq", value: "من" }] }] }, M, ctx);
    expect(q.sql).toContain(" OR ");
    expect(q.params).toEqual(["lead", "%50\\%\\_%", 7]);
  });
  it("refuses a field or operator the menu does not offer, so a saved filter cannot name a column", () => {
    expect(filterProblem({ field: "password_hash", op: "eq", value: "x" }, M)).toMatch(/فیلد/);
    expect(filterProblem({ field: "city", op: "gt", value: "x" }, M)).toMatch(/متن/);
    expect(filterProblem({ field: "limit", op: "contains", value: 3 }, M)).toMatch(/عددی/);
    expect(() => compileFilter({ field: "x", op: "eq", value: 1 }, M, ctx)).toThrow();
    expect(compileFilter(null, M, ctx)).toEqual({ sql: "", params: [] });
  });
});
