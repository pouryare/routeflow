import { describe, it, expect } from "vitest";
import { THEME_INIT_SCRIPT, SKIN_KEY } from "@/lib/theme";

/** data-theme is the primary signal since the 2026-09-08 substrate promotion (the whole
 *  app now reads one :root / :root[data-theme="dark"] pair); data-skin mirrors it only
 *  because the accent-theme generator's map-relevant dark variants still key on it (see
 *  lib/theme.ts's SKIN_KEY comment) and have not been migrated. Both are written from
 *  one script so they can never disagree.
 *
 *  Unlike the pre-redesign script, data-theme is now written EXPLICITLY for BOTH
 *  resolved values, not only for light -- several CSS rules key on [data-theme="light"]
 *  being present, and light is the default besides. */
describe("theme init script", () => {
  it("sets data-theme to the resolved value unconditionally, not only for light", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme",resolved)');
  });

  it("sets data-skin to the same resolved value, for the accent-theme generator", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-skin",resolved)');
  });

  it("resolves auto from the OS preference, live, not a frozen first-run guess", () => {
    expect(THEME_INIT_SCRIPT).toContain("prefersLight");
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: light");
  });

  it("pins /driver away from auto, defaulting dark", () => {
    expect(THEME_INIT_SCRIPT).toContain("/driver");
    expect(THEME_INIT_SCRIPT).toContain("isDriver");
  });

  it("runs entirely inside a try/catch — a theme is never worth a blank page", () => {
    expect(THEME_INIT_SCRIPT.startsWith("(function(){try{")).toBe(true);
    expect(THEME_INIT_SCRIPT).toContain("}catch(e){}");
  });

  it("exports the storage key it writes, so nothing hardcodes it twice", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(SKIN_KEY));
  });
});
