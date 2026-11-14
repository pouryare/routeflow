import { describe, it, expect } from "vitest";
import { answerStep, startFlow } from "@/lib/crm/flows/machine";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { doorChips, doorRequest, doorSaleFlow } from "@/lib/flows/doorSale";
import { parseDoorRequest } from "@/lib/doorSaleRequest";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  recentCustomers: [{ id: 7, name: "رستوران (C7)" }],
  items: [
    { id: 11, parent: 1, label: "کره · جعبه", qty: 0, max: 5, unit: "بسته", price: 5_000 },
    { id: 12, parent: 2, label: "پنیر · جعبه", qty: 0, max: 3, unit: "بسته" },
  ],
  vars: { customer_id: "7", customer: "رستوران", debt: "0" },
};

describe("the door sale flow", () => {
  it("a sale: shop fixed, sale, packs, cash in full saves the request the route expects", () => {
    let st = startFlow(doorSaleFlow, ctx);
    expect(st.stack).toEqual(["mode"]);
    st = answerStep(doorSaleFlow, ctx, st, "sale");
    st = answerStep(doorSaleFlow, ctx, st, "ok", JSON.stringify({ 11: 2, 12: 0 }));
    expect(st.stack.at(-1)).toBe("pay");
    st = answerStep(doorSaleFlow, ctx, st, "cash");
    expect(st.saved).toBe(true);
    expect(doorRequest(ctx, st, "u-1")).toEqual({
      url: "/api/driver/door-sale",
      body: { customer_id: 7, lines: [{ product_id: 1, packaging_id: 11, packs: 2 }], client_uuid: "u-1", collected_toman: 10_000 },
    });
    expect(doorChips(ctx, st)).toContain("نقد");
  });

  it("on account sends zero cash; a typed amount is sent as typed", () => {
    const run = (opt: string, amount?: string) => {
      let st = answerStep(doorSaleFlow, ctx, startFlow(doorSaleFlow, ctx), "sale");
      st = answerStep(doorSaleFlow, ctx, st, "ok", JSON.stringify({ 11: 1 }));
      st = answerStep(doorSaleFlow, ctx, st, opt);
      if (amount !== undefined) st = answerStep(doorSaleFlow, ctx, st, "ok", amount);
      return (doorRequest(ctx, st, "u-2").body as { collected_toman: number }).collected_toman;
    };
    expect(run("credit")).toBe(0);
    expect(run("other", "3000")).toBe(3000);
  });

  it("nothing chosen is refused, and an unpriced product cannot be sold", () => {
    const st = answerStep(doorSaleFlow, ctx, startFlow(doorSaleFlow, ctx), "sale");
    expect(answerStep(doorSaleFlow, ctx, st, "ok", JSON.stringify({ 11: 0 })).stack.at(-1)).toBe("empty");
    expect(answerStep(doorSaleFlow, ctx, st, "ok", JSON.stringify({ 12: 1 })).stack.at(-1)).toBe("unpriced");
  });

  it("a sample goes to the samples route, may include an unpriced product, and takes no money", () => {
    let st = answerStep(doorSaleFlow, ctx, startFlow(doorSaleFlow, ctx), "sample");
    st = answerStep(doorSaleFlow, ctx, st, "ok", JSON.stringify({ 12: 1 }));
    expect(st.stack.at(-1)).toBe("sample_ok");
    st = answerStep(doorSaleFlow, ctx, st, "ok");
    const req = doorRequest(ctx, st, "u-3");
    expect(req.url).toBe("/api/driver/samples");
    expect(req.body).not.toHaveProperty("collected_toman");
  });

  it("with no shop fixed, the first question is which shop", () => {
    expect(startFlow(doorSaleFlow, { ...ctx, vars: {} }).stack).toEqual(["who"]);
  });
});

describe("the door request body", () => {
  it("accepts a good body and rejects fractional packs, empty lines and a bad id", () => {
    const good = { customer_id: 1, lines: [{ product_id: 1, packaging_id: 2, packs: 3 }], collected_toman: 100, client_uuid: "abcdefgh-1" };
    expect(parseDoorRequest(good).ok).toBe(true);
    expect(parseDoorRequest({ ...good, lines: [{ product_id: 1, packaging_id: 2, packs: 1.5 }] }).ok).toBe(false);
    expect(parseDoorRequest({ ...good, lines: [] }).ok).toBe(false);
    expect(parseDoorRequest({ ...good, client_uuid: "x%" }).ok).toBe(false);
    expect(parseDoorRequest({ ...good, customer_id: "a" }).ok).toBe(false);
  });
});
