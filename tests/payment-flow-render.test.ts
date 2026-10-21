import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import PaymentFlow from "@/components/flows/PaymentFlow";

const customers = [
  { id: 5, business_name: "بقالی رضا", customer_code: "C-5" },
  { id: 6, business_name: "نانوایی سنگک", customer_code: "C-6" },
];
const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(PaymentFlow, {
      open: true, customers, onRecorded: () => {}, onClose: () => {}, ...props,
    })),
  );

describe("PaymentFlow sheet", () => {
  it("without a customer, starts by asking who, listing customers with a search box", () => {
    const h = html({});
    expect(h).toContain("از کدام مشتری دریافت کردید؟");
    expect(h).toContain("بقالی رضا (C-5)");
    expect(h).toContain("نانوایی سنگک (C-6)");
  });
  it("with a customer, starts at the method with the five answers and no typing", () => {
    const h = html({ customerId: 5 });
    expect(h).toContain("چطور پرداخت شد؟");
    for (const m of ["نقد", "کارت‌خوان", "کارت به کارت", "چک", "سایر"]) expect(h).toContain(m);
    expect(h).not.toContain("<input");
    expect(h).toContain("بقالی رضا");
  });
  it("from the cheques board, starts at the cheque number", () => {
    const h = html({ customerId: 5, method: "CHEQUE" });
    expect(h).toContain("شمارهٔ چک چند است؟");
    expect(h).toContain("ثبت چک");
  });
});
