// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BasicsStep from "@/components/crm/BasicsStep";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
vi.mock("@/components/ToastProvider", () => ({ useToast: () => vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let request: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, matches: [] }) });
  vi.stubGlobal("fetch", request);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const api: CustomStepApi = {
    step: { id: "basics", kind: "basics", q: "", options: [], choices: [], timeStep: false, skipable: true },
    state: { stack: ["basics"], answers: [], acc: {}, values: {}, saved: false }, submit: vi.fn(),
  };
  await act(async () => root.render(createElement(BasicsStep, { api, onOpenExisting: vi.fn(), onRequested: vi.fn() })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const change = async (label: string, value: string) => {
  await act(async () => {
    const el = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const wait = async () => { await act(async () => vi.advanceTimersByTime(400)); };
const next = () => host.querySelector<HTMLButtonElement>(".tf-go")!;
it("does not show an error during partial typing, validates on blur, and clears it on correction", async () => {
  await change("تلفن", "091");
  expect(input("تلفن").getAttribute("aria-invalid")).toBe("false");
  await act(async () => input("تلفن").dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(input("تلفن").getAttribute("aria-invalid")).toBe("true");
  await change("تلفن", "09121234567");
  expect(input("تلفن").getAttribute("aria-invalid")).toBe("false");
});
it("removes letters on input and paste while normalizing Iranian digits", async () => {
  await change("تلفن", "+۹۸ (۹۱۲) abc۱۲۳-۴۵۶۷ح");
  expect(input("تلفن").value).toBe("+98 (912) 123-4567");
});
it("blocks Continue until the current check resolves and displays a phone duplicate before advancing", async () => {
  let resolve!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(r => { resolve = r; }));
  await change("نام کسب‌وکار", "رستوران تست");
  await change("تلفن", "09121234567");
  expect(next().disabled).toBe(true);
  await wait();
  expect(next().disabled).toBe(true);
  await act(async () => resolve({ ok: true, json: async () => ({ ok: true, matches: [{ kind: "phone", reachable: true, id: 3, name: "مشتری موجود", area: null, owner_name: null, distance_km: null }] }) }));
  expect(host.textContent).toContain("مشتری موجود");
  expect(next().disabled).toBe(true);
});
it("does not allow a failed duplicate lookup to silently pass", async () => {
  request.mockRejectedValue(new Error("offline"));
  await change("نام کسب‌وکار", "رستوران تست");
  await change("تلفن", "09121234567");
  await wait();
  expect(next().disabled).toBe(true);
  expect(host.textContent).toContain("بررسی دوباره");
});
