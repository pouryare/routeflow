// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BasicsStep from "@/components/crm/BasicsStep";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

let root: Root;
let host: HTMLDivElement;
let submit: ReturnType<typeof vi.fn<CustomStepApi["submit"]>>;
let fetchMock: ReturnType<typeof vi.fn>;

const LINK = JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک", maps_url: "https://maps.app.goo.gl/x" });
const IG_LINK = JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک", maps_url: "https://www.instagram.com/kababi.nayeb/" });

const input = (label: string) => {
  const found = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`Missing input: ${label}`);
  return found;
};
const type = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const flushCheck = async () => { await act(async () => vi.advanceTimersByTime(400)); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  submit = vi.fn();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, matches: [] }) }));
  vi.stubGlobal("fetch", fetchMock);
  const api: CustomStepApi = {
    step: { id: "basics", kind: "basics", q: "نام و تلفن", options: [], choices: [], timeStep: false, skipable: true },
    state: { stack: ["basics"], answers: [], acc: { source: "SNAPPFOOD" }, values: { link: LINK }, saved: false },
    submit,
  };
  await act(async () => root.render(createElement(BasicsStep, { api, onOpenExisting: vi.fn(), onRequested: vi.fn() })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("prefills the page from an Instagram link on mount", async () => {
  await act(async () => root.render(createElement(BasicsStep, {
    key: "instagram-prefill",
    api: {
      step: { id: "basics", kind: "basics", q: "نام و تلفن", options: [], choices: [], timeStep: false, skipable: true },
      state: { stack: ["basics"], answers: [], acc: {}, values: { link: IG_LINK }, saved: false },
      submit,
    },
    onOpenExisting: vi.fn(), onRequested: vi.fn(),
  })));
  await act(async () => vi.advanceTimersByTime(400));
  expect(input("صفحهٔ اینستاگرام").value).toBe("https://www.instagram.com/kababi.nayeb/");
  expect(submit).not.toHaveBeenCalled();
});

it("sends the page along the duplicate check and submits it with the basics", async () => {
  await type(input("صفحهٔ اینستاگرام"), "@Cafe.Lamiz");
  await flushCheck();
  const url = String(fetchMock.mock.calls.at(-1)![0]);
  expect(url).toContain("instagram=%40Cafe.Lamiz");
  expect((host.querySelector("button.tf-go") as HTMLButtonElement).disabled).toBe(false);
  await act(async () => (host.querySelector("button.tf-go") as HTMLButtonElement).click());
  expect(submit).toHaveBeenCalledExactlyOnceWith("ok", JSON.stringify({ name: "کافه نو", phone: null, instagram: "@Cafe.Lamiz", branch_of: null }));
});

it("blocks continuation while a page belongs to another business and lets the rep clear it", async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, matches: [{ kind: "instagram", reachable: false, id: null, name: null, area: "ونک", owner_name: "نازنین", distance_km: null }] }) }));
  await type(input("صفحهٔ اینستاگرام"), "kababi.hot");
  await flushCheck();
  expect(host.textContent).toContain("این کسب‌وکار قبلاً ثبت شده");
  expect((host.querySelector("button.tf-go") as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).not.toContain("درخواست واگذاری");
  const clear = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "صفحه را اصلاح کنم");
  expect(clear).toBeDefined();
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, matches: [] }) }));
  await act(async () => clear!.click());
  expect(input("صفحهٔ اینستاگرام").value).toBe("");
  await flushCheck();
  expect((host.querySelector("button.tf-go") as HTMLButtonElement).disabled).toBe(false);
});

it("clears a reachable Instagram duplicate without erasing the phone", async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, matches: [{ kind: "instagram", reachable: true, id: 42, name: "کافه قدیمی", area: null, owner_name: null, distance_km: null }] }) }));
  await type(input("تلفن"), "09121234567");
  await type(input("صفحهٔ اینستاگرام"), "cafe.old");
  await flushCheck();
  expect(host.textContent).toContain("این صفحهٔ اینستاگرام مال");
  const clear = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "صفحه را اصلاح کنم");
  expect(clear).toBeDefined();
  await act(async () => clear!.click());
  expect(input("صفحهٔ اینستاگرام").value).toBe("");
  expect(input("تلفن").value).toBe("09121234567");
});

