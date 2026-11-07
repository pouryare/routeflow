import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONTRAST_KEY, CONTRAST_INIT_SCRIPT } from "@/lib/contrast";

const CSS = readFileSync("app/globals.css", "utf8");

describe("high contrast", () => {
  it("is applied before first paint from the stored key", () => {
    expect(CONTRAST_INIT_SCRIPT).toContain(CONTRAST_KEY);
    expect(CONTRAST_INIT_SCRIPT).toContain('"data-contrast","high"');
  });

  it("has a light and a dark rule in the stylesheet", () => {
    expect(CSS).toContain(':root[data-contrast="high"] .meridian {');
    expect(CSS).toContain(':root[data-contrast="high"][data-skin="dark"] .meridian');
  });
});
