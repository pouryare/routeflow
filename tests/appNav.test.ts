import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import { APP_GROUPS, appTabs, activeGroup, currentTab, NAV_PARENT, type AppGroupId } from "@/lib/appNav";
import { pillModel } from "@/components/meridian/HoverPill";

const ROLES: Role[] = [
  "platform_owner",
  "owner",
  "group_manager",
  "rep_manager",
  "phone_sales",
  // A van role used to be missing from this list, so the menu they are handed had no
  // coverage at all -- and it is the one menu written out by hand rather than derived.
  // Both are here now: they must resolve to the SAME three tabs, or one of them is
  // silently walking around with somebody else's menu.
  "field_rep",
  "delivery_driver",
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
      // A deep route still lights its group -- for a role that has that group at all.
      // A driver is offered no sales group, so there is nothing there to light, and
      // asking for one would assert a menu they are deliberately not given.
      if (tabs.some((t) => t.href === "/sales/orders")) {
        expect(activeGroup("/sales/orders/42", tabs)).toBe("sales");
      }
      // An unknown route falls back to a group that exists.
      expect(GROUP_IDS.has(activeGroup("/sales/nowhere", tabs))).toBe(true);
    });
  }
});

describe("the group list", () => {
  it("is the eight documented groups, in order", () => {
    expect(APP_GROUPS.map((g) => g.id)).toEqual([
      "day",
      "customers",
      "sales",
      "ops",
      "reports",
      "accounts",
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

  it("customers: the CRM, the map, map pins, complaints, the photo gallery and data quality", () => {
    expect(hrefsIn("customers")).toEqual(["/crm", "/gallery", "/leads", "/map", "/sales/complaints", "/sales/data-quality"]);
  });
  it("the CRM is every role's but the driver's", () => {
    for (const role of ["owner", "group_manager", "rep_manager", "phone_sales"] as const) {
      expect(appTabs({ role }).find((t) => t.href === "/crm")?.ready, role).toBe(true);
    }
    // A driver is no longer a filtered case in the list above -- they get their own, and
    // it holds no CRM at all. Asserting the absence is what keeps this test's name true;
    // for a while it asserted only the half that was already passing.
    expect(appTabs({ role: "delivery_driver" }).some((t) => t.href === "/crm")).toBe(false);
  });

  it("the order pipeline board and the journey are views of the orders page", () => {
    // They were three adjacent entries in the sales group over one readOrders, at limits
    // 100/60/60. The host is one entry now, and the other two are ?view= values on it.
    expect(groupOf("/sales/orders")).toBe("sales");
    expect(appTabs({ role: "owner" }).some((t) => t.href === "/sales/board")).toBe(false);
    expect(appTabs({ role: "owner" }).some((t) => t.href === "/sales/journey")).toBe(false);
  });

  it("the host groups keep more than one tab, so the header keeps its row", () => {
    /* PageHeader.tsx:54 renders the tab row only when `siblings.length > 1`, so a group
       that drops to one silently loses the header's navigation — which is how this
       consolidation could have broken navigation without breaking a single page.

       Scoped to the two HOST groups, and to the roles that actually use them. After
       folding /sales/runs and /sales/deliveries away, a rep_manager and a phone_sales
       rep are left with ONE ready ops tab (انبار و خرید), because the other two are
       manager-only by design. That is not a broken menu: `pillModel` already marks a
       one-tab group `solo` (HoverPill.tsx:53) and draws it as a plain link, which is
       exactly the right shape for a single destination. Asserting `> 1` for every
       role/group pair would fail on a case the app handles on purpose. */
    for (const role of ["owner", "group_manager"] as const) {
      for (const group of ["sales", "ops", "day"] as const) {
        const n = appTabs({ role }).filter((t) => t.group === group && t.ready).length;
        expect(n, `${role} → ${group}`).toBeGreaterThan(1);
      }
    }
  });

  it("a group reduced to one tab becomes a plain link, not a broken menu", () => {
    /* The other half of the invariant above, stated so the reduction is a decision
       rather than an accident: whatever the counts, a group a role can reach exactly
       one destination in must render as a link. */
    const m = pillModel(appTabs({ role: "rep_manager" }), APP_GROUPS, "/sales/stock");
    const ops = m.groups.find((g) => g.id === "ops");
    expect(ops, "rep_manager still has an ops group").toBeTruthy();
    expect(ops!.solo, "a one-tab group must be marked solo").toBe(true);
    expect(ops!.href, "and it must still point somewhere real").toBe("/sales/stock");
  });

  it("money tabs join the order flow they settle", () => {
    expect(groupOf("/sales/payments")).toBe("sales");
    expect(groupOf("/sales/cheques")).toBe("sales");
    expect(groupOf("/sales/commission")).toBe("sales");
  });

  it("delivery and stock share one operations group", () => {
    // /sales/runs and /sales/deliveries are a view and a redirect now; the planner moved
    // to /sales/schedule, which sits in the day group beside the month it plans against.
    expect(hrefsIn("ops")).toEqual(["/sales/batches", "/sales/routing", "/sales/stock"].sort());
  });

  it("every read-only overview is a report, the forecast included", () => {
    expect(hrefsIn("reports")).toEqual(["/report", "/sales", "/sales/dashboard", "/sales/forecast", "/sales/lead-sources", "/sales/reasons"].sort());
  });

  it("academy is team material, not administration", () => {
    expect(hrefsIn("team")).toEqual(["/sales/academy", "/sales/reps", "/sales/tasks"].sort());
  });

  it("organisation settings hold users, groups and our own sites", () => {
    expect(hrefsIn("org")).toEqual(["/facilities", "/sales/admin/groups", "/sales/admin/holidays", "/sales/admin/logins", "/sales/admin/status", "/sales/admin/users"].sort());
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
    const m = menu("phone_sales");
    const ids = m.groups.map((g) => g.id);
    expect(ids).not.toContain("org");
    const offered = Object.values(m.tabsByGroup).flat().map((t) => t.href);
    expect(offered).not.toContain("/sales/tasks");
    expect(offered).not.toContain("/sales/reps");
    expect(offered).toContain("/sales/academy");
  });

  it("the salesperson's lone stock and academy tabs are direct links, not menus", () => {
    const m = menu("phone_sales");
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

/** A driver's menu is written out by hand rather than derived, so it is pinned here. The
 *  other half of the guarantee -- that the gate agrees with it -- is in tests/proxy.test.ts,
 *  because only that file can run the middleware. */
describe("a driver's menu", () => {
  const driver = appTabs({ role: "delivery_driver" });

  it("is their whole day and the door library, and nothing else", () => {
    // /leads is the office's pin pool now. The stops a driver drives are the second
    // section of /driver, so a dual-hat person sees both jobs on one page.
    expect(driver.map((t) => t.href)).toEqual(["/driver", "/sales/academy"]);
  });

  it("keeps the customer and coverage surface off the vehicle", () => {
    const off = ["/crm", "/map", "/gallery", "/sales/orders", "/sales/commission", "/report"];
    for (const href of off) expect(driver.some((t) => t.href === href), href).toBe(false);
  });

  it("is one group, so the header offers a menu rather than a row of lone pills", () => {
    const m = pillModel(driver, APP_GROUPS, "/driver");
    expect(m.groups.map((g) => g.id)).toEqual(["day"]);
    expect(m.tabsByGroup.day.map((t) => t.href)).toEqual([
      "/driver",
      "/sales/academy",
    ]);
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

  it("a ledger page sits under «تراز آزمایشی», the tab that opens it", () => {
    expect(currentTab("/accounting/ledger/7", tabs)?.href).toBe("/accounting/trial-balance");
    expect(activeGroup("/accounting/ledger/7", tabs)).toBe("accounts");
  });

  it("every NAV_PARENT names a real tab, and no page that has its own tab", () => {
    const hrefs = new Set(tabs.map((t) => t.href));
    for (const [child, parent] of Object.entries(NAV_PARENT)) {
      expect(hrefs.has(parent), parent).toBe(true);
      expect(hrefs.has(child), child).toBe(false);
    }
  });

  it("ready mirrors proxy.ts: a salesperson gets neither /report nor /planner", () => {
    const sp = appTabs({ role: "phone_sales" });
    expect(sp.find((t) => t.href === "/report")?.ready).toBe(false);
    expect(sp.find((t) => t.href === "/planner")?.ready).toBe(false);
    expect(sp.find((t) => t.href === "/map")?.ready).toBe(true);
  });

  it("nothing points at the retired /analytics", () => {
    expect(tabs.some((t) => t.href.startsWith("/analytics"))).toBe(false);
  });
});
