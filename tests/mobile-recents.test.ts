import { describe, it, expect, beforeEach } from "vitest";
import { rank, record, usual, loadHistory, saveHistory, type History } from "@/lib/recents";

const items = [
  { id: "1", label: "نانوایی سنگک" },
  { id: "2", label: "بقالی رضا" },
  { id: "3", label: "سوپر علی" },
  { id: "4", label: "آجیل‌فروشی ملی" },
];

describe("recents ranking", () => {
  it("most used first, then most recent, then alphabetical", () => {
    let h: History = {};
    h = record(h, "2", 1000);
    h = record(h, "2", 2000);
    h = record(h, "3", 3000);
    expect(rank(items, h, "", 3000).map((i) => i.id)).toEqual(["2", "3", "4", "1"]);
  });

  it("a tie on count goes to whoever was used last", () => {
    let h: History = {};
    h = record(h, "1", 1000);
    h = record(h, "3", 2000);
    expect(rank(items, h, "", 0).slice(0, 2).map((i) => i.id)).toEqual(["3", "1"]);
  });

  it("a query filters, and Arabic letters and digits find the Persian ones", () => {
    expect(rank(items, {}, "بقالي", 0).map((i) => i.id)).toEqual(["2"]);
    expect(rank([{ id: "9", label: "فروشگاه ۱۲" }], {}, "12", 0)).toHaveLength(1);
  });

  it("a query keeps the same order among its matches", () => {
    const h = record({}, "3", 1);
    expect(rank(items, h, "ی", 0).map((i) => i.id)[0]).toBe("3");
  });

  it("shows at most `limit` and never hides an exact match", () => {
    expect(rank(items, {}, "سوپر", 0, 1).map((i) => i.id)).toEqual(["3"]);
    expect(rank(items, {}, "", 0, 2)).toHaveLength(2);
  });

  it("recording does not mutate the history it was given", () => {
    const h: History = {};
    const next = record(h, "1", 5);
    expect(h).toEqual({});
    expect(next["1"]).toEqual({ n: 1, last: 5 });
  });
});

describe("the usual", () => {
  it("is only things actually used, not an alphabetical guess", () => {
    expect(usual(items, {})).toEqual([]);
    let h: History = {};
    h = record(h, "4", 1);
    expect(usual(items, h).map((i) => i.id)).toEqual(["4"]);
  });
  it("is capped at five", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: `مشتری ${i}` }));
    let h: History = {};
    for (const i of many) h = record(h, i.id, 1);
    expect(usual(many, h)).toHaveLength(5);
  });
});

describe("device storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
  });
  it("keeps one person's history apart from another's, and one kind of thing from another", () => {
    saveHistory(1, "customers", record({}, "7", 1));
    expect(loadHistory(1, "customers")["7"].n).toBe(1);
    expect(loadHistory(2, "customers")).toEqual({});
    expect(loadHistory(1, "products")).toEqual({});
  });
  it("reads garbage as empty rather than throwing", () => {
    (globalThis.localStorage as Storage).setItem("recents:1:x", "not json");
    expect(loadHistory(1, "x")).toEqual({});
    (globalThis.localStorage as Storage).setItem("recents:1:y", "null");
    expect(loadHistory(1, "y")).toEqual({});
  });
  it("survives storage being unavailable", () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadHistory(1, "z")).toEqual({});
    expect(() => saveHistory(1, "z", {})).not.toThrow();
  });
});
