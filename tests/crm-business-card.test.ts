// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BusinessCard from "@/components/crm/BusinessCard";
import type { BusinessRow } from "@/lib/repo/crm/businesses";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const row: BusinessRow = {
  id: 1, business_name: "کافه آزمایشی", business_type: null, area_label: null, address: null,
  phone_norm: null, lat: null, lng: null, location_precision: null, maps_url: null,
  temperature: "cold", sales_stage: "unknown", contact_status: null, verification: "unverified",
  price_tier: null, working_hours_json: null, source_code: null,
  owner_user_id: null, owner_name: null, group_id: null, organization_id: 1,
  attempt_count: 0, last_activity_at: null, next_task_id: null,
  next_title: null, next_kind: null, next_due_at: null,
  contact_name: null, contact_role: null, last_order_at: null, closed_at: null,
};

it.each(["unverified", null, "verified"])("labels unverified information explicitly for verification=%s", async (verification) => {
  await act(async () => root.render(createElement(BusinessCard, {
    row: { ...row, verification }, mode: "business", highlight: false,
    onCall: vi.fn(), onOpen: vi.fn(), onNavigate: vi.fn(),
  })));
  const badges = Array.from(host.querySelectorAll(".pills .pill"), el => el.textContent);
  expect(badges.includes("اطلاعات تأییدنشده")).toBe(verification !== "verified");
  expect(badges).not.toContain("تأییدنشده");
});
