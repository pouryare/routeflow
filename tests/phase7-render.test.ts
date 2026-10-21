import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import VisitPlanFlow from "@/components/flows/VisitPlanFlow";
import VisitPlanEntry from "@/components/flows/VisitPlanEntry";
import PlaceFlow from "@/components/flows/PlaceFlow";
import PlaceEntry from "@/components/flows/PlaceEntry";

const wrap = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ToastProvider, null, el));

describe("visit-plan quick add", () => {
  const props = {
    customers: [{ id: 5, business_name: "بقالی رضا", customer_code: "C-5" }],
    leads: [{ id: 9, name: "کافه نو" }],
    selectedDate: "2026-10-23",
  };
  it("the planner gets a phone-only 44px button above the search box", () => {
    const h = renderToStaticMarkup(createElement(VisitPlanEntry, { ...props, onAdded: () => {} }));
    expect(h).toContain("افزودن به برنامه");
    expect(h).toContain("md:hidden");
    expect(h).toContain("min-h-[44px]");
  });
  it("the sheet asks who, listing customers and leads without typing", () => {
    const h = wrap(createElement(VisitPlanFlow, { open: true, ...props, onAdded: () => {}, onClose: () => {} }));
    expect(h).toContain("چه کسی را به برنامه اضافه کنیم؟");
    expect(h).toContain("بقالی رضا (C-5)");
    expect(h).toContain("کافه نو · سرنخ");
  });
});

describe("create a place", () => {
  it("the sites page gets a phone-only button", () => {
    const h = renderToStaticMarkup(createElement(PlaceEntry, { onAdded: () => {} }));
    expect(h).toContain("افزودن مکان");
    expect(h).toContain("md:hidden");
  });
  it("the sheet starts with what kind of place, all nine kinds as answers", () => {
    const h = wrap(createElement(PlaceFlow, { open: true, onAdded: () => {}, onClose: () => {} }));
    expect(h).toContain("این مکان چیست؟");
    for (const k of ["انبار", "کارخانه", "سردخانه", "پارکینگ", "خانه / مبدأ", "مکان دیگر"]) expect(h).toContain(k);
    expect(h).not.toContain("<input");
  });
});
