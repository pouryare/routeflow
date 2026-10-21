import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import LifecycleFlow from "@/components/flows/LifecycleFlow";

const html = (lifecycle: "lead" | "active" | "lost") =>
  renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(LifecycleFlow, {
      open: true, customer: { id: 5, name: "بقالی رضا", lifecycle }, onClose: () => {},
    })),
  );

describe("LifecycleFlow sheet", () => {
  it("from «سرنخ», offers only the moves the table allows, in words, with what each means", () => {
    const h = html("lead");
    expect(h).toContain("وضعیت جدید چیست؟");
    expect(h).toContain("بقالی رضا");
    for (const t of ["در حال پیگیری", "از دست‌رفته", "مسدود"]) expect(h).toContain(t);
    // «غیرفعال» (dormant) is not reachable from a lead, so its meaning must not appear.
    expect(h).not.toContain("مدتی خرید نکرده");
  });
  it("shows the current state so the person knows what they are changing from", () => {
    expect(html("active")).toContain("الان «فعال»");
  });
  it("from «از دست‌رفته», offers coming back as a lead", () => {
    expect(html("lost")).toContain("سرنخ");
  });
});
