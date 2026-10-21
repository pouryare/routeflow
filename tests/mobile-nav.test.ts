import { describe, it, expect } from "vitest";
import { ROLES } from "@/lib/roles";
import { appTabs } from "@/lib/appNav";
import {
  bottomTabs, PRIMARY_BY_ROLE, QUICK_ACTIONS, quickActionsFor, TAB_ICON,
} from "@/lib/mobileNav";
import { ICONS } from "@/components/meridian/icon-map";

describe("bottom tabs", () => {
  it.each(ROLES)("%s: at most 4 primary tabs, all reachable by that role", (role) => {
    const reachable = appTabs({ role }).filter((t) => t.ready).map((t) => t.href);
    const m = bottomTabs({ role });
    expect(m.primary.length).toBeLessThanOrEqual(4);
    for (const t of m.primary) expect(reachable).toContain(t.href);
  });

  it.each(ROLES)("%s: nothing the role can open becomes unreachable on a phone", (role) => {
    const reachable = appTabs({ role }).filter((t) => t.ready);
    const m = bottomTabs({ role });
    const shown = new Set([...m.primary.map((t) => t.href), ...m.more.flatMap((g) => g.tabs.map((t) => t.href))]);
    for (const t of reachable) expect(shown.has(t.href), t.href).toBe(true);
  });

  it.each(ROLES)("%s: a destination is in the bar or in «بیشتر», never both", (role) => {
    const m = bottomTabs({ role });
    const inBar = new Set(m.primary.map((t) => t.href));
    for (const g of m.more) for (const t of g.tabs) expect(inBar.has(t.href), t.href).toBe(false);
  });

  it("PRIMARY_BY_ROLE only names hrefs the role can reach", () => {
    for (const role of ROLES) {
      const reachable = appTabs({ role }).filter((t) => t.ready).map((t) => t.href);
      for (const h of PRIMARY_BY_ROLE[role] ?? []) expect(reachable, `${role} ${h}`).toContain(h);
    }
  });

  it("every primary tab has an icon that exists (an icon is never alone, but a tab is never bare)", () => {
    for (const role of ROLES) for (const t of bottomTabs({ role }).primary) {
      expect(TAB_ICON[t.href], t.href).toBeTruthy();
      expect(ICONS[TAB_ICON[t.href] as keyof typeof ICONS], t.href).toBeTruthy();
    }
  });

  it("sales roles get the four destinations they use all day; a driver gets the two they have", () => {
    expect(bottomTabs({ role: "phone_sales" }).primary.map((t) => t.href)).toEqual(["/sales/today", "/crm", "/sales/pocket", "/sales/orders"]);
    expect(bottomTabs({ role: "delivery_driver" }).primary.map((t) => t.href)).toEqual(["/driver", "/sales/academy"]);
  });
});

describe("quick actions", () => {
  it("every action a role is offered points at a page that role can open", () => {
    for (const role of ROLES) {
      const reachable = new Set(appTabs({ role }).filter((t) => t.ready).map((t) => t.href));
      for (const a of quickActionsFor({ role })) {
        if (a.requires) expect(reachable.has(a.requires), `${role} ${a.id}`).toBe(true);
      }
    }
  });
  it("reminders and notes are for everyone; payment, complaint and order need their pages", () => {
    const ids = (r: Parameters<typeof quickActionsFor>[0]["role"]) => quickActionsFor({ role: r }).map((a) => a.id);
    expect(ids("phone_sales")).toEqual(["reminder", "note", "order", "payment", "complaint"]);
    expect(ids("rep_manager")).toEqual(["reminder", "note"]);
    expect(QUICK_ACTIONS.every((a) => a.label.length > 0)).toBe(true);
  });
  it("a van role gets no quick actions (the driver page has its own)", () => {
    expect(quickActionsFor({ role: "delivery_driver" })).toEqual([]);
  });
});
