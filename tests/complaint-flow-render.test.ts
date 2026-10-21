import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import ComplaintFlow from "@/components/flows/ComplaintFlow";

const customers = [{ id: 5, business_name: "بقالی رضا" }, { id: 6, business_name: "نانوایی سنگک" }];
const products = [{ id: 9, name: "شیر ۱ لیتری" }, { id: 10, name: "ماست" }];
const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(ComplaintFlow, {
      open: true, customers, products, onRecorded: () => {}, onClose: () => {}, ...props,
    })),
  );

describe("ComplaintFlow sheet", () => {
  it("from the complaints page, starts by asking which customer", () => {
    const h = html({});
    expect(h).toContain("شکایت از طرف کدام مشتری است؟");
    expect(h).toContain("بقالی رضا");
  });
  it("from an order, starts at the product with only that order's products, and the customer as context", () => {
    const h = html({ customerId: 5, orderId: 42, products: [{ id: 9, name: "شیر ۱ لیتری" }] });
    expect(h).toContain("دربارهٔ کدام کالا؟");
    expect(h).toContain("شیر ۱ لیتری");
    expect(h).not.toContain("ماست");
    expect(h).toContain("کالا مشخص نیست");
    expect(h).toContain("بقالی رضا");
  });
});
