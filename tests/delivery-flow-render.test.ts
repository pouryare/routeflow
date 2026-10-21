import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import DeliveryFlow from "@/components/flows/DeliveryFlow";
import type { RunStop } from "@/lib/delivery";

const stop = {
  id: 1, order_id: 2, order_no: "A-100", customer_id: 3, customer_name: "نانوایی سنگک", address: null, phone: null,
  lat: null, lng: null, status: "pending", collected_toman: 0, sort_order: 1, notes: null, total_toman: 1200000,
  lines: [
    { id: 11, product_name: "شیر", packaging_name: "کارتن", packs_ordered: 10, packs_delivered: null, unit_price_toman: 60000, unit_cost_toman: 0, qty_per_pack: 1, kg_per_base_unit: 1, total_toman: 600000, kg: 10 },
    { id: 12, product_name: "ماست", packaging_name: "بسته", packs_ordered: 6, packs_delivered: null, unit_price_toman: 100000, unit_cost_toman: 0, qty_per_pack: 1, kg_per_base_unit: 1, total_toman: 600000, kg: 6 },
  ],
} as RunStop;

describe("DeliveryFlow sheet", () => {
  it("opens on the first question with the customer, the total and the two answers", () => {
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(DeliveryFlow, {
        open: true, stop, runDate: "2026-10-21", driverName: "علی", businessName: "کارگاه",
        onRecorded: () => {}, onPrint: () => {}, onClose: () => {},
      })),
    );
    expect(html).toContain("نانوایی سنگک");
    expect(html).toContain("همهٔ اقلام تحویل شد؟");
    expect(html).toContain("بله، همه");
    expect(html).toContain("نه، کم شد");
    expect(html).toContain("۱٬۲۰۰٬۰۰۰");
    expect(html).not.toContain("<input"); // no typing on the common path
  });
});
