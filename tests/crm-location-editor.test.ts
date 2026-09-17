// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LocationEditor from "@/components/crm/LocationEditor";

vi.mock("@/components/crm/CustomerLocationMap", () => ({
  default: (props: { picked: [number, number] | null; onPick?: (lat: number, lng: number) => void; children?: React.ReactNode }) =>
    React.createElement(
      "div",
      { "data-picked": props.picked ? props.picked.join(",") : "" },
      React.createElement("button", { onClick: () => props.onPick?.(35.8, 51.5) }, "pick"),
      props.children,
    ),
}));
vi.mock("@/components/MyLocationMarker", () => ({ default: () => null }));
vi.mock("@/components/MyPositionProvider", () => ({ useMyPosition: () => ({ position: null }) }));

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
const picked = () => host.querySelector("[data-picked]")?.getAttribute("data-picked") ?? "";
const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLElement).click());
const render = (props: Partial<Parameters<typeof LocationEditor>[0]> = {}) =>
  act(async () =>
    root.render(React.createElement(LocationEditor, {
      initial: { lat: 35.7, lng: 51.4 }, onConfirm: vi.fn(), onCancel: vi.fn(), ...props,
    })),
  );

it("seeds the draft from the saved pin, accepts picks and saves them", async () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  await render({ onConfirm, onCancel });
  expect(picked()).toBe("35.7,51.4");
  await click("[data-picked] button");
  expect(picked()).toBe("35.8,51.5");
  await click("[type=\"button\"].btn.solid");
  expect(onConfirm).toHaveBeenCalledWith(35.8, 51.5, undefined);
  await click(".edit-actions .btn.ghost");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("keeps the draft, link text and DOM node while expanding and collapsing", async () => {
  const onExpandChange = vi.fn();
  await render({ expandable: true, onExpandChange });
  const node = host.querySelector("[data-picked]")!;
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://maps.app.goo.gl/draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("[data-picked] button");
  await click('[aria-label="بزرگ‌نمایی ناحیهٔ ویرایش"]');
  expect(onExpandChange).toHaveBeenCalledWith(true);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("[data-picked]")).toBe(node);
  expect(input.value).toBe("https://maps.app.goo.gl/draft");
  expect(picked()).toBe("35.8,51.5");
});

it("keeps the draft and reports the error when saving fails", async () => {
  const onConfirm = vi.fn().mockRejectedValue(new Error("ذخیره نشد"));
  await render({ onConfirm });
  await click("[data-picked] button");
  await click("[type=\"button\"].btn.solid");
  expect(host.querySelector("[role=\"alert\"]")?.textContent).toContain("ذخیره نشد");
  expect(picked()).toBe("35.8,51.5");
});

it("resolves a pasted link into a pin and keeps the draft when resolution fails", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ json: async () => ({ ok: true, link: { lat: 35.71, lng: 51.41 } }) })
    .mockResolvedValueOnce({ json: async () => ({ ok: false, error: "مختصات از این لینک قابل استخراج نبود" }) });
  vi.stubGlobal("fetch", fetchMock);
  try {
    await render();
    const input = host.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://maps.app.goo.gl/abc");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("[aria-label=\"خواندن پیوند موقعیت\"]");
    expect(picked()).toBe("35.71,51.41");
    await click("[aria-label=\"خواندن پیوند موقعیت\"]");
    expect(host.querySelector("[role=\"alert\"]")?.textContent).toContain("قابل استخراج");
    expect(picked()).toBe("35.71,51.41");
  } finally { /* Globals are restored after the root unmounts. */ }
});

it("does not invent a pin when a link resolves without coordinates", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, link: { lat: null, lng: null } }) }));
  await render({ initial: null });
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://maps.app.goo.gl/missing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click('[aria-label="خواندن پیوند موقعیت"]');
  expect(picked()).toBe("");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("قابل استخراج نبود");
  expect((host.querySelector(".edit-actions .solid") as HTMLButtonElement).disabled).toBe(true);
});
