import { describe, it, expect } from "vitest";
import { incomeStatementCards } from "@/lib/accountingCards";

const is = {
  revenueToman: 1000, cogsToman: 600, grossProfitToman: 400,
  expenses: [{ nameFa: "اجاره", amountToman: 150 }, { nameFa: "سوخت", amountToman: 50 }],
  totalExpensesToman: 200, netProfitToman: 200,
};

describe("income statement cards", () => {
  it("one card per section in table order, costs negative, net last and marked total", () => {
    const c = incomeStatementCards(is);
    expect(c.map((x) => x.id)).toEqual(["revenue", "cogs", "gross", "expenses", "net"]);
    expect(c.find((x) => x.id === "cogs")!.value).toBe(-600);
    expect(c[c.length - 1]).toMatchObject({ id: "net", value: 200, total: true });
  });
  it("expenses open to their lines, also negative", () => {
    const e = incomeStatementCards(is).find((x) => x.id === "expenses")!;
    expect(e.value).toBe(-200);
    expect(e.lines).toEqual([{ label: "اجاره", value: -150 }, { label: "سوخت", value: -50 }]);
  });
  it("no expenses, no expenses card", () => {
    expect(incomeStatementCards({ ...is, expenses: [], totalExpensesToman: 0 }).some((x) => x.id === "expenses")).toBe(false);
  });
});

import "./helpers/sheetHost";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SummaryCards from "@/components/accounting/SummaryCards";
import KpiCarousel from "@/components/mobile/KpiCarousel";

describe("card components render", () => {
  it("summary cards: a list, the expenses card is a button, the rest are plain rows", () => {
    const out = renderToStaticMarkup(h(SummaryCards, { ariaLabel: "سود و زیان", cards: incomeStatementCards(is) }));
    expect(out).toContain("<ul");
    expect(out.match(/<button/g)!.length).toBe(1);
    expect(out).toContain("جمع هزینه‌ها");
  });
  it("carousel: one button per card with its own accessible name, and a dot per card", () => {
    const out = renderToStaticMarkup(
      h(KpiCarousel, { ariaLabel: "شاخص‌ها", onOpen: () => {}, cards: [{ id: "a", label: "فروش: ۱", body: "x" }, { id: "b", label: "سود: ۲", body: "y" }] }),
    );
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).toContain('aria-label="فروش: ۱"');
    expect(out.match(/<i/g)).toHaveLength(2);
  });
});
