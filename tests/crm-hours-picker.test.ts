// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HoursPicker from "@/components/crm/HoursPicker";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

let root: Root;
let host: HTMLDivElement;
let submit: ReturnType<typeof vi.fn<CustomStepApi["submit"]>>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  host = document.createElement("div");
  root = createRoot(host);
  submit = vi.fn();
  const api: CustomStepApi = {
    step: { id: "hours", kind: "hours", q: "ساعت کاری", options: [], choices: [], timeStep: false },
    state: { stack: ["hours"], answers: [], acc: {}, values: {}, saved: false },
    submit,
  };
  await act(async () => root.render(createElement(HoursPicker, { api })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (label: string) => {
  const found = Array.from(host.querySelectorAll("button")).find(b => b.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const click = async (label: string) => { await act(async () => button(label).click()); };
const beat = async () => { await act(async () => vi.advanceTimersByTime(100)); };

it("adds the selected class when a preset chip is clicked", async () => {
  await click("همه‌روزه");
  expect(button("همه‌روزه").classList.contains("on"), host.innerHTML).toBe(true);
});

it("acknowledges choices before advancing and saves exactly one range after a double tap", async () => {
  const preset = button("همه‌روزه");
  await act(async () => { preset.click(); preset.click(); });
  expect(preset.getAttribute("aria-pressed")).toBe("true");
  expect(preset.classList.contains("on")).toBe(true);
  expect(preset.querySelector(".tick svg")).not.toBeNull();
  expect(button("روزهای خاص…").disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(99));
  expect(host.textContent).toContain("کدام روزها باز است؟");
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.textContent).toContain("از چه ساعتی؟");
  await click("۹");
  expect(button("۹").getAttribute("aria-pressed")).toBe("true");
  await beat();
  expect(host.textContent).toContain("از ۹ تا چه ساعتی؟");
  await act(async () => { button("۱۸").click(); button("۱۸").click(); });
  await beat();
  await click("تمام");
  expect(submit).toHaveBeenCalledExactlyOnceWith("ok", JSON.stringify([
    { days: [0, 1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00" },
  ]));
});

it("keeps custom weekdays selected, supports deselection, and disables empty continuation", async () => {
  await click("روزهای خاص…");
  await beat();
  expect(button("ادامه").disabled).toBe(true);
  await click("شنبه");
  expect(button("شنبه").querySelector(".tick svg")).not.toBeNull();
  await beat();
  expect(button("شنبه").getAttribute("aria-pressed")).toBe("true");
  expect(button("ادامه").disabled).toBe(false);
  await click("شنبه");
  expect(button("شنبه").getAttribute("aria-pressed")).toBe("false");
  expect(button("ادامه").disabled).toBe(true);
});
