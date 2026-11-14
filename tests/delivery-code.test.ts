import { describe, it, expect } from "vitest";
import { deliveryCode, codeResult } from "@/lib/deliveryCode";
import { deliveryFlow, deliveryPayload } from "@/lib/flows/delivery";
import { startFlow, answerStep } from "@/lib/crm/flows/machine";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";

describe("delivery code (F120)", () => {
  it("is six digits, stable for an order, and different between orders and secrets", () => {
    const c = deliveryCode(7, "s");
    expect(c).toMatch(/^\d{6}$/);
    expect(deliveryCode(7, "s")).toBe(c);
    expect(deliveryCode(8, "s")).not.toBe(c);
    expect(deliveryCode(7, "t")).not.toBe(c);
  });
  it("reads Persian digits, and an empty answer is «no code», not «wrong»", () => {
    expect(codeResult("123456", "۱۲۳۴۵۶")).toBe(true);
    expect(codeResult("123456", " 123 456 ")).toBe(true);
    expect(codeResult("123456", "111111")).toBe(false);
    expect(codeResult("123456", "")).toBeNull();
    expect(codeResult("123456", null)).toBeNull();
  });
  it("the driver's flow asks for the code only when the customer wants one, and never blocks", () => {
    const items = [{ id: 1, label: "x", qty: 2, unit: "بسته", price: 100 }];
    const ctx = (needs: string): FlowContext => ({ ...EMPTY_CONTEXT, entry: "delivery", items, vars: { customer: "c", needs_code: needs } });
    let st = answerStep(deliveryFlow, ctx("0"), startFlow(deliveryFlow, ctx("0")), "yes");
    expect(st.stack.at(-1)).toBe("cash");
    st = answerStep(deliveryFlow, ctx("1"), startFlow(deliveryFlow, ctx("1")), "yes");
    expect(st.stack.at(-1)).toBe("code");
    const typed = answerStep(deliveryFlow, ctx("1"), st, "ok", "۱۲۳۴۵۶");
    expect(typed.stack.at(-1)).toBe("cash");
    expect(deliveryPayload(ctx("1"), answerStep(deliveryFlow, ctx("1"), typed, "full")).code).toBe("۱۲۳۴۵۶");
    const skipped = answerStep(deliveryFlow, ctx("1"), st, "none");
    expect(skipped.stack.at(-1)).toBe("cash");
    expect(deliveryPayload(ctx("1"), answerStep(deliveryFlow, ctx("1"), skipped, "full")).code).toBeUndefined();
  });
});
