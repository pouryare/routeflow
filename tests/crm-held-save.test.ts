// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useHeldSave } from "@/components/crm/useHeldSave";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("removes both page lifecycle listeners on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const addWindow = vi.spyOn(window, "addEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  const addDocument = vi.spyOn(document, "addEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  function Harness() { useHeldSave(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Harness)); });
  const pagehide = addWindow.mock.calls.find(([event]) => event === "pagehide");
  const visibility = addDocument.mock.calls.find(([event]) => event === "visibilitychange");
  await act(async () => { root.unmount(); });
  expect(pagehide).toBeDefined();
  expect(visibility).toBeDefined();
  expect(removeWindow).toHaveBeenCalledWith("pagehide", pagehide![1]);
  expect(removeDocument).toHaveBeenCalledWith("visibilitychange", visibility![1]);
});
