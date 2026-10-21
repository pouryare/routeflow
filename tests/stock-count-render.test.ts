import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import StockCountFlow from "@/components/flows/StockCountFlow";
import StockCountEntry from "@/components/flows/StockCountEntry";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const rows = [
  { product_id: 9, name: "شیر ۱ لیتری", base_unit: "عدد", expected: 12 },
  { product_id: 10, name: "ماست", base_unit: "کیلو", expected: 2.5 },
];
const facility = { id: 3, name: "انبار مرکزی" };

describe("stock count", () => {
  it("the stock page entry is a 44px button", () => {
    const h = renderToStaticMarkup(createElement(StockCountEntry, { rows, facility }));
    expect(h).toContain("شمارش انبار");
    expect(h).toContain("min-h-[44px]");
  });

  it("the sheet opens on the first product with the system's number and four answers", () => {
    const h = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(StockCountFlow, { open: true, rows, facility, onClose: () => {} })),
    );
    expect(h).toContain("شمارش انبار · ۱ از ۲");
    expect(h).toContain("موجودی «شیر ۱ لیتری» درست است؟");
    expect(h).toContain("سیستم می‌گوید ۱۲ عدد در انبار مرکزی");
    for (const a of ["درست است", "فرق دارد", "چیزی نمانده", "بعداً می‌شمارم"]) expect(h).toContain(a);
    expect(h).not.toContain("<input");
  });

  it("renders nothing for an empty shelf list rather than an empty sheet", () => {
    const h = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(StockCountFlow, { open: true, rows: [], facility, onClose: () => {} })),
    );
    expect(h).not.toContain("شمارش انبار ·");
  });
});
