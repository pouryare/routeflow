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
