import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import OutcomeFlow from "@/components/flows/OutcomeFlow";

const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(OutcomeFlow, {
      open: true, taskLabel: "پیگیری قیمت", decide: async () => ({ ok: true }), onClose: () => {}, ...props,
    })),
  );

describe("OutcomeFlow sheet", () => {
  it("asks one question with four full-sentence answers and names the task", () => {
    const h = html({});
    expect(h).toContain("نتیجهٔ این کار چه بود؟");
    for (const t of ["با او صحبت شد", "سفارش داد", "قیمت را زیاد دانست", "علاقه‌ای ندارد"]) expect(h).toContain(t);
    expect(h).toContain("پیگیری قیمت");
    expect(h).not.toContain("بدون نتیجه");
    expect(h).not.toContain("<input");
  });
  it("offers «بدون نتیجه» where the board allows it", () => {
    expect(html({ allowNone: true })).toContain("بدون نتیجه");
  });
});
