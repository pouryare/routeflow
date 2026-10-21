import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import ReceiveFlow from "@/components/flows/ReceiveFlow";
import ReceiveEntry from "@/components/flows/ReceiveEntry";
import DateStep from "@/components/tapflow/DateStep";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const products = [
  { id: 9, name: "شیر ۱ لیتری", base_unit: "عدد", avg_cost_toman: 47000 },
  { id: 10, name: "ماست", base_unit: "کیلو", avg_cost_toman: 0 },
];

describe("goods receiving", () => {
  it("the stock page entry is a 44px «دریافت کالا» button", () => {
    const h = renderToStaticMarkup(createElement(ReceiveEntry, { products, suppliers: ["مرحبا"] }));
    expect(h).toContain("دریافت کالا");
    expect(h).toContain("min-h-[44px]");
  });

  it("the sheet starts by asking which product, listing the products", () => {
    const h = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(ReceiveFlow, { open: true, products, suppliers: [], onClose: () => {} })),
    );
    expect(h).toContain("کدام کالا رسیده است؟");
    expect(h).toContain("شیر ۱ لیتری");
    expect(h).toContain("ماست");
  });

  it("the expiry step offers shelf-life shortcuts and a way to say there is none", () => {
    const h = renderToStaticMarkup(
      createElement(DateStep, {
        optionId: "ok", optionLabel: "ادامه", skip: { id: "none", label: "تاریخ انقضا ندارد" },
        from: "2026-10-21", presets: [{ label: "شش ماه دیگر", days: 180 }], ariaLabel: "تاریخ انقضا", submit: () => {},
      }),
    );
    expect(h).toContain("شش ماه دیگر");
    expect(h).toContain("تاریخ انقضا ندارد");
  });
});
