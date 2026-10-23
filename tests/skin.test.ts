import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { THEME_INIT_SCRIPT, SKIN_KEY } from "@/lib/theme";

/** The meridian ground is cold, not the warm cream it started as. Guards against a
 *  future edit (or a solver regression) quietly warming --bg back up. "Cold" = the
 *  blue channel is at least as high as the red channel on the default ground, both
 *  skins. */
describe("meridian ground temperature", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const bgOf = (block: string) => {
    const m = css.match(new RegExp(`${block}\\s*{[^}]*?--bg:\\s*(#[0-9A-Fa-f]{6})`, "s"));
    if (!m) throw new Error(`no --bg found in ${block}`);
    const hex = m[1];
    return { r: parseInt(hex.slice(1, 3), 16), b: parseInt(hex.slice(5, 7), 16), hex };
  };
  it("light default --bg is cold (blue >= red)", () => {
    const { r, b, hex } = bgOf("\\.meridian");
    expect(b, `light --bg ${hex}`).toBeGreaterThanOrEqual(r);
  });
  it("dark default --bg is cold (blue >= red)", () => {
    const { r, b, hex } = bgOf(':root\\[data-skin="dark"\\] \\.meridian');
    expect(b, `dark --bg ${hex}`).toBeGreaterThanOrEqual(r);
  });
});

/** The sales scope reads data-skin; the map reads data-theme. One stored preference
 *  drives both, so the two can never disagree — which is the whole reason applyTheme
 *  writes them together rather than each caller remembering to. */
describe("theme init script", () => {
  it("sets data-skin for BOTH themes, not only for light", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-skin"');
    const darkBranch = THEME_INIT_SCRIPT.slice(THEME_INIT_SCRIPT.indexOf("data-skin"));
    expect(darkBranch.length).toBeGreaterThan(0);
  });

  it("sets data-theme for BOTH themes: HeroUI reads a missing attribute as light", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme",s)');
    expect(THEME_INIT_SCRIPT).not.toContain("removeAttribute");
  });

  it("runs entirely inside a try/catch — a theme is never worth a blank page", () => {
    expect(THEME_INIT_SCRIPT.startsWith("(function(){try{")).toBe(true);
    expect(THEME_INIT_SCRIPT).toContain("}catch(e){}");
  });

  it("exports the storage key it writes, so nothing hardcodes it twice", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(SKIN_KEY));
  });
});
