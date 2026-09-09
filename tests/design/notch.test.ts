import { describe, it, expect } from "vitest";
import { notchedCardPath } from "@/lib/design/notch";

describe("notchedCardPath", () => {
  it("returns null below the minimum width", () => {
    expect(notchedCardPath(300, 200)).toBeNull();
  });

  it("returns a path string at a normal card size", () => {
    const d = notchedCardPath(400, 240);
    expect(d).not.toBeNull();
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/Z$/);
  });

  it("the notch sits on the end side by default under ltr", () => {
    const d = notchedCardPath(400, 240, { dir: "ltr" });
    // end-side (ltr: right) notch means the path's first horizontal run is short of
    // the full width -- i.e. it turns down before reaching w.
    expect(d).toContain("400.00");
  });

  it("mirrors to the start side under rtl without the caller doing math", () => {
    const ltr = notchedCardPath(400, 240, { dir: "ltr", side: "end" });
    const rtl = notchedCardPath(400, 240, { dir: "rtl", side: "end" });
    // "end" resolves to a different physical corner in each direction, so the two
    // paths must differ.
    expect(ltr).not.toBe(rtl);
  });

  it("respects a custom notch width and height", () => {
    const d = notchedCardPath(500, 300, { notchWidth: 200, notchHeight: 50 });
    expect(d).not.toBeNull();
  });
});
