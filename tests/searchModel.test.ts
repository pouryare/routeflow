import { describe, it, expect } from "vitest";
import { rankPages, pushRecent, parseRecent, moveActive, RECENT_MAX, type SearchHit } from "@/lib/searchModel";
import { appTabs } from "@/lib/appNav";

const owner = appTabs({ role: "owner" });
const hit = (n: number): SearchHit => ({ kind: "page", id: `page:/p${n}`, label: `p${n}`, href: `/p${n}` });

describe("rankPages", () => {
  it("finds a page by any part of its Persian label", () => {
    expect(rankPages(owner, "سفارش").map((h) => h.href)).toContain("/sales/orders");
  });

  it("ranks a label that STARTS with the query above one that merely contains it", () => {
    const hrefs = rankPages(owner, "مسیر").map((h) => h.href);
    // «مسیر سفارش» / «مسیر تحویل» start with it; «برنامه‌ریز مسیر» only contains it.
    expect(hrefs.indexOf("/planner")).toBeGreaterThan(hrefs.indexOf("/sales/journey"));
  });

  it("folds Arabic ي/ك into Persian ی/ک, so a keyboard layout cannot hide a page", () => {
    expect(rankPages(owner, "كالا").map((h) => h.href)).toContain("/sales/products");
  });

  it("never offers a page the role cannot reach", () => {
    const hrefs = rankPages(appTabs({ role: "salesperson" }), "کاربران").map((h) => h.href);
    expect(hrefs).not.toContain("/sales/admin/users");
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(rankPages(owner, "   ")).toEqual([]);
  });
});

describe("recents", () => {
  it("puts the newest first and does not duplicate", () => {
    expect(pushRecent([hit(1), hit(2)], hit(2)).map((h) => h.id)).toEqual(["page:/p2", "page:/p1"]);
  });

  it(`keeps at most ${RECENT_MAX}`, () => {
    let list: SearchHit[] = [];
    for (let i = 0; i < 10; i++) list = pushRecent(list, hit(i));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe("page:/p9");
  });

  it("survives garbage in storage: another tab, an old format, a hand edit", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([hit(1), { kind: "page", label: 3 }]))).toEqual([hit(1)]);
  });

  it("drops a stored href that leaves the app, so storage cannot become an open redirect", () => {
    const evil = { ...hit(1), href: "https://evil.example" };
    const protoRelative = { ...hit(2), href: "//evil.example" };
    const backslash = { ...hit(3), href: "/\\evil.example" };
    expect(parseRecent(JSON.stringify([evil, protoRelative, backslash]))).toEqual([]);
  });
});

describe("moveActive", () => {
  it("enters the list from nothing at the start going down and the end going up", () => {
    expect(moveActive(-1, 1, 4)).toBe(0);
    expect(moveActive(-1, -1, 4)).toBe(3);
  });
  it("wraps at both ends", () => {
    expect(moveActive(3, 1, 4)).toBe(0);
    expect(moveActive(0, -1, 4)).toBe(3);
  });
  it("has nowhere to go in an empty list", () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
