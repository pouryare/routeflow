import { describe, it, expect } from "vitest";
import { sortRows, visibleRows, MARGIN_ROW_LIMIT } from "@/components/analysis/marginRows";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i) }));

describe("visibleRows", () => {
  it("shows every row of a short table, with nothing hidden", () => {
    expect(visibleRows(rows(5), false)).toEqual({ shown: rows(5), hidden: 0 });
    expect(visibleRows(rows(MARGIN_ROW_LIMIT), false).hidden).toBe(0);
  });
  it("cuts a long table to the limit and says how many are hidden", () => {
    const r = visibleRows(rows(712), false);
    expect(r.shown).toHaveLength(MARGIN_ROW_LIMIT);
    expect(r.hidden).toBe(712 - MARGIN_ROW_LIMIT);
    expect(r.shown[0]).toEqual({ key: "0" }); // the head, in order
  });
  it("shows everything once expanded", () => {
    expect(visibleRows(rows(712), true)).toEqual({ shown: rows(712), hidden: 0 });
  });
});

describe("sortRows", () => {
  const data = [{ label: "ب", v: 2 }, { label: "الف", v: 3 }, { label: "پ", v: 1 }];
  it("keeps the server order with no sort", () => {
    expect(sortRows(data, undefined)).toBe(data);
  });
  it("sorts numbers by value, both ways, without touching the input", () => {
    expect(sortRows(data, { column: "v", direction: "ascending" }).map((r) => r.v)).toEqual([1, 2, 3]);
    expect(sortRows(data, { column: "v", direction: "descending" }).map((r) => r.v)).toEqual([3, 2, 1]);
    expect(data.map((r) => r.v)).toEqual([2, 3, 1]);
  });
  it("sorts names in Persian order", () => {
    expect(sortRows(data, { column: "label", direction: "ascending" }).map((r) => r.label)).toEqual(["الف", "ب", "پ"]);
  });
});
