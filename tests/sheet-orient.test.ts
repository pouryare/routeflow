import { describe, it, expect } from "vitest";
import { DEFAULT_SHEET_ORIENT, parseSheetOrient } from "@/lib/sheetOrient";

describe("detail sheet side (FB5)", () => {
  it("opens at the bottom unless the person moved it to the side", () => {
    expect(DEFAULT_SHEET_ORIENT).toBe("bottom");
    expect(parseSheetOrient(null)).toBe("bottom");
    expect(parseSheetOrient("junk")).toBe("bottom");
    expect(parseSheetOrient("side")).toBe("side");
  });
});
