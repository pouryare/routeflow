import { describe, it, expect } from "vitest";
import { press, quickAmounts, valueOf, keyFromEvent, MAX_DIGITS } from "@/lib/keypad";

describe("keypad", () => {
  it("builds a number digit by digit and backspaces", () => {
    let v = "";
    for (const k of ["1", "2", "5"] as const) v = press(v, k);
    expect(v).toBe("125");
    expect(press(v, "⌫")).toBe("12");
    expect(press("", "⌫")).toBe("");
  });

  it("has no leading zeros", () => {
    expect(press("", "0")).toBe("0");
    expect(press("0", "0")).toBe("0");
    expect(press("0", "7")).toBe("7");
  });

  it("«000» is for money: it adds three zeros, and does nothing on an empty or zero field", () => {
    expect(press("5", "000")).toBe("5000");
    expect(press("", "000")).toBe("");
    expect(press("0", "000")).toBe("0");
  });

  it("caps the length so a slip cannot make a billion", () => {
    const full = "1".repeat(MAX_DIGITS);
    expect(press(full, "1")).toBe(full);
    expect(press("1".repeat(MAX_DIGITS - 1), "000")).toBe("1".repeat(MAX_DIGITS - 1));
  });

  it("allows one decimal point, only when asked, and never twice", () => {
    expect(press("2", ".", true)).toBe("2.");
    expect(press("2.", "5", true)).toBe("2.5");
    expect(press("2.5", ".", true)).toBe("2.5");
    expect(press("2", ".", false)).toBe("2");
    expect(press("", ".", true)).toBe("0.");
    expect(press("2.5", "000", true)).toBe("2.5");
  });

  it("reads its value as a number", () => {
    expect(valueOf("")).toBeNaN();
    expect(valueOf("0.")).toBe(0);
    expect(valueOf("2.5")).toBe(2.5);
  });
});

describe("quick amounts", () => {
  it("offers the suggestion and the round numbers above it, ascending", () => {
    expect(quickAmounts(1_234_000)).toEqual([1_234_000, 1_250_000, 1_300_000, 1_500_000]);
  });
  it("does not repeat a number that is already round", () => {
    expect(quickAmounts(1_500_000)).toEqual([1_500_000]);
    expect(quickAmounts(800_000)).toEqual([800_000, 1_000_000]); // round to 100k already; next 500k is the only new one
  });
  it("scales the rounding to the size", () => {
    expect(quickAmounts(23_000)).toEqual([23_000, 25_000, 30_000, 50_000]);
    expect(quickAmounts(2_300)).toEqual([2_300, 2_500, 3_000, 5_000]);
    expect(quickAmounts(40)).toEqual([40]);
  });
  it("offers nothing for no suggestion", () => {
    expect(quickAmounts(0)).toEqual([]);
    expect(quickAmounts(NaN)).toEqual([]);
  });
});

describe("hardware keyboard", () => {
  it("maps digits, backspace, the point and enter; ignores the rest", () => {
    expect(keyFromEvent({ key: "7" })).toBe("7");
    expect(keyFromEvent({ key: "Backspace" })).toBe("⌫");
    expect(keyFromEvent({ key: "." })).toBe(".");
    expect(keyFromEvent({ key: "Enter" })).toBe("enter");
    expect(keyFromEvent({ key: "a" })).toBeNull();
    expect(keyFromEvent({ key: "Tab" })).toBeNull();
  });
});

import { display } from "@/lib/keypad";
describe("how the keypad reads on screen", () => {
  it("groups the integer part in Persian digits", () => {
    expect(display("1250000")).toBe("۱٬۲۵۰٬۰۰۰");
    expect(display("")).toBe("۰");
  });
  it("shows the fraction exactly as typed, including a trailing point and zero", () => {
    expect(display("2.")).toBe("۲٫");
    expect(display("2.0")).toBe("۲٫۰");
    expect(display("0.50")).toBe("۰٫۵۰");
  });
});
