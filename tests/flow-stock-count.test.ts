import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import {
  stockCountFlow, countMovement, countDiff, countChips, countWritesNothing,
} from "@/lib/flows/stockCount";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx = (expected: number): FlowContext => ({
  ...EMPTY_CONTEXT,
  entry: "stock_count",
  vars: { product: "شیر ۱ لیتری", product_id: "9", facility_id: "3", facility: "انبار مرکزی", expected: String(expected), count: String(expected), count_unit: "عدد", unit: "عدد" },
});

describe("stock count flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(stockCountFlow, [{ ctx: ctx(12), values: { count: "10" } }, { ctx: ctx(12), values: { count: "15" } }, { ctx: ctx(12), values: { count: "12" } }]);
    assertNoRawEnumLabels(stockCountFlow);
  });

  it("«درست است» is one tap and writes nothing", () => {
    const c = ctx(12);
    const st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "ok");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(1);
    expect(countWritesNothing(st)).toBe(true);
    expect(countMovement(c, st)).toBeNull();
  });

  it("a shortfall explained as damage is a WRITE_OFF of exactly the difference", () => {
    const c = ctx(12);
    let st = startFlow(stockCountFlow, c);
    st = answerStep(stockCountFlow, c, st, "diff");
    st = answerStep(stockCountFlow, c, st, "ok", "9");
    expect(viewStep(stockCountFlow, c, st).id).toBe("why");
    st = answerStep(stockCountFlow, c, st, "damaged");
    expect(st.saved).toBe(true);
    expect(countMovement(c, st)).toEqual({
      facility_id: 3, product_id: 9, batch_id: null, base_qty: -3, kind: "WRITE_OFF", notes: "شمارش انبار · خراب شده",
    });
  });

  it("each reason for a shortfall maps to its own movement kind", () => {
    const kinds: Record<string, string> = { damaged: "WRITE_OFF", expired: "WRITE_OFF", sample: "SAMPLE_OUT", lost: "COUNT" };
    for (const [id, kind] of Object.entries(kinds)) {
      const c = ctx(12);
      let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "diff");
      st = answerStep(stockCountFlow, c, st, "ok", "10");
      st = answerStep(stockCountFlow, c, st, id);
      expect(countMovement(c, st)?.kind).toBe(kind);
      expect(countMovement(c, st)?.base_qty).toBe(-2);
    }
  });

  it("a surplus is a positive adjustment or a corrected count, never a write-off", () => {
    const c = ctx(12);
    let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "diff");
    st = answerStep(stockCountFlow, c, st, "ok", "15");
    const ids = viewStep(stockCountFlow, c, st).options.map((o) => o.id);
    expect(ids).toEqual(["unlogged", "miscount"]);
    st = answerStep(stockCountFlow, c, st, "unlogged");
    expect(countMovement(c, st)).toMatchObject({ base_qty: 3, kind: "ADJUSTMENT" });
  });

  it("«چیزی نمانده» goes straight to why, with the whole balance as the shortfall", () => {
    const c = ctx(12);
    let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "empty");
    expect(viewStep(stockCountFlow, c, st).id).toBe("why");
    st = answerStep(stockCountFlow, c, st, "lost");
    expect(countMovement(c, st)).toMatchObject({ base_qty: -12, kind: "COUNT" });
  });

  it("typing the same number as the system says is not a difference", () => {
    const c = ctx(12);
    let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "diff");
    st = answerStep(stockCountFlow, c, st, "ok", "12");
    expect(viewStep(stockCountFlow, c, st).options.map((o) => o.id)).toEqual(["nodiff"]);
    st = answerStep(stockCountFlow, c, st, "nodiff");
    expect(countMovement(c, st)).toBeNull();
  });

  it("fractional counts keep their fractions and do not drift", () => {
    const c = ctx(2.5);
    let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "diff");
    st = answerStep(stockCountFlow, c, st, "ok", "2.2");
    st = answerStep(stockCountFlow, c, st, "damaged");
    expect(countMovement(c, st)?.base_qty).toBe(-0.3);
    expect(countDiff(0.3, 0.1)).toBe(0.2);
  });

  it("«بعداً می‌شمارم» writes nothing and is reported as skipped", () => {
    const c = ctx(12);
    const st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "later");
    expect(countMovement(c, st)).toBeNull();
    expect(countChips(c, st)).toContain("شمرده نشد");
  });

  it("the done line states the product, the counted number and the difference", () => {
    const c = ctx(12);
    let st = answerStep(stockCountFlow, c, startFlow(stockCountFlow, c), "diff");
    st = answerStep(stockCountFlow, c, st, "ok", "9");
    st = answerStep(stockCountFlow, c, st, "expired");
    const chips = countChips(c, st).join(" | ");
    expect(chips).toContain("شیر ۱ لیتری");
    expect(chips).toContain("۹");
    expect(chips).toContain("تاریخ مصرف گذشته");
  });
});
