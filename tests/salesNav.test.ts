import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import { SALES_GROUPS, salesTabs, activeSalesGroup } from "@/lib/salesNav";

const ROLES: Role[] = [
  "platform_owner",
  "owner",
  "group_manager",
  "rep_manager",
  "salesperson",
];
const GROUP_IDS = new Set(SALES_GROUPS.map((g) => g.id));

describe("the sales nav, for every role", () => {
  for (const role of ROLES) {
    const tabs = salesTabs({ role });

    it(`${role}: every tab sits in a real group`, () => {
      for (const t of tabs) expect(GROUP_IDS.has(t.group), `${t.href} → ${t.group}`).toBe(true);
    });

    it(`${role}: hrefs are unique`, () => {
      const hrefs = tabs.map((t) => t.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it(`${role}: no two READY tabs read alike`, () => {
      const labels = tabs.filter((t) => t.ready).map((t) => t.label);
      expect(new Set(labels).size, labels.join(" | ")).toBe(labels.length);
    });

    it(`${role}: nothing points at the retired /sales/analysis`, () => {
      expect(tabs.some((t) => t.href === "/sales/analysis")).toBe(false);
    });

    it(`${role}: every group with a ready tab is reachable, and the active group resolves`, () => {
      for (const t of tabs.filter((x) => x.ready)) {
        expect(activeSalesGroup(t.href, tabs)).toBe(t.group);
      }
      // A deep route still lights its group.
      expect(activeSalesGroup("/sales/orders/42", tabs)).toBe("sales");
      // An unknown route falls back to a group that exists.
      expect(GROUP_IDS.has(activeSalesGroup("/sales/nowhere", tabs))).toBe(true);
    });
  }
});

describe("the group list", () => {
  it("is the six documented groups, in order", () => {
    expect(SALES_GROUPS.map((g) => g.id)).toEqual([
      "day",
      "sales",
      "delivery",
      "money",
      "stock",
      "admin",
    ]);
  });

  it("labels are non-empty and distinct", () => {
    const labels = SALES_GROUPS.map((g) => g.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });
});
