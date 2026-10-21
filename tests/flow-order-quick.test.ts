import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { checkFlow } from "@/lib/crm/flows/validate";
import {
  orderQuickFlow, orderRequest, orderTotal, orderLines, orderChips, orderLastSummary,
} from "@/lib/flows/orderQuick";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

/* Packaging ids are the item ids; `parent` is the product. Prices are the CURRENT catalogue
   price per pack, not what the last order paid. */
const items = [
  { id: 101, parent: 11, label: "شیر · کارتن", qty: 10, max: 999, price: 60000 },
  { id: 202, parent: 12, label: "ماست · بسته", qty: 6, max: 999, price: 100000 },
];
const base: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "order_quick",
  recentCustomers: [{ id: 5, name: "بقالی رضا" }, { id: 6, name: "نانوایی سنگک" }],
  items,
  vars: { today: "2026-10-21", last: "ready", last_summary: "آخرین سفارش · شیر ۱۰، ماست ۶", debt: "0" },
};
const known: FlowContext = { ...base, vars: { ...base.vars, customer_id: "5", customer: "بقالی رضا" } };

describe("repeat-order flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(orderQuickFlow, [
      { ctx: known, values: { adjust: JSON.stringify({ 101: 1, 202: 1 }), day_pick: "2026-10-30" } },
      { ctx: base, values: { who: "5", adjust: JSON.stringify({ 101: 1, 202: 1 }), day_pick: "2026-10-30" } },
    ], { common: 5, longest: 9 });
    assertNoRawEnumLabels(orderQuickFlow);
  });

  it("«same as last time» for a known customer is 3 taps and posts the last lines", () => {
    let st = startFlow(orderQuickFlow, known);
    expect(viewStep(orderQuickFlow, known, st).id).toBe("same");
    st = answerStep(orderQuickFlow, known, st, "yes");
    st = answerStep(orderQuickFlow, known, st, "soonest");
    st = answerStep(orderQuickFlow, known, st, "ok");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(3);
    expect(orderRequest(known, st)).toEqual({
      customer_id: 5,
      order_date: "2026-10-21",
      requested_day: null,
      requested_kind: "soonest",
      salesperson_user_id: null,
      notes: null,
      credit_override: false,
      lines: [
        { product_id: 11, packaging_id: 101, packs: 10 },
        { product_id: 12, packaging_id: 202, packs: 6 },
      ],
    });
  });

  it("the summary shows what last time was, so «yes» is an informed tap", () => {
    expect(viewStep(orderQuickFlow, known, startFlow(orderQuickFlow, known)).sub).toContain("شیر ۱۰");
  });

  it("changing quantities may go UP, drops lines that reach zero, and recomputes the total", () => {
    let st = startFlow(orderQuickFlow, known);
    st = answerStep(orderQuickFlow, known, st, "change");
    st = answerStep(orderQuickFlow, known, st, "ok", JSON.stringify({ 101: 25, 202: 0 }));
    expect(orderLines(known, st)).toEqual([{ product_id: 11, packaging_id: 101, packs: 25 }]);
    expect(orderTotal(known, st)).toBe(25 * 60000);
  });

  it("an adjustment that removes everything cannot be saved; it asks to go back", () => {
    let st = startFlow(orderQuickFlow, known);
    st = answerStep(orderQuickFlow, known, st, "change");
    st = answerStep(orderQuickFlow, known, st, "ok", JSON.stringify({ 101: 0, 202: 0 }));
    expect(viewStep(orderQuickFlow, known, st).id).toBe("empty");
    st = answerStep(orderQuickFlow, known, st, "back");
    expect(viewStep(orderQuickFlow, known, st).id).toBe("adjust");
  });

  it("delivery days: tomorrow and the day after are exact dates; next week keeps its kind", () => {
    const run = (dayId: string) => {
      let st = startFlow(orderQuickFlow, known);
      st = answerStep(orderQuickFlow, known, st, "yes");
      st = answerStep(orderQuickFlow, known, st, dayId);
      st = answerStep(orderQuickFlow, known, st, "ok");
      return orderRequest(known, st);
    };
    expect(run("tomorrow")).toMatchObject({ requested_day: "2026-10-22", requested_kind: "exact_date" });
    expect(run("after")).toMatchObject({ requested_day: "2026-10-23", requested_kind: "exact_date" });
    expect(run("week")).toMatchObject({ requested_day: "2026-10-28", requested_kind: "week_offset" });
  });

  it("a day picked from the calendar is an exact date", () => {
    let st = startFlow(orderQuickFlow, known);
    st = answerStep(orderQuickFlow, known, st, "yes");
    st = answerStep(orderQuickFlow, known, st, "other");
    expect(viewStep(orderQuickFlow, known, st).id).toBe("day_pick");
    st = answerStep(orderQuickFlow, known, st, "ok", "2026-11-05");
    st = answerStep(orderQuickFlow, known, st, "ok");
    expect(orderRequest(known, st)).toMatchObject({ requested_day: "2026-11-05", requested_kind: "exact_date" });
  });

  it("asks who first when the screen does not know", () => {
    let st = startFlow(orderQuickFlow, base);
    expect(viewStep(orderQuickFlow, base, st).id).toBe("who");
    st = answerStep(orderQuickFlow, base, st, "pick", "6");
    st = answerStep(orderQuickFlow, base, st, "yes");
    st = answerStep(orderQuickFlow, base, st, "soonest");
    st = answerStep(orderQuickFlow, base, st, "ok");
    expect(orderRequest(base, st).customer_id).toBe(6);
  });

  it("a customer with no previous order is offered only the full form", () => {
    const none = { ...known, items: [], vars: { ...known.vars, last: "none" } };
    const v = viewStep(orderQuickFlow, none, startFlow(orderQuickFlow, none));
    expect(v.options.map((o) => o.id)).toEqual(["full"]);
    expect(v.sub).toContain("سفارش قبلی ندارد");
  });

  it("while the last order is still loading, nothing is offered that could be wrong", () => {
    const loading = { ...known, items: [], vars: { ...known.vars, last: "loading" } };
    const v = viewStep(orderQuickFlow, loading, startFlow(orderQuickFlow, loading));
    expect(v.options.map((o) => o.id)).toEqual(["wait"]);
  });

  it("«سفارش تازه» leaves the flow without a request", () => {
    const st = answerStep(orderQuickFlow, known, startFlow(orderQuickFlow, known), "full");
    expect(st.saved).toBe(true);
    expect(st.values.exit).toBe("full");
  });

  it("going over the credit limit is warned about and recorded as an override, never blocked", () => {
    const over = { ...known, vars: { ...known.vars, debt: "2000000", credit_limit: "2500000" } };
    let st = startFlow(orderQuickFlow, over);
    st = answerStep(orderQuickFlow, over, st, "yes");
    st = answerStep(orderQuickFlow, over, st, "soonest");
    const v = viewStep(orderQuickFlow, over, st);
    expect(v.id).toBe("confirm");
    expect(v.sub).toContain("سقف اعتبار");
    st = answerStep(orderQuickFlow, over, st, "ok");
    expect(orderRequest(over, st).credit_override).toBe(true);
  });

  it("within the limit there is no warning and no override", () => {
    const within = { ...known, vars: { ...known.vars, debt: "0", credit_limit: "50000000" } };
    let st = startFlow(orderQuickFlow, within);
    st = answerStep(orderQuickFlow, within, st, "yes");
    st = answerStep(orderQuickFlow, within, st, "soonest");
    expect(viewStep(orderQuickFlow, within, st).sub).not.toContain("سقف اعتبار");
    st = answerStep(orderQuickFlow, within, st, "ok");
    expect(orderRequest(within, st).credit_override).toBe(false);
  });

  it("the confirm question states that this saves a DRAFT to confirm on the order's page", () => {
    let st = startFlow(orderQuickFlow, known);
    st = answerStep(orderQuickFlow, known, st, "yes");
    st = answerStep(orderQuickFlow, known, st, "soonest");
    expect(viewStep(orderQuickFlow, known, st).sub).toContain("پیش‌نویس");
  });

  it("the done screen lists customer, lines, total and delivery day", () => {
    let st = startFlow(orderQuickFlow, known);
    st = answerStep(orderQuickFlow, known, st, "yes");
    st = answerStep(orderQuickFlow, known, st, "tomorrow");
    st = answerStep(orderQuickFlow, known, st, "ok");
    const c = orderChips(known, st).join(" | ");
    expect(c).toContain("بقالی رضا");
    expect(c).toContain("۱٬۲۰۰٬۰۰۰");
    expect(c).toContain("۲ قلم");
  });

  it("builds the one-line recap of the last order from its lines", () => {
    expect(orderLastSummary("1405/07/20", [{ label: "شیر", packs: 10 }, { label: "ماست", packs: 6 }], 1200000))
      .toContain("شیر ۱۰");
  });

  it("every path ends: the adjust/empty loop is the only cycle", () => {
    const r = checkFlow(orderQuickFlow, [{ ctx: known, values: { adjust: JSON.stringify({ 101: 1 }), day_pick: "2026-11-05" } }]);
    expect(r.deadEnds).toEqual([]);
  });
});
