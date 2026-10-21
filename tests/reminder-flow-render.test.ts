import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import ReminderFlow from "@/components/flows/ReminderFlow";

const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(ReminderFlow, {
      open: true, kind: "reminder", onAdded: () => {}, onClose: () => {}, ...props,
    })),
  );

describe("ReminderFlow sheet", () => {
  it("a reminder starts with the day as answers, calendar underneath, and no text box", () => {
    const h = html({});
    expect(h).toContain("کی یادآوری شود؟");
    for (const d of ["امروز", "فردا", "دو روز دیگر", "یک هفته دیگر"]) expect(h).toContain(d);
    expect(h).toContain("یا روز دیگری را انتخاب کنید");
  });
  it("a note starts straight at the words", () => {
    const h = html({ kind: "note" });
    expect(h).toContain("متن را بنویسید");
    expect(h).toContain("ثبت یادداشت");
  });
  it("names what the reminder is about", () => {
    const h = html({ entity: { type: "customer", id: 5, label: "بقالی رضا" } });
    expect(h).toContain("بقالی رضا");
  });
});
