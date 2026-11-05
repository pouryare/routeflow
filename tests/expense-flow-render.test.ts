import "./helpers/sheetHost";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import ExpenseFlow from "@/components/flows/ExpenseFlow";

describe("ExpenseFlow sheet", () => {
  it("starts with what the money was for", () => {
    const h = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(ExpenseFlow, {
        open: true, categories: [{ id: 41, nameFa: "سوخت" }], suppliers: [], onClose: () => {},
      })),
    );
    expect(h).toContain("این هزینه برای چیست؟");
    expect(h).toContain("سوخت");
  });
});

describe("ExpenseFlow repeated (A10)", () => {
  it("opens at the paying method with the old category and amount", () => {
    const h = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(ExpenseFlow, {
        open: true, categories: [{ id: 41, nameFa: "سوخت" }], suppliers: [], onClose: () => {},
        repeat: { accountId: 41, amountToman: 350000, supplier: "پمپ بنزین مرکزی" },
      })),
    );
    expect(h).toContain("چطور پرداخت شد؟");
    expect(h).toContain("سوخت");
  });
});

describe("FlowDone «ثبت بعدی» (Z18)", () => {
  it("shows the button only when the host offers another", async () => {
    const { default: FlowDone } = await import("@/components/tapflow/FlowDone");
    const withIt = renderToStaticMarkup(createElement(FlowDone, { chips: ["سوخت"], onReturn: () => {}, onAnother: () => {} }));
    const without = renderToStaticMarkup(createElement(FlowDone, { chips: ["سوخت"], onReturn: () => {} }));
    expect(withIt).toContain("ثبت بعدی");
    expect(without).not.toContain("ثبت بعدی");
  });
});
