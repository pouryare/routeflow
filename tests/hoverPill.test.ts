import { describe, it, expect } from "vitest";
import { pillModel, popoverStyle } from "@/components/meridian/HoverPill";
import { APP_GROUPS, appTabs } from "@/lib/appNav";

/** HoverPill renders; pillModel decides. Keeping the decision in a pure function is what
 *  makes the nav testable in a repo that does not render components in tests. */
const owner = appTabs({ role: "owner" });

describe("pillModel", () => {
  it("shows only groups that have at least one ready tab", () => {
    const m = pillModel(owner, APP_GROUPS, "/sales");
    expect(m.groups.length).toBeGreaterThan(0);
    for (const g of m.groups) expect(m.tabsByGroup[g.id].length).toBeGreaterThan(0);
  });

  it("marks exactly one group active, by longest prefix", () => {
    const m = pillModel(owner, APP_GROUPS, "/sales/orders/12");
    expect(m.groups.filter((g) => g.active)).toHaveLength(1);
    expect(m.groups.find((g) => g.active)?.id).toBe("sales");
  });

  it("resolves a field route to the field group", () => {
    expect(pillModel(owner, APP_GROUPS, "/planner").groups.find((g) => g.active)?.id).toBe("field");
  });

  it("a group's href is its first ready tab, so clicking the chip goes somewhere real", () => {
    const m = pillModel(owner, APP_GROUPS, "/sales");
    for (const g of m.groups) expect(g.href).toBe(m.tabsByGroup[g.id][0].href);
  });

  it("never offers a tab the role cannot reach", () => {
    const m = pillModel(appTabs({ role: "salesperson" }), APP_GROUPS, "/sales");
    for (const list of Object.values(m.tabsByGroup)) {
      for (const t of list) expect(t.ready).toBe(true);
    }
    /* The مدیریت group survives for a salesperson because تقسیم کار, آموزش and شکایات
       are open to everyone — but the owner-only destinations inside it must not be
       offered, and neither must the manager-only field ones. */
    const offered = Object.values(m.tabsByGroup).flat().map((t) => t.href);
    expect(offered).not.toContain("/sales/admin/users");
    expect(offered).not.toContain("/sales/admin/groups");
    expect(offered).not.toContain("/report");
    expect(offered).not.toContain("/planner");
    expect(offered).toContain("/map");
  });

  it("marks the current tab inside its group, for the popover's aria-current", () => {
    const m = pillModel(owner, APP_GROUPS, "/sales/orders");
    expect(m.currentHref).toBe("/sales/orders");
    expect(pillModel(owner, APP_GROUPS, "/sales/orders/12").currentHref).toBe("/sales/orders");
  });

  it("an unknown path leaves no group active rather than guessing", () => {
    const m = pillModel(owner, APP_GROUPS, "/nowhere");
    expect(m.currentHref).toBeUndefined();
  });
});

describe("popoverStyle", () => {
  /* The popover is placed from a rect measured with getBoundingClientRect, whose `left`
     is a PHYSICAL offset from the viewport's left edge. `inset-inline-start` resolves to
     `right` in RTL, so writing that number there positions the panel its own distance
     from the WRONG edge — the bug the user reported as "the menu opens on mirror":
     hovering «روز من», the first chip, opened a panel under «میدان و نقشه», the last.
     Physical measurement demands a physical property. */
  it("positions with a physical property, never a logical one", () => {
    const style = popoverStyle({ left: 300, top: 64 })!;
    expect(style.left).toBe(300);
    expect(style).not.toHaveProperty("insetInlineStart");
    expect(style).not.toHaveProperty("insetInlineEnd");
    expect(style).not.toHaveProperty("right");
  });

  it("is fixed, so a scroll container cannot clip it", () => {
    expect(popoverStyle({ left: 10, top: 20 })!.position).toBe("fixed");
  });

  it("returns undefined before the chip has been measured", () => {
    expect(popoverStyle(null)).toBeUndefined();
  });
});
