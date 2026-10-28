import { describe, it, expect } from "vitest";
import { emptyDraft, setShare, summarize, toRequestBody, togglePayer, payerKey, type Payer } from "@/lib/discountDraft";

const people: Payer[] = [
  { user_id: 1, ledger: "sales", name: "نازنین" },
  { user_id: 2, ledger: "driver", name: "رضا" },
  { user_id: 3, ledger: "manager", name: "مدیر" },
];
const key = (i: number) => payerKey(people[i]);
const open = (over = {}) => ({ ...emptyDraft(), open: true, kind: "percent" as const, value: "10", reason: "loyal" as const, ...over });

describe("togglePayer", () => {
  it("picking people splits equally, and un-picking re-splits", () => {
    let d = togglePayer(open(), key(0));
    expect(d.payers.map((p) => p.share)).toEqual(["100"]);
    d = togglePayer(d, key(1));
    expect(d.payers.map((p) => p.share)).toEqual(["50", "50"]);
    d = togglePayer(d, key(2));
    expect(d.payers.map((p) => p.share)).toEqual(["33.34", "33.33", "33.33"]);
    d = togglePayer(d, key(0));
    expect(d.payers.map((p) => p.key)).toEqual([key(1), key(2)]);
    expect(d.payers.map((p) => p.share)).toEqual(["50", "50"]);
  });
});

describe("summarize", () => {
  it("works out the amount and what is left", () => {
    const s = summarize(open(), 2_000_000, people);
    expect(s).toMatchObject({ amount: 200_000, net: 1_800_000, problem: null });
  });
  it("asks for what is missing, in order", () => {
    expect(summarize(open({ value: "" }), 1000, people).problem).toMatch(/مقدار/);
    expect(summarize(open({ value: "150" }), 1000, people).problem).toMatch(/۱۰۰/);
    expect(summarize(open({ reason: "" }), 1000, people).problem).toMatch(/دلیل/);
  });
  it("refuses shares that do not total 100 until they are fixed", () => {
    let d = togglePayer(togglePayer(open(), key(0)), key(1));
    d = setShare(d, key(0), "70");
    expect(summarize(d, 1000, people).problem).toMatch(/۱۰۰٪/);
    d = setShare(d, key(1), "30");
    expect(summarize(d, 1000, people).problem).toBeNull();
  });
  it("an amount discount over the order is refused", () => {
    expect(summarize(open({ kind: "amount", value: "5000" }), 1000, people).problem).not.toBeNull();
  });
});

describe("toRequestBody", () => {
  it("is nothing while the section is closed or empty", () => {
    expect(toRequestBody(emptyDraft(), people)).toBeUndefined();
    expect(toRequestBody(open({ value: "" }), people)).toBeUndefined();
  });
  it("carries the kind, value, reason and the chosen people", () => {
    const d = togglePayer(togglePayer(open(), key(0)), key(1));
    expect(toRequestBody(d, people)).toEqual({
      kind: "percent", value: 10, reason: "loyal",
      shares: [{ user_id: 1, ledger: "sales", share_pct: 50 }, { user_id: 2, ledger: "driver", share_pct: 50 }],
    });
  });
  it("drops a person no longer in the list", () => {
    const d = togglePayer(open(), "sales:99");
    expect(toRequestBody(d, people)?.shares).toEqual([]);
  });
});
