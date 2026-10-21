import "./helpers/sheetHost";
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import BottomNav from "@/components/mobile/BottomNav";
import QuickActions from "@/components/mobile/QuickActions";
import StickyAction from "@/components/mobile/StickyAction";
import { bottomTabs, quickActionsFor } from "@/lib/mobileNav";

let path = "/sales/orders/12";
vi.mock("next/navigation", () => ({ usePathname: () => path, useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

describe("the phone's bottom bar", () => {
  const html = (role: Parameters<typeof bottomTabs>[0]["role"]) =>
    renderToStaticMarkup(createElement(BottomNav, bottomTabs({ role })));

  it("shows each primary destination as icon and word, plus «بیشتر»", () => {
    const h = html("phone_sales");
    for (const w of ["امروز", "مشتریان و سرنخ‌ها", "کارهای من", "سفارش‌ها", "بیشتر"]) expect(h).toContain(w);
    expect(h).toContain('aria-label="ناوبری اصلی"');
    expect((h.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("lights the destination the page is inside (longest prefix), not its neighbours", () => {
    path = "/sales/orders/12";
    const h = html("phone_sales");
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*aria-current="page"[^>]*>(?:(?!<\/a>)[\s\S])*سفارش‌ها/);
  });

  it("lights «بیشتر» when the page is one of the other destinations", () => {
    path = "/sales/commission";
    const h = html("phone_sales");
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h.slice(h.indexOf('aria-current="page"') - 120, h.indexOf('aria-current="page"') + 120)).toContain("aria-haspopup");
  });

  it("the «بیشتر» sheet lists every other destination under its group heading", () => {
    path = "/sales/today";
    const h = html("owner");
    for (const w of ["همهٔ بخش‌ها", "حسابداری", "تراز آزمایشی", "کاربران", "گزارش‌ها", "تحلیل فروش"]) expect(h).toContain(w);
  });

  it("a driver gets two items and no «بیشتر» (they have nothing else to open)", () => {
    const h = html("delivery_driver");
    expect(h).toContain("مسیر امروز");
    expect(h).toContain("آموزش");
    expect(h).not.toContain("بیشتر");
  });
});

describe("quick actions", () => {
  const html = (role: Parameters<typeof quickActionsFor>[0]["role"]) =>
    renderToStaticMarkup(createElement(ToastProvider, null, createElement(QuickActions, { actions: quickActionsFor({ role }) })));

  it("offers «+ ثبت» and, in its sheet, only what the role can do", () => {
    const h = html("phone_sales");
    expect(h).toContain("qa-fab");
    for (const w of ["ثبت یادآوری", "ثبت یادداشت", "سفارش تازه", "ثبت دریافت", "ثبت شکایت"]) expect(h).toContain(w);
    const rep = html("rep_manager");
    expect(rep).toContain("ثبت یادآوری");
    expect(rep).not.toContain("ثبت دریافت");
    expect(rep).not.toContain("سفارش تازه");
  });
  it("renders nothing for a role with no actions", () => {
    expect(html("delivery_driver")).not.toContain("qa-fab");
  });
  it("sends the others to their page with the parameter that opens its flow", () => {
    const h = html("owner");
    expect(h).toContain("/sales/payments?new=1");
    expect(h).toContain("/sales/complaints?new=1");
    expect(h).toContain("/sales/orders/new?quick=1");
  });
});

describe("sticky action", () => {
  it("is the page's one dominant button, with its word", () => {
    const h = renderToStaticMarkup(createElement(StickyAction, { label: "ثبت سفارش", onClick: () => {} }));
    expect(h).toContain("sticky-action");
    expect(h).toContain("ثبت سفارش");
    expect(h).toContain("<svg");
  });
  it("says what it is doing instead of going dead", () => {
    const h = renderToStaticMarkup(createElement(StickyAction, { label: "ثبت سفارش", busy: "در حال ثبت…", onClick: () => {}, disabled: true }));
    expect(h).toContain("در حال ثبت…");
    expect(h).toContain("disabled");
  });
});
