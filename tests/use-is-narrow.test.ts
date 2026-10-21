import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NARROW_QUERY } from "@/lib/useIsNarrow";

describe("what counts as a phone", () => {
  it("is one query, shared by the hook and the stylesheet", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(`@media ${NARROW_QUERY}`);
  });
  it("has no effect-and-state flash: the hook reads the media query as an external store", () => {
    const src = readFileSync("lib/useIsNarrow.ts", "utf8");
    expect(src).toContain("useSyncExternalStore");
    expect(src).not.toMatch(/useEffect|useState/);
  });
  it("the board no longer chooses its layout in JS", () => {
    const board = readFileSync("components/board/Board.tsx", "utf8");
    expect(board).not.toContain("useIsNarrow");
    expect(board).toContain("board-mobile");
    expect(board).toContain("board-desktop");
  });
});
