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

  it("every page carries an English title", () => {
    const missing = routes.filter((r) => !PAGE_META[r]?.titleEn);
    expect(missing, `no English title for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("an English title is Latin and does not merely repeat the Persian", () => {
    // A Persian string in an English field is worse than no field: it looks bilingual and
    // is not.
    const offenders = Object.entries(PAGE_META)
      .filter(([, m]) => /[\u0600-\u06FF]/.test(m.titleEn ?? ""))
      .map(([r, m]) => `${r}: ${m.titleEn}`);
    expect(offenders).toEqual([]);
  });

  it("no two routes share an English title", () => {
    // The English title is what appears in <title> and in a browser tab. Two pages sharing
    // one is how someone ends up on the wrong tab for ten minutes.
    const seen = new Map<string, string[]>();
    for (const [r, m] of Object.entries(PAGE_META)) {
      if (!m.titleEn) continue;
      seen.set(m.titleEn, [...(seen.get(m.titleEn) ?? []), r]);
    }
    const dupes = [...seen.entries()].filter(([, rs]) => rs.length > 1);
    expect(dupes, `these routes share an English title:\n${dupes.map(([t, rs]) => `${t}: ${rs.join(", ")}`).join("\n")}`).toEqual([]);
  });

  it("an English title is more than the route path mechanically filled in", () => {
    /* I wrote a stronger version of this and it was WRONG: it flagged "Orders", "Routing",
     * "Cheques" and "Holidays" for equalling their route segment. Those are the correct
     * English names — the segment carries real information, and a bilingual person calls the
     * page "Orders" because that is what an order page is called.
     *
     * What IS a defect is a title that is the RAW PATH, slashes and all, or the segment with
     * hyphens left in: "/sales/orders" as "Sales orders" is a string nobody would utter. */
    const mechanical = Object.entries(PAGE_META)
      .filter(([route, m]) => {
        const en = (m.titleEn ?? "").toLowerCase();
        return en.includes("/") || en.includes("-");
      })
      .map(([route, m]) => `${route}: ${m.titleEn}`);
    expect(mechanical, `mechanically derived from the path:\n${mechanical.join("\n")}`).toEqual([]);
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

/* "The card is actually on the page" now lives in tests/shell-pages-have-tabs.test.ts.
 *
 *  The assertion that used to sit here accepted the substring "PageHeader", which matches
 *  PageHeaderCard too — so it passed for the seven client-component pages that had the
 *  tab-less card and no navigation at all. It permitted the defect it looked like it was
 *  guarding. The replacement requires the real async PageHeader, follows ancestor
 *  layouts, and additionally checks that any layout rendering it wraps it in Suspense. */

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
