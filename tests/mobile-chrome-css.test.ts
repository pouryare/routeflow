import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* The pill and the bar must never both show, and the bar must clear what it would cover. These
   are source-level guards for CSS, like the other walk-the-tree tests here. */
const css = readFileSync("app/globals.css", "utf8");
const phone = css.slice(css.indexOf("phone chrome: bottom bar"));

describe("the phone chrome", () => {
  it("the bar and the quick action are hidden by default and shown only below 768px", () => {
    expect(phone).toMatch(/\.meridian \.bottomnav, \.meridian \.qa-fab \{ display: none; \}/);
    const inQuery = phone.slice(phone.indexOf("@media (max-width: 767px)"));
    expect(inQuery).toMatch(/\.meridian \.bottomnav \{\s*display: flex; position: fixed/);
    expect(inQuery).toMatch(/\.meridian \.qa-fab \{\s*display: inline-flex/);
  });
  it("the desk pill is hidden in exactly that range, so the two never show together", () => {
    const inQuery = phone.slice(phone.indexOf("@media (max-width: 767px)"));
    expect(inQuery).toContain(".meridian .top > .segwrap { display: none; }");
  });
  it("fixed things sit under the sheets (z-index 70/71) and clear the home indicator", () => {
    for (const z of phone.match(/z-index: (\d+)/g) ?? []) expect(Number(z.split(": ")[1])).toBeLessThan(70);
    expect(phone.match(/env\(safe-area-inset-bottom\)/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("page content has room above the bar", () => {
    expect(phone).toMatch(/\.meridian \.app \{ padding-bottom: calc\(92px \+ env\(safe-area-inset-bottom\)\); \}/);
  });
  it("the sticky action is a normal button on a desk", () => {
    expect(phone).toMatch(/\.meridian \.sticky-action \{ padding: 8px 0; \}/);
  });
});

describe("found in a real 375px browser run", () => {
  it("a one-column answer list fills its sheet (it shrank to 108px inside the flex column)", () => {
    expect(css).toMatch(/\.tf-grid\.one \{[^}]*width: 100%/);
  });
  it("a chip row never widens its parent (the leads page went 952px wide and blank)", () => {
    expect(css).toMatch(/\.meridian \.filterchips \{ min-width: 0; max-width: 100%; \}/);
  });
  it("the floating «+ ثبت» button steps aside on a page with its own sticky primary bar", () => {
    expect(css).toMatch(/\.meridian:has\(\[data-has-primary-bar\]\) \.qa-fab \{ display: none; \}/);
  });
});

describe("order pipeline cards on a phone", () => {
  it("do not block touch scrolling (touch-action none was for the desktop drag)", () => {
    expect(css).toMatch(/@media \(max-width: 767\.98px\) \{\s*\.meridian \.board\.pipe \.task \{ touch-action: pan-y; \}/);
  });
});
