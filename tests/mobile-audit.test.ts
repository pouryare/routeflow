import { describe, it, expect } from "vitest";

const { countRules } = await import("../scripts/mobile-audit.mjs");

describe("mobile audit counters", () => {
  const src = `<select><option/></select><input type="date"/><button className="py-[2px]">x</button>
               <textarea/> {confirm("sure?")} onConfirm(x)`;
  it("counts each rule once per occurrence", () => {
    expect(countRules(src)).toEqual({ select: 1, nativeDate: 1, textField: 2, tinyTarget: 1, confirmDialog: 1 });
  });
  it("does not count onConfirm(...) as confirm(...)", () => {
    expect(countRules("onConfirm(x)").confirmDialog).toBe(0);
  });
  it("counts window.confirm but not a method named .confirm on an object", () => {
    expect(countRules("window.confirm('x')").confirmDialog).toBe(1);
    expect(countRules("modal.confirm('x')").confirmDialog).toBe(0);
  });
});

import { countTinyTargets } from "../scripts/mobile-audit.mjs";

describe("tiny tap targets are counted on controls only", () => {
  it("a small button counts, a badge with the same padding does not", () => {
    expect(countTinyTargets('<button className="px-2 py-0.5">x</button>')).toBe(1);
    expect(countTinyTargets('<span className="px-2 py-0.5">x</span>')).toBe(0);
  });
  it("a control lifted by the touch utility or a 44px minimum does not count", () => {
    expect(countTinyTargets('<button className="px-2 py-0.5 touch">x</button>')).toBe(0);
    expect(countTinyTargets('<a className="py-[2px] min-h-[44px]">x</a>')).toBe(0);
  });
  it("an arrow function in the attributes does not end the tag early", () => {
    expect(countTinyTargets('<button onClick={() => go()} className="py-0.5 touch">x</button>')).toBe(0);
    expect(countTinyTargets('<button onClick={() => go()} className="py-0.5">x</button>')).toBe(1);
  });
});
