// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BusinessProfile from "@/components/crm/BusinessProfile";

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

it("hides write actions from read-only viewers", async () => {
  await act(async () => root.render(createElement(BusinessProfile, {
    initial: { ...profile, canWrite: false } as unknown as typeof profile, initialTimeline: timeline,
  })));
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "ثبت شناخت")).toBe(false);
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent?.includes("برچسب‌ها"))).toBe(false);
});
