import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Three pages were one query, listed adjacently in the same nav group.
 *
 *  /sales/orders, /sales/board and /sales/journey each called readOrders over the same
 *  scope, with limits 100 / 60 / 60, and appeared as three menu items next to each other.
 *  The header already renders the nav group's ready tabs as a tab row, so a manager
 *  opening /sales/orders was already looking at something shaped like a tab host. This
 *  makes the markup match what the header already promised.
 *
 *  The REDIRECT test is the one that matters. A consolidation that silently 404s an old
 *  bookmark is worse than no consolidation — so each old href must land on the right host
 *  AND the right view, not merely on the host.
 *
 *  Source-text assertions, not rendering: vitest runs in a node environment and no test
 *  in this repo imports anything from @/app/. A redirect target is not reachable any
 *  other way. */
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("the orders host serves three views", () => {
  const host = read("app/(shell)/sales/orders/page.tsx");

  it("names all three views", () => {
    for (const v of ["board", "journey"]) {
      expect(host, `the host must know the ${v} view`).toContain(`"${v}"`);
    }
  });

  it("renders each view's own component", () => {
    expect(host, "the list view is OrdersPockets").toContain("OrdersPockets");
    expect(host, "the board view is OrderPipeline").toContain("OrderPipeline");
    expect(host, "the journey view is OrderSpine").toContain("OrderSpine");
    expect(host, "the journey view also carries the funnel").toContain("OrderFunnel");
  });

  // The reads moved out of the page into lib/repo/ordersView.ts (ordersListFor); the page asks once.
  const view = read("lib/repo/ordersView.ts");

  it("reads orders ONCE, not once per view", () => {
    // Three pages, one table, one reader function. If the host grows a second
    // ordersListFor / readOrders call the consolidation has only changed the URLs.
    expect(host.match(/ordersListFor\(/g) ?? []).toHaveLength(1);
    expect(host).not.toMatch(/readOrders\(/);
    expect(view.match(/readOrders\(/g) ?? []).toHaveLength(1);
  });

  it("all three views use the same limit", () => {
    // 100 / 60 / 60 meant the two quieter pages silently truncated. 100 is the one that
    // was not truncating, so it is the one the list uses.
    expect(view).toMatch(/limit:\s*100\b/);
    expect(view).not.toMatch(/limit:\s*60\b/);
  });

  it("still carries the tab strip", () => {
    expect(host).toContain("ViewTabs");
  });
});

describe("the three old order hrefs redirect to the right host AND view", () => {
  const CASES: [string, string][] = [
    ["app/(shell)/sales/board/page.tsx", "/sales/orders?view=board"],
    ["app/(shell)/sales/journey/page.tsx", "/sales/orders?view=journey"],
    ["app/(shell)/sales/deliveries/page.tsx", "/sales/orders"],
  ];

  for (const [file, target] of CASES) {
    it(`${file} → ${target}`, () => {
      const src = read(file);
      expect(src, "a redirect page must not also render").not.toContain("PageHeader");
      expect(src).toMatch(/redirect\(\s*["']/);
      // The exact target string, so /sales/board cannot land on a bare /sales/orders
      // and lose the view.
      expect(src.replace(/\s+/g, " ")).toContain(`redirect("${target}")`);
    });
  }

  it("each redirect page still has a PAGE_META entry", () => {
    // tests/pageMeta.test.ts walks app/(shell) and fails on a route with no entry AND on
    // an entry whose route has gone. The routes resolve, so the entries must stay.
    const meta = read("lib/pageMeta.ts");
    for (const r of ["/sales/board", "/sales/journey", "/sales/deliveries"]) {
      expect(meta, `${r} must keep its meta`).toContain(`"${r}":`);
    }
  });
});

describe("the menu no longer offers the merged routes", () => {
  const nav = read("lib/appNav.ts");
  it("has no href entries for the four merged routes", () => {
    for (const href of ["/sales/board", "/sales/journey", "/sales/runs", "/sales/deliveries"]) {
      expect(nav, `${href} must be gone from appNav`).not.toMatch(
        new RegExp(`href:\\s*"${href.replace("/", "\\/")}"`),
      );
    }
  });
  it("keeps the briefing's links pointing at real hosts", () => {
    // lib/repo/briefing.ts is a server DATA file, not a page, so a page-by-page review
    // never sees it -- and it is the status row a manager taps all day.
    //
    // The invariant is that NO href lands on a route that now only redirects. This used to
    // assert one exact string, `/sales/orders?view=board`, and went stale the moment the
    // panel started linking each order to itself (7a3d161) -- a deliberate improvement that
    // a hardcoded expectation could not survive. Checking the rule instead of the example is
    // what lets the panel improve without a fight.
    const briefing = read("lib/repo/briefing.ts");
    for (const href of ["/sales/board", "/sales/journey", "/sales/runs", "/sales/deliveries"]) {
      expect(briefing, `${href} is a redirect; the briefing must not link at it`)
        .not.toMatch(new RegExp(`href:\\s*"${href.replace("/", "\\/")}"`));
    }
    // And the panel still links somewhere: an empty href list is the failure this guards too.
    expect(briefing, "the briefing must still link somewhere").toMatch(/href:\s*[`"]/);
  });
});
