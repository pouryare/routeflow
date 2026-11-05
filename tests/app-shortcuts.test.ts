import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";
import { APP_SHORTCUTS } from "@/lib/mobileNav";

/** Icon shortcuts (Z14): each one is in the manifest and lands on a page that exists. */
describe("app icon shortcuts", () => {
  it("are all in the manifest", () => {
    expect(manifest().shortcuts?.map((s) => s.url)).toEqual(APP_SHORTCUTS.map((s) => s.href));
  });

  it("each open a real page with its flow parameter", () => {
    for (const s of APP_SHORTCUTS) {
      const [pathname, query] = s.href.split("?");
      expect(existsSync(path.join(__dirname, "..", "app", "(shell)", pathname, "page.tsx")), pathname).toBe(true);
      expect(query).toMatch(/^(new|quick)=1$/);
    }
  });
});
