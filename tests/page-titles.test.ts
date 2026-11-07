import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** Every page names its own browser tab. The root layout only supplies the template
 *  («%s · RouteFlow») and a fallback, so a page that sets no title shows a bare «RouteFlow»
 *  in the tab, the same on every screen, which is the bug this test exists to keep fixed. */
const SETS_TITLE = /export (const metadata|async function generateMetadata)/;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

/** True when the page itself, or a layout between it and the root, sets metadata. */
function hasTitle(page: string): boolean {
  if (SETS_TITLE.test(readFileSync(page, "utf8"))) return true;
  for (let d = dirname(page); d !== "app"; d = dirname(d)) {
    const layout = join(d, "layout.tsx");
    if (existsSync(layout) && SETS_TITLE.test(readFileSync(layout, "utf8"))) return true;
  }
  return false;
}

// Only redirects, so no tab ever shows it.
const EXEMPT = new Set(["app/page.tsx"]);

describe("page titles", () => {
  const all = pages("app");

  it("finds the pages at all (guards the walker itself)", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("every page sets its own tab title", () => {
    const missing = all.filter((p) => !EXEMPT.has(p) && !hasTitle(p));
    expect(missing, `no title for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the root layout adds the app name through a template", () => {
    const root = readFileSync("app/layout.tsx", "utf8");
    expect(root).toMatch(/template: "%s · RouteFlow"/);
  });
});
