import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Why this file exists.
 *
 *  .route-fade (components/meridian/RouteFade.tsx) wraps every page in the shell, and its
 *  entrance keyframe animates `transform`. If the animation keeps filling after it ends
 *  (`both` / `forwards`), Chromium keeps treating the wrapper as transformed, so it becomes
 *  the containing block for every position:fixed descendant. The customer sheet on
 *  /sales/pocket hides itself at translateY(102%) below the viewport; with the wrapper as
 *  its containing block it sat at the bottom of the page instead — open with no customer
 *  chosen, and its close button did nothing because it was already "closed". No error, no
 *  warning, only a wrong-looking page, so it needs a test rather than a comment.
 */
describe("the route-fade entrance never outlives itself", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = css.match(/\.meridian \.route-fade\s*\{[^}]*animation:([^;}]*)/);

  it("has an animation rule", () => {
    expect(rule).not.toBeNull();
  });

  it("does not fill forwards", () => {
    expect(rule![1]).not.toMatch(/\b(both|forwards)\b/);
  });
});

describe("no entrance animation holds a transform after it ends", () => {
  /* The same trap in every other place it was set. Board cards, the map's customer panel,
     modal cards, sidebar items and toasts all entered with a transform keyframe filled
     `both`, which leaves `transform: translate(0)` / `scale(1)` applied forever and turns
     each of them into the containing block of any position:fixed child. An entrance
     ends on the element's resting style, so `backwards` is all it needs; exits keep `both`
     to hold the hidden frame until they unmount. */
  const css = readFileSync("app/globals.css", "utf8");
  const moves = new Set(
    Array.from(css.matchAll(/@keyframes\s+([\w-]+-in)\s*\{([\s\S]*?)\n\}/g))
      .filter((m) => /transform|translate|scale/.test(m[2]))
      .map((m) => m[1]),
  );

  it("finds the entrance keyframes it guards", () => {
    expect(moves.size).toBeGreaterThan(3);
  });

  it("fills none of them forwards", () => {
    const bad = Array.from(css.matchAll(/animation:\s*([\w-]+)([^;}]*)/g))
      .filter((m) => moves.has(m[1]) && /\b(both|forwards)\b/.test(m[2]))
      .map((m) => m[0].trim());
    expect(bad, `entrance animations that keep their transform: ${bad.join(" | ")}`).toEqual([]);
  });
});
