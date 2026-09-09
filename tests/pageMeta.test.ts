import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_META, pageMetaFor } from "@/lib/pageMeta";

/** Every shell route opens with a card carrying its title and a short overview. Walking
 *  the tree rather than listing routes by hand means a page added tomorrow fails this
 *  test on the day it is added, which is the entire point — the alternative is a page
 *  whose top card is silently blank. */
function staticRoutes(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("[")) continue; // detail pages title themselves from the record
    if (e.name.startsWith("(")) {
      out.push(...staticRoutes(join(dir, e.name), base));
      continue;
    }
    const url = `${base}/${e.name}`;
    if (existsSync(join(dir, e.name, "page.tsx"))) out.push(url);
    out.push(...staticRoutes(join(dir, e.name), url));
  }
  return out;
}

describe("pageMeta", () => {
  const routes = staticRoutes("app/(shell)");

  it("finds the shell routes at all (guards the walker itself)", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/sales/orders");
    expect(routes).toContain("/planner");
  });

  it("covers every static route under app/(shell)", () => {
    const missing = routes.filter((r) => !PAGE_META[r]);
    expect(missing, `no overview copy for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("carries no entry for a route that no longer exists", () => {
    const stale = Object.keys(PAGE_META).filter((r) => !routes.includes(r));
    expect(stale, `stale pageMeta entries:\n${stale.join("\n")}`).toEqual([]);
  });

  it("every overview is a real sentence, not a placeholder", () => {
    for (const [k, v] of Object.entries(PAGE_META)) {
      expect(v.title.trim().length, k).toBeGreaterThan(1);
      expect(v.overview.trim().length, k).toBeGreaterThan(25);
      expect(v.overview, k).not.toMatch(/TODO|TBD|placeholder|lorem/i);
    }
  });

  it("resolves a detail page to its section by longest prefix", () => {
    expect(pageMetaFor("/sales/orders/12").title).toBe(PAGE_META["/sales/orders"].title);
    expect(pageMetaFor("/sales/reps/4").title).toBe(PAGE_META["/sales/reps"].title);
  });

  it("falls back rather than throwing on an unknown path", () => {
    expect(pageMetaFor("/nowhere/at/all").title.length).toBeGreaterThan(0);
  });
});

/** The copy existing is half of it; the card actually being on the page is the other. */
describe("every page opens with its overview card", () => {
  const routes = staticRoutes("app/(shell)");

  it("renders PageHeader, except redirect-only pages", () => {
    const missing: string[] = [];
    for (const r of routes) {
      const src = readFileSync(join("app/(shell)", r, "page.tsx"), "utf8");
      if (src.includes("PageHeader")) continue; // PageHeader or PageHeaderCard
      // A page whose whole body is redirect() has nothing to head.
      if (/redirect\(["'`]/.test(src)) continue;
      missing.push(r);
    }
    expect(missing, `no <PageHeader> on:\n${missing.join("\n")}`).toEqual([]);
  });
});

/** loading.tsx only does anything because the shell layout is synchronous (see
 *  tests/shellLayout.test.ts). Given that, every route should have one — a segment
 *  without one falls back to the nearest ancestor's, which is the wrong page's shape. */
describe("every page has an instant loading state", () => {
  const routes = staticRoutes("app/(shell)");

  it("has a loading.tsx beside its page.tsx", () => {
    const missing = routes.filter((r) => {
      const src = readFileSync(join("app/(shell)", r, "page.tsx"), "utf8");
      if (/redirect\(["'`]/.test(src) && !src.includes("PageHeader")) return false;
      return !existsSync(join("app/(shell)", r, "loading.tsx"));
    });
    expect(missing, `no loading.tsx for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("each loading state shows the real page title, not a grey box", () => {
    for (const r of routes) {
      const p = join("app/(shell)", r, "loading.tsx");
      if (!existsSync(p)) continue;
      const src = readFileSync(p, "utf8");
      expect(src, r).toContain("PageHeaderCard");
      expect(src, r).toContain(`pageMetaFor("${r}")`);
    }
  });
});
