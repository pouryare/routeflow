import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SmartPicker from "@/components/mobile/SmartPicker";
import KeypadField from "@/components/mobile/KeypadField";
import ActionCards from "@/components/mobile/ActionCard";
import { buildSuggestions } from "@/lib/briefingSuggestions";

describe("SmartPicker", () => {
  const items = [{ id: "1", label: "بقالی رضا" }, { id: "2", label: "سوپر علی" }];
  it("closed, it is one 52px button showing the choice, not a dropdown", () => {
    const out = renderToStaticMarkup(h(SmartPicker, { scope: "t", label: "مشتری", items, value: "2", onChange: () => {} }));
    expect(out).toContain("picker-trigger");
    expect(out).toContain("سوپر علی");
    expect(out).not.toContain("<select");
  });
  it("with nothing chosen it shows a placeholder", () => {
    const out = renderToStaticMarkup(h(SmartPicker, { scope: "t", label: "کالا", items, value: "", onChange: () => {} }));
    expect(out).toContain("انتخاب کالا");
  });
});

describe("KeypadField", () => {
  it("shows the committed value in Persian digits on a button, never a text field", () => {
    const out = renderToStaticMarkup(h(KeypadField, { label: "تعداد", value: "125", onChange: () => {}, unit: "بسته" }));
    expect(out).toContain("۱۲۵");
    expect(out).not.toContain("<input");
  });
  it("an empty field says so in its accessible name", () => {
    const out = renderToStaticMarkup(h(KeypadField, { label: "تعداد", value: "", onChange: () => {} }));
    expect(out).toContain("تعداد: خالی");
  });
});

describe("ActionCards", () => {
  const cards = buildSuggestions({
    churn: [{ customerId: 1, name: "رضا", phone: "0912", probability: 0.9, reason: "۶۰ روز بدون سفارش" }],
    reorder: [],
  });
  it("each card shows its title, why, a primary action and a way to dismiss", () => {
    const out = renderToStaticMarkup(h(ActionCards, { cards }));
    expect(out).toContain("ممکن است ریزش کند: رضا");
    expect(out).toContain("۶۰ روز بدون سفارش");
    expect(out).toContain('href="tel:0912"');
    expect(out).toContain("الان نه");
  });
  it("no cards, nothing rendered", () => {
    expect(renderToStaticMarkup(h(ActionCards, { cards: [] }))).toBe("");
  });
});
