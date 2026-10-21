import "./helpers/sheetHost";
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import OrderQuickFlow from "@/components/flows/OrderQuickFlow";
import OrderQuickEntry from "@/components/flows/OrderQuickEntry";

/* The host uses the app router for «باز کردن سفارش» and the full form; outside Next there is none. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const customers = [
  { id: 5, customer_code: "C-5", business_name: "بقالی رضا", debt: 0, credit_limit_toman: null },
  { id: 6, customer_code: "C-6", business_name: "نانوایی سنگک", debt: 0, credit_limit_toman: null },
];
const products = [{ id: 11, name: "شیر", packagings: [{ id: 101, name: "کارتن", price_toman: 60000 }] }];

describe("order quick entry", () => {
  it("the new-order page gets a phone-only «سفارش سریع» button above the full form", () => {
    const h = renderToStaticMarkup(
      createElement(OrderQuickEntry, { customers, products, initialCustomerId: null }),
    );
    expect(h).toContain("سفارش سریع (مثل سفارش قبلی)");
    expect(h).toContain("md:hidden");
  });
});

describe("OrderQuickFlow sheet", () => {
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(OrderQuickFlow, {
        open: true, customers, products, onClose: () => {}, ...props,
      })),
    );
  it("without a customer, starts by asking which", () => {
    const h = html({});
    expect(h).toContain("سفارش برای کدام مشتری است؟");
    expect(h).toContain("بقالی رضا (C-5)");
  });
  it("with a customer, goes to the repeat question and shows the customer", () => {
    const h = html({ customerId: 5 });
    expect(h).toContain("سفارش چطور باشد؟");
    expect(h).toContain("بقالی رضا");
    expect(h).toContain("در حال خواندن سفارش قبلی");
  });
});
