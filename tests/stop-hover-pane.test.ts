import { describe, it, expect } from "vitest";
import { paneFacts, type HoverOrder } from "@/components/sales/StopHoverPane";

function order(over: Partial<HoverOrder> = {}): HoverOrder {
  return {
    orderNo: "1001",
    customerName: "فروشگاه امید",
    kg: 40,
    totalToman: 55_200_000,
    paidToman: 20_000_000,
    paymentStatus: "partial",
    notes: "کدِ درب پشتی را بزن",
    phone: "09120000000",
    lat: 35.7,
    lng: 51.4,
    legKm: 4.2,
    ...over,
  };
}

describe("the stop hover pane", () => {
  it("shows payment three ways, because each answers a different question", () => {
    // The LABEL says what state it is in, the NUMBERS say how much came and how much is
    // left, and the COLOUR is what you notice without reading. One of the three alone is
    // not enough: a label with no figure tells a driver nothing about whether to expect cash.
    const f = paneFacts(order());
    expect(f.payment.label).toBe("بخشی پرداخت‌شده");
    expect(f.payment.paidToman).toBe(20_000_000);
    expect(f.payment.remainingToman).toBe(35_200_000);
    expect(f.payment.tone).toBe("warn");
  });

  it("never shows a negative balance", () => {
    // An overpaid order is possible — goods returned, cash adjusted. A pane that said
    // «−۵٬۰۰۰ تومان مانده» would be arithmetically true and completely useless.
    const f = paneFacts(order({ paidToman: 60_000_000, totalToman: 55_200_000 }));
    expect(f.payment.remainingToman).toBe(0);
  });

  it("weighs in KILOGRAMS, because that is what fills a van", () => {
    // The timeline summed money on the one graphic built to compare how full each van is.
    // Weight is the number that decides the split; money is not.
    expect(paneFacts(order({ kg: 40 })).kg).toBe(40);
  });

  it("says UNKNOWN rather than 0 km when there is no previous stop", () => {
    // The first stop of a day has no leg before it. "0 km" reads as "this shop is on the
    // doorstep"; there is simply no earlier stop to measure from.
    expect(paneFacts(order({ legKm: null })).legKm).toBeNull();
    expect(paneFacts(order({ legKm: 0 })).legKm).toBe(0);
  });

  it("drops the mini map entirely when the customer has no location", () => {
    // An empty map is not a neutral placeholder — it is a broken promise. The driver is told
    // the shop has no pin, which is a fact, and gets the phone number instead.
    expect(paneFacts(order({ lat: null, lng: null })).hasPin).toBe(false);
    expect(paneFacts(order()).hasPin).toBe(true);
  });

  it("surfaces notes and phone only when they exist", () => {
    expect(paneFacts(order()).notes).toBe("کدِ درب پشتی را بزن");
    expect(paneFacts(order({ notes: null })).notes).toBeNull();
    expect(paneFacts(order({ phone: null })).phone).toBeNull();
  });
});