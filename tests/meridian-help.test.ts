import { describe, it, expect, beforeEach } from "vitest";
import { HELP, getHelp, isTodo, todoHelpIds, __resetTodo } from "@/lib/help";
import { pageMetaFor } from "@/lib/pageMeta";

describe("meridian help registry", () => {
  beforeEach(() => __resetTodo());

  it("a mapped id returns its real copy", () => {
    const e = getHelp("dashboard.revenue");
    expect(isTodo(e)).toBe(false);
    if (!isTodo(e)) {
      expect(e.title).toBeTruthy();
      expect(e.what).toBeTruthy();
      expect(e.how).toBeTruthy();
    }
  });

  it("an unmapped id resolves to a safe todo entry, never throws", () => {
    const e = getHelp("nowhere.nothing");
    expect(e).toEqual({ id: "nowhere.nothing", todo: true });
    expect(isTodo(e)).toBe(true);
  });

  it("unmapped ids are collected for the help-debt report", () => {
    getHelp("a.one");
    getHelp("b.two");
    getHelp("a.one");
    expect(todoHelpIds()).toEqual(["a.one", "b.two"]);
  });

  it("every seeded entry has all three copy fields and a matching id", () => {
    for (const [key, e] of Object.entries(HELP)) {
      expect(e.id).toBe(key);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.what.length).toBeGreaterThan(0);
      expect(e.how.length).toBeGreaterThan(0);
    }
  });

  it("F84: the five busiest screens open written help, not the placeholder", () => {
    for (const [route, view] of [["/sales/today"], ["/crm"], ["/sales/payments"], ["/planner"], ["/sales/schedule", "runs"]]) {
      const id = pageMetaFor(route, view).help;
      expect(id, route).toBeTruthy();
      expect(isTodo(getHelp(id as string)), route).toBe(false);
    }
  });
});
