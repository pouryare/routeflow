import { describe, it, expect } from "vitest";
import { THEME_INIT_SCRIPT, SKIN_KEY } from "@/lib/theme";

/** The sales scope reads data-skin; the map reads data-theme. One stored preference
 *  drives both, so the two can never disagree — which is the whole reason applyTheme
 *  writes them together rather than each caller remembering to. */
describe("theme init script", () => {
  it("sets data-skin for BOTH themes, not only for light", () => {
    // dark removes data-theme, so data-skin is the only signal .meridian has
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-skin"');
    const darkBranch = THEME_INIT_SCRIPT.slice(THEME_INIT_SCRIPT.indexOf("data-skin"));
    expect(darkBranch.length).toBeGreaterThan(0);
  });

  it("still sets data-theme for light so the map is unaffected", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme","light")');
  });

  it("runs entirely inside a try/catch — a theme is never worth a blank page", () => {
    expect(THEME_INIT_SCRIPT.startsWith("(function(){try{")).toBe(true);
    expect(THEME_INIT_SCRIPT).toContain("}catch(e){}");
  });

  it("exports the storage key it writes, so nothing hardcodes it twice", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(SKIN_KEY));
  });
});
