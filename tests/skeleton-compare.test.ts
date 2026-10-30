import { describe, it, expect } from "vitest";
import { sameCapture } from "../scripts/skeleton-compare.mjs";

const layout = (bones: unknown[][], height = 400) => ({ height, bones });
const page = (phone = layout([[0, 10, 100, 50, 12, 1], [5, 20, 40, 20, 8]]), desktop?: ReturnType<typeof layout>) => ({
  route: "/crm",
  phone,
  desktop,
});

/** The recapture workflow commits only when a page really changed: pixel jitter keeps the stored file. */
describe("sameCapture", () => {
  it("treats a one-pixel wobble as the same page", () => {
    expect(sameCapture(page(), page(layout([[0, 11, 100, 49, 12, 1], [5.4, 22, 40.5, 20, 8]], 401)))).toBe(true);
  });
  it("sees a box that moved more than the tolerance", () => {
    expect(sameCapture(page(), page(layout([[0, 10, 100, 50, 12, 1], [5, 30, 40, 20, 8]])))).toBe(false);
  });
  it("sees a box that appeared or turned into a card", () => {
    expect(sameCapture(page(), page(layout([[0, 10, 100, 50, 12, 1]])))).toBe(false);
    expect(sameCapture(page(), page(layout([[0, 10, 100, 50, 12, 1], [5, 20, 40, 20, 8, 1]])))).toBe(false);
  });
  it("sees a desktop layout that appeared", () => {
    expect(sameCapture(page(), page(undefined, layout([[0, 0, 100, 10, 8]])))).toBe(false);
  });
});
