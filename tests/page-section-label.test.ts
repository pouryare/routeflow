import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The small label above a page title names the page's menu section in Persian (owner, 2026-11-10). */
describe("the page card's section label", () => {
  it("comes from the menu group of the page's tab, and only for pages in the menu", () => {
    const src = readFileSync("components/meridian/PageHeader.tsx", "utf8");
    expect(src).toMatch(/const section = hit \? APP_GROUPS\.find\(\(g\) => g\.id === hit\.group\)\?\.label : undefined;/);
    expect(src).toMatch(/section=\{section\}/);
  });
  it("no page keeps an English label above its Persian title", () => {
    for (const f of ["planner", "leads", "report", "gallery", "facilities"]) {
      const src = readFileSync(`app/(shell)/${f}/page.tsx`, "utf8");
      expect(src).not.toMatch(/uppercase tracking-\[0\.12em\]/);
      expect(src).not.toMatch(/Route Planner|Prospect Locations|Coverage Report|>\s*Gallery\s*<|Our Sites/);
    }
  });
});
