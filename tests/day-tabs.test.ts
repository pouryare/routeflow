import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/** The month ahead and the day's assignment were two verbs pretending to be two pages.
 *
 *  /sales/schedule shows the month. /sales/runs assigns work to vans. They are not
 *  variants of each other, but they are the same subject — one delivery day — and the
 *  calendar already queries BOTH delivery_runs and visit_plans and merges them into one
 *  month. The month grid is the natural spine: "what is planned" and "who is carrying it"
 *  are read off the same grid.
 *
 *  The redirect assertion matters for the same reason the orders one does: a
 *  consolidation that 404s an old bookmark is worse than no consolidation.
 *
 *  Source-text assertions, not rendering: vitest runs in a node environment and no test
 *  here imports anything from @/app/. */
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("the day host serves two views", () => {
  const host = read("app/(shell)/sales/schedule/page.tsx");

  it("names the runs view", () => {
    expect(host).toContain('"runs"');
  });

  it("renders the month grid by default and the planner on ?view=runs", () => {
    expect(host, "the default view is the month").toContain("ScheduleBoard");
    /* Three names have come and gone here: AssignmentBoard, then OrderRouteBoard, now
       RunsViewClient. The assertion is that the runs view renders A board and hands it to
       RunsView — not that it renders a particular filename, which is what broke twice
       before this test was written. */
    expect(host, "the runs view is the planner").toContain("RunsViewClient");
    /* The page no longer names the board: RunsViewClient owns draft mutations and renders
       DayLaneBoard. So the chain is asserted, not a filename — which is what broke twice
       before this test was written. */
    expect(read("components/sales/RunsViewClient.tsx"), "and the board renders").toContain(
      "DayLaneBoard"
    );
  });

  it("carries the tab strip", () => {
    expect(host).toContain("ViewTabs");
  });

  it("still reads BOTH tables for the month", () => {
    // The thing that made it the natural spine: one calendar over two kinds of plan.
    expect(host, "the month reads delivery_runs").toContain("delivery_runs");
    expect(host, "and visit_plans").toContain("visit_plans");
  });

  it("carries the phone_sales guard the moved planner had", () => {
    /* proxy.ts's isBatchAdmin covers /sales/runs and /sales/deliveries by PREFIX. Once
       the planner moved to the host, that gate no longer covers the page -- so without a
       guard here a phone_sales rep would find the run planner by typing the URL. */
    expect(host, "the runs view must refuse a phone_sales rep").toMatch(
      /view === "runs"[\s\S]{0,200}phone_sales/,
    );
  });

  it("carries the van-role set, not the name that matches nobody", () => {
    /* The driver list used to read `role = 'driver'`, which matched nobody after
       lib/db.ts renamed that role. Spec 1 Task 9 fixed it; this task must MOVE the fix
       rather than retype the old query, so the dropdown does not go silently empty
       again in its new home.

       Comments are stripped, and deliberately: the fix's own comment has to name the old
       predicate to explain the bug, and a test that forbids a string must not forbid
       the sentence explaining why it was removed. */
    const code = read("lib/repo/scheduleView.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code, "the planner must build its driver list from VAN_ROLES").toContain("VAN_ROLES");
    expect(code).not.toMatch(/role\s*=\s*'driver'/);
  });
});

describe("/sales/runs is gone; the runs view keeps its copy", () => {
  it("has no page of its own (no old links to keep: the app has no users yet)", () => {
    expect(existsSync("app/(shell)/sales/runs")).toBe(false);
  });

  it("the runs view carries the «سفرهای تحویل» copy itself", () => {
    expect(read("lib/pageMeta.ts")).toContain('"/sales/schedule?view=runs": {');
  });
});
