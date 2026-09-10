import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** No card wears a coloured hairline across its top edge.
 *
 *  The user asked for this twice, on two different pages, and added: "there are multiple
 *  errors ... that exist on multiple places, i only mentioned it once." It was one rule
 *  riding five selectors — which is exactly why spotting it on /sales/products said
 *  nothing about /sales/pocket.
 *
 *  The first check is shaped as "a zero-inset full-width hairline pseudo-element" rather
 *  than as the five class names, so re-adding the same device under a new name still
 *  fails. The second names the five anyway, because a shape-matcher that quietly stops
 *  matching is the failure mode of the first.
 */
const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

describe("no top accent bar on cards", () => {
  it("defines no zero-inset hairline ::after inside .meridian", () => {
    /* Tolerant of property order and whitespace: any ::after rule that pins itself to the
       block start, spans the inline axis, and is 1-4px tall. */
    const block = /::after\s*\{[^}]*inset-block-start:\s*0[^}]*height:\s*[1-4]px[^}]*\}/g;
    expect(CSS.match(block) ?? []).toEqual([]);
  });

  it("no longer selects the five card classes for a bar", () => {
    for (const sel of [
      ".kbar::after",
      ".gcard::after",
      ".prow::after",
      ".ptile::after",
      ".task::after",
    ]) {
      expect(CSS.includes(sel), `${sel} should be gone`).toBe(false);
    }
  });

  it("keeps the pocket slip's coloured edge — a different device the user asked to keep", () => {
    /* «do not remove the "two cards behind the main cards" i love that». The slip's
       border-top is what makes the card behind visible; it is a different rule at
       different lines from the accent bar, and deleting it while removing the bar would
       take out the thing that was explicitly protected. */
    expect(CSS).toMatch(/\.pocketed\[data-tone="good"\] \.pocketed__slip/);
  });
});
