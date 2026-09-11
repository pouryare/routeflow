import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import { APP_GROUPS, appTabs, activeGroup, type AppGroupId } from "@/lib/appNav";
import { pillModel } from "@/components/meridian/HoverPill";

const ROLES: Role[] = [
  "platform_owner",
  "owner",
  "group_manager",
  "rep_manager",
  "salesperson",
];
const GROUP_IDS = new Set(APP_GROUPS.map((g) => g.id));

describe("the app nav, for every role", () => {
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
      "customers",
      "sales",
      "ops",
      "reports",
      "team",
      "org",
    ]);
  });

  it("labels are non-empty and distinct", () => {
    const labels = APP_GROUPS.map((g) => g.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });
});

/** The groups follow the work, not the org chart. Each assertion below is one of the
 *  misfilings the regroup fixed, so a later edit that drifts back fails by name. */
describe("where each destination lives", () => {
  const owner = appTabs({ role: "owner" });
  const groupOf = (href: string) => owner.find((t) => t.href === href)?.group;
  const hrefsIn = (g: AppGroupId) => owner.filter((t) => t.group === g).map((t) => t.href).sort();

  it("customers: the map, leads, complaints and the photo gallery", () => {
    expect(hrefsIn("customers")).toEqual(["/gallery", "/leads", "/map", "/sales/complaints"]);
  });

  it("the order pipeline board sits with orders, not with team management", () => {
    expect(groupOf("/sales/board")).toBe("sales");
    expect(groupOf("/sales/journey")).toBe("sales");
  });

  it("money tabs join the order flow they settle", () => {
    expect(groupOf("/sales/payments")).toBe("sales");
    expect(groupOf("/sales/cheques")).toBe("sales");
    expect(groupOf("/sales/commission")).toBe("sales");
  });

  it("delivery and stock share one operations group", () => {
    expect(hrefsIn("ops")).toEqual(
      ["/sales/batches", "/sales/deliveries", "/sales/routing", "/sales/runs", "/sales/stock"].sort(),
    );
  });

  it("every read-only overview is a report, the forecast included", () => {
    expect(hrefsIn("reports")).toEqual(["/report", "/sales", "/sales/dashboard", "/sales/forecast"].sort());
  });

  it("academy is team material, not administration", () => {
    expect(hrefsIn("team")).toEqual(["/sales/academy", "/sales/reps", "/sales/tasks"].sort());
  });

  it("organisation settings hold users, groups and our own sites", () => {
    expect(hrefsIn("org")).toEqual(["/facilities", "/sales/admin/groups", "/sales/admin/users"].sort());
  });

  it("names say what is on the page: my tasks, the sales summary, production batches", () => {
    const label = (h: string) => owner.find((t) => t.href === h)?.label;
    expect(label("/sales/pocket")).toBe("کارهای من");
    expect(label("/sales")).toBe("خلاصهٔ فروش");
    expect(label("/sales/batches")).toBe("سری‌های ساخت");
  });

  it("the visit planner sits beside the visit schedule", () => {
    expect(groupOf("/planner")).toBe("day");
    expect(groupOf("/sales/schedule")).toBe("day");
  });

  it("no two tabs open with «مسیر», the word four of them used to share", () => {
    const starts = owner.filter((t) => t.label.startsWith("مسیر ")).map((t) => t.label);
    expect(starts).toEqual([]);
  });
});

/** The single-tab chip problem, per role: a group that opens a menu with one item in it
 *  is a click that goes nowhere new. The pill turns those into plain links, and these
 *  tests pin that every role's menu stays small and mostly real menus. */
describe("each role's menu", () => {
  const menu = (role: Role) => pillModel(appTabs({ role }), APP_GROUPS, "/sales/today");

  it("a salesperson gets no organisation settings and no team tools beyond academy", () => {
    const m = menu("salesperson");
    const ids = m.groups.map((g) => g.id);
    expect(ids).not.toContain("org");
    const offered = Object.values(m.tabsByGroup).flat().map((t) => t.href);
    expect(offered).not.toContain("/sales/tasks");
    expect(offered).not.toContain("/sales/reps");
    expect(offered).toContain("/sales/academy");
  });

  it("the salesperson's lone stock and academy tabs are direct links, not menus", () => {
    const m = menu("salesperson");
    const solo = m.groups.filter((g) => g.solo).map((g) => g.href).sort();
    expect(solo).toEqual(["/sales/academy", "/sales/stock"]);
  });

  it("a rep manager's team group leads with nothing they cannot open", () => {
    const team = menu("rep_manager").tabsByGroup.team.map((t) => t.href);
    expect(team).toEqual(["/sales/tasks", "/sales/reps", "/sales/academy"]);
  });

  it("only the owner sees organisation settings", () => {
    expect(menu("owner").groups.map((g) => g.id)).toContain("org");
    expect(menu("group_manager").groups.map((g) => g.id)).not.toContain("org");
  });
});

describe("the surfaces that join the shell", () => {
  const tabs = appTabs({ role: "owner" });

  it("activeGroup resolves the spatial and report paths", () => {
    expect(activeGroup("/planner", tabs)).toBe("day");
    expect(activeGroup("/map", tabs)).toBe("customers");
    expect(activeGroup("/report", tabs)).toBe("reports");
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
