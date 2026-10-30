import { describe, expect, it } from "vitest";
import { boxTransform, stretchPath } from "@/lib/pillSlide";

describe("stretchPath", () => {
  it("stretches over both places on the way, in either direction", () => {
    const a = { left: 10, top: 0, width: 40 };
    const b = { left: 200, top: 0, width: 60 };
    expect(stretchPath(a, b)[1]).toEqual({ left: 10, top: 0, width: 250 });
    // RTL: moving leftwards gives the same span.
    expect(stretchPath(b, a)[1]).toEqual({ left: 10, top: 0, width: 250 });
  });

  it("starts where it was and ends where it lands", () => {
    const a = { left: 0, top: 0, width: 10 };
    const b = { left: 50, top: 20, width: 30 };
    const [first, , last] = stretchPath(a, b);
    expect(first).toBe(a);
    expect(last).toBe(b);
  });
});

describe("boxTransform", () => {
  it("is the identity at the landing box", () => {
    const b = { left: 50, top: 20, width: 30 };
    expect(boxTransform(b, b)).toBe("translate(0px, 0px) scaleX(1)");
  });

  it("moves and scales from the landing box to another", () => {
    expect(boxTransform({ left: 0, top: 0, width: 60 }, { left: 100, top: 10, width: 30 }))
      .toBe("translate(-100px, -10px) scaleX(2)");
  });
});
