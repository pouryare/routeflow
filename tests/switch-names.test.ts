import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** A switch or row checkbox with no visible words gets its name from `label`. It has to sit on
 *  the HeroUI root, which passes it to the input; on `.Content` it named a span, and every such
 *  control reached a screen reader nameless (axe "label", 30 on /settings/notifications). */
describe("label-only switches and checkboxes are named on their input", () => {
  it.each([
    ["components/ToggleSwitch.tsx", /className="toggle" aria-label=\{label\}>/, /<Switch\.Content aria-label/],
    ["components/CheckField.tsx", /<Checkbox [^>]*aria-label=\{label\}/, /<Checkbox\.Content aria-label/],
  ])("%s", (file, good, bad) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(good);
    expect(src).not.toMatch(bad);
  });
});
