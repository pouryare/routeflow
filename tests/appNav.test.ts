import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import { APP_GROUPS, appTabs, activeGroup } from "@/lib/appNav";

const ROLES: Role[] = [
  "platform_owner",
  "owner",
  "group_manager",
  "rep_manager",
  "salesperson",
];
const GROUP_IDS = new Set(APP_GROUPS.map((g) => g.id));

describe("the sales nav, for every role", () => {
  for (const role of ROLES) {
    const tabs = appTabs({ role });

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
        expect(activeGroup(t.href, tabs)).toBe(t.group);
      }
      // A deep route still lights its group.
      expect(activeGroup("/sales/orders/42", tabs)).toBe("sales");
      // An unknown route falls back to a group that exists.
      expect(GROUP_IDS.has(activeGroup("/sales/nowhere", tabs))).toBe(true);
    });
  }
});

describe("the group list", () => {
  it("is the seven documented groups, in order", () => {
    expect(APP_GROUPS.map((g) => g.id)).toEqual([
      "day",
      "sales",
      "delivery",
      "money",
      "stock",
      "admin",
      "field",
    ]);
  });

  it("labels are non-empty and distinct", () => {
    const labels = APP_GROUPS.map((g) => g.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });
});

/** The field group and /report join the registry when one shell starts wrapping every
 *  themed surface — before that, these routes had no header to be reached from. */
describe("the surfaces that join the shell", () => {
  const tabs = appTabs({ role: "owner" });

  it("the field group carries map, planner and leads", () => {
    const hrefs = tabs.filter((t) => t.group === "field").map((t) => t.href).sort();
    expect(hrefs).toEqual(["/leads", "/map", "/planner"]);
  });

  it("/report is a money-group destination", () => {
    expect(tabs.find((t) => t.href === "/report")?.group).toBe("money");
  });

  it("activeGroup resolves a field path", () => {
    expect(activeGroup("/planner", tabs)).toBe("field");
    expect(activeGroup("/map", tabs)).toBe("field");
    expect(activeGroup("/sales/orders/12", tabs)).toBe("sales");
  });

  it("ready mirrors proxy.ts: a salesperson gets neither /report nor /planner", () => {
    const sp = appTabs({ role: "salesperson" });
    expect(sp.find((t) => t.href === "/report")?.ready).toBe(false);
    expect(sp.find((t) => t.href === "/planner")?.ready).toBe(false);
    expect(sp.find((t) => t.href === "/map")?.ready).toBe(true);
  });

  it("nothing points at the retired /analytics", () => {
    expect(tabs.some((t) => t.href.startsWith("/analytics"))).toBe(false);
  });
});
