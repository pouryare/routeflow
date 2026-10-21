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
