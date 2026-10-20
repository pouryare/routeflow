// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BusinessProfile from "@/components/crm/BusinessProfile";
import BusinessDetails from "@/components/crm/BusinessDetails";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const profile = {
  business: {
    id: 7, business_name: "کافه دود", business_type: "CAFE", area_label: "ونک", address: "خیابان ولیعصر",
    phone_norm: "9120001122", lat: null, lng: null, location_precision: null, maps_url: null,
    temperature: "cold", sales_stage: "unknown", contact_status: null, verification: "verified",
    price_tier: "mid", working_hours_json: null, source_code: null,
    owner_user_id: 1, owner_name: null, group_id: null, organization_id: 1,
    attempt_count: 0, last_activity_at: null, next_task_id: null, next_title: null, next_kind: null, next_due_at: null,
    contact_name: null, contact_role: null, last_order_at: null, closed_at: null,
    secondary_phone: null, whatsapp: null, website: null, instagram: "kababi.nayeb",
    size_band: "medium", supply_channel: "distributor", visit_window: "afternoon", visit_note: "سراغ مدیر",
    uses_products_json: "[1,2]", temperature_manual: 0,
  },
  tags: ["ویژه", "بازدید"],
  products: [{ id: 1, name: "کره", price_toman: 1000 }, { id: 2, name: "پودر کاکائو", price_toman: null }],
  contacts: [], summary: null, reps: [],
  canWrite: true, canManage: false,
} as unknown as Parameters<typeof BusinessProfile>[0]["initial"];
const timeline = { items: [], nextBefore: null };

it("shows history in Jalali and Tehran time while preserving the ISO instant", async () => {
  const at = "2026-03-20T21:00:00.000Z";
  const history = { items: [{ kind: "activity", id: 1, at, title: "اصلاح موقعیت", sub: "", who: "علی" }], nextBefore: null } as Parameters<typeof BusinessProfile>[0]["initialTimeline"];
  await act(async () => root.render(createElement(BusinessProfile, { initial: profile, initialTimeline: history })));
  expect(host.querySelector("time")?.textContent).toBe("۱۴۰۵/۰۱/۰۱ ۰۰:۳۰");
  expect(host.querySelector("time")?.getAttribute("datetime")).toBe(at);
});

it("holds a selected chip for five seconds, supports cancel and retains failed drafts", async () => {
  vi.useFakeTimers();
  const patch = vi.fn().mockRejectedValue(new Error("ذخیره نشد"));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLElement).click());
  try {
    await act(async () => root.render(createElement(BusinessDetails, { business: profile.business, canWrite: true, disabled: false, onPatch: patch, onHours: vi.fn() })));
    await click('[aria-label="ویرایش ردهٔ قیمت"]');
    await click('[role="radio"]');
    expect(host.querySelector('[role="radio"]')?.getAttribute("aria-checked")).toBe("true");
    await click('[type="submit"]');
    expect(patch).not.toHaveBeenCalled();
    expect((host.querySelector('[aria-label="ویرایش نام کسب‌وکار"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(patch).not.toHaveBeenCalled();
    await click('.pending-note button');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(patch).not.toHaveBeenCalled();
    await click('[type="submit"]');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(patch).toHaveBeenCalledWith({ price_tier: "low" });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("ذخیره نشد");
    expect(host.querySelector('[role="radio"]')?.getAttribute("aria-checked")).toBe("true");
  } finally { vi.useRealTimers(); }
});

it("puts nested information first and the order action beside Back", async () => {
  await act(async () => root.render(createElement(BusinessProfile, { initial: profile, initialTimeline: timeline })));
  const headings = Array.from(host.querySelectorAll("h2")).map(h => h.textContent);
  expect(headings.slice(0, 2)).toEqual(["اطلاعات کسب‌وکار", "شناخت پیش از بازدید"]);
  for (const label of ["مشخصات پایه", "راه‌های ارتباطی", "موقعیت و ساعت کاری", "ساعت کاری", "ردهٔ قیمت", "تلفن دوم", "واتس‌اپ", "لینک نقشه"]) expect(host.textContent).toContain(label);
  const order = host.querySelector('a[href="/sales/orders/new?customer=7"]')!;
  expect(order.parentElement?.querySelector('a[href="/crm"]')).not.toBeNull();
  expect(host.textContent).toContain("موقعیت ثبت نشده است");
  const button = Array.from(host.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "ویرایش نام کسب‌وکار");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(host.querySelector('input[aria-label="نام کسب‌وکار"]')).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("renders intel facts, tags and the Instagram page", async () => {
  await act(async () => root.render(createElement(BusinessProfile, { initial: profile, initialTimeline: timeline })));
  expect(host.textContent).toContain("شناخت پیش از بازدید");
  expect(host.textContent).toContain("متوسط");
  expect(host.textContent).toContain("بعدازظهر · ۱۵ تا ۱۸");
  expect(host.textContent).toContain("سراغ مدیر");
  expect(host.textContent).toContain("بازدید");
  expect(host.textContent).toContain("اینستاگرام");
  expect(host.textContent).toContain("kababi.nayeb");
});

it("offers the intel flow and tag editing for writers", async () => {
  await act(async () => root.render(createElement(BusinessProfile, { initial: profile, initialTimeline: timeline })));
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "ثبت شناخت")).toBe(true);
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent?.includes("برچسب‌ها"))).toBe(true);
});

it("passes the product catalog into the intel flow", async () => {
  vi.useFakeTimers();
  try {
    await act(async () => root.render(createElement(BusinessProfile, { initial: profile, initialTimeline: timeline })));
    const click = async (label: string) => {
      // The flow's sheet is drawn in the document root (useSheetHost), outside `host`.
      const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === label);
      expect(button, label).toBeDefined();
      await act(async () => { button!.click(); vi.advanceTimersByTime(200); });
    };
    await click("ثبت شناخت");
    await click("متوسط");
    await click("پخش‌کننده");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("کره");
    expect(dialog.textContent).toContain("پودر کاکائو");
  } finally { vi.useRealTimers(); }
});

it("hides write actions from read-only viewers", async () => {
  await act(async () => root.render(createElement(BusinessProfile, {
    initial: { ...profile, canWrite: false } as unknown as typeof profile, initialTimeline: timeline,
  })));
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "ثبت شناخت")).toBe(false);
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent?.includes("برچسب‌ها"))).toBe(false);
});
