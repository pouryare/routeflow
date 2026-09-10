import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Item 1. The user asked for the logo to go, and removing it is what lets seven group
 *  chips and the action cluster share one row. A brand block that creeps back pushes the
 *  nav onto a second row again, silently, at every width. */
describe("the header is one row", () => {
  const header = read("components/meridian/AppHeader.tsx");
  const skeleton = read("components/meridian/HeaderSkeleton.tsx");

  it("carries no brand mark, wordmark or date", () => {
    for (const src of [header, skeleton]) {
      expect(src).not.toMatch(/brandwrap|className="mark"|<h1|faJalaliLong/);
    }
  });

  it("puts the nav inside .top, before the actions", () => {
    const top = header.indexOf('className="top"');
    const nav = header.indexOf("<HoverPill");
    const actions = header.indexOf('className="topright"');
    expect(top).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(top);
    expect(actions).toBeGreaterThan(nav);
  });

  it("the date moved to the page-overview card rather than disappearing", () => {
    expect(read("components/meridian/PageHeader.tsx")).toMatch(/faJalaliLong/);
    expect(read("components/meridian/PageHeaderCard.tsx")).toMatch(/phc__date/);
  });

  it("the brand-block CSS is gone with it", () => {
    const css = read("app/globals.css");
    expect(css).not.toMatch(/\.meridian \.brandwrap|\.meridian \.mark\b|\.meridian \.top h1|\.meridian \.top \.sub/);
  });
});

/** Item 13. The thumb's height is the row padding plus the chip's block padding plus one
 *  line of text; at 5px + 8px it came out ~36px behind a ~71px chip, and a short label
 *  read as a circle. Pin both paddings so a well-meant "more breathing room" cannot undo
 *  it. The geometric twin in tests/smoke measures the result. */
describe("group chips are pills, not circles", () => {
  const css = read("app/globals.css");
  it("the group row pads 3px, and its thumb insets to match", () => {
    expect(css).toMatch(/\.meridian \.seg\.seg-groups \{[^}]*padding: 3px/);
    expect(css).toMatch(/\.meridian \.seg-groups \.thumb \{[^}]*top: 3px; bottom: 3px/);
  });
  it("a group chip pads 5px on the block axis", () => {
    expect(css).toMatch(/\.meridian \.seg-groups > \.seg-item > a \{[^}]*padding-block: 5px/);
  });
});
