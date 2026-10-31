import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Calendar, I18nProvider } from "@heroui/react";
import { HEROUI_LOCALE } from "@/components/HeroUIProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
const { HERO_OVERLAYS, HERO_OVERLAY_REASONS, heroOverlayImporters } = await import("../scripts/check-mobile-rules.mjs");

const css = readFileSync("app/globals.css", "utf8");

/** The HeroUI foundation (docs/decisions.md §10). Each guard is here because the thing it
 *  protects fails silently: a short button still renders, a light token still paints. */
describe("HeroUI setup", () => {
  it("imports HeroUI's styles part by part, never the whole sheet", () => {
    // The full sheet styles .card/.chip/.badge/.modal/.skeleton, which this app already uses.
    expect(css).not.toMatch(/@import\s+"@heroui\/styles"\s*;/);
    expect(css).toContain('@import "@heroui/styles/themes/default" layer(theme);');
    expect(css).toContain('@import "@heroui/styles/components/button.css" layer(components);');
  });

  it("lifts HeroUI buttons to 44 px to tap and 52 px to answer", () => {
    expect(css).toMatch(/\.button, \.button--sm, \.button--md \{ height: 44px;/);
    expect(css).toMatch(/\.button--lg \{ height: 52px;/);
  });

  it("the size rules are unlayered, after the imports, so they beat HeroUI's layered ones", () => {
    const rule = css.indexOf(".button, .button--sm, .button--md");
    const lastImport = css.lastIndexOf("@import");
    expect(rule).toBeGreaterThan(lastImport);
  });

  it("writes data-theme for dark as well, because HeroUI reads a missing one as light", () => {
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme",s)');
  });

  it("renders the Persian calendar with Persian digits", () => {
    const html = renderToStaticMarkup(
      // createElement's typing wants children in the props object; JSX is not available in a .ts test.
      createElement(I18nProvider, { locale: HEROUI_LOCALE } as { locale: string; children: never }, createElement(Calendar, { "aria-label": "روز" })),
    );
    // A Shamsi year (۱۴xx) in Persian digits, not a Gregorian one.
    expect(html).toMatch(/۱۴[۰-۹]{2}/);
    expect(html).not.toMatch(/20[0-9]{2}/);
  });

  it("a large button carries the class the 52 px rule targets", () => {
    const html = renderToStaticMarkup(createElement(Button, { size: "lg" }, "ثبت"));
    expect(html).toContain("button--lg");
  });

  it("only the files with a written reason import a HeroUI overlay or dropdown", () => {
    expect(HERO_OVERLAYS).toContain("Modal");
    expect(heroOverlayImporters()).toEqual(Object.keys(HERO_OVERLAY_REASONS).sort());
    for (const why of Object.values(HERO_OVERLAY_REASONS)) expect(String(why).length).toBeGreaterThan(20);
  });
});
