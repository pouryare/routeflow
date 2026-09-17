// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useChoiceFeedback } from "@/components/tapflow/useChoiceFeedback";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("shows the selected option for 100 ms, ignores double taps, and cancels on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let choice!: ReturnType<typeof useChoiceFeedback>;
  function Harness() { choice = useChoiceFeedback(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  const submit = vi.fn();
  await act(async () => { choice.choose("a", submit); choice.choose("b", submit); });
  expect(choice.selected).toBe("a");
  await act(async () => vi.advanceTimersByTime(99));
  expect(submit).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => choice.choose("b", submit));
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTime(100));
  expect(submit).toHaveBeenCalledTimes(1);
});
