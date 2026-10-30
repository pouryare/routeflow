// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement, Fragment, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import LocateControl from "@/components/LocateControl";
import FullscreenControl from "@/components/FullscreenControl";
import LayersPanel, { LayersControl } from "@/components/LayersPanel";
import { parseLayerPrefs } from "@/lib/mapLayers";

/* A stand-in for MapLibre: the controls only need a corner to sit in and a camera to move. */
const state = vi.hoisted(() => ({
  corner: null as HTMLElement | null,
  box: null as HTMLElement | null,
  flyTo: vi.fn(),
  position: null as { lat: number; lng: number } | null,
  status: "idle",
  retry: vi.fn(),
}));
vi.mock("@vis.gl/react-maplibre", () => ({
  useMap: () => ({ current: { flyTo: state.flyTo, getZoom: () => 10, getContainer: () => state.box, resize: () => {} } }),
  useControl: (create: () => { onAdd: () => HTMLElement; onRemove: () => void }) => {
    const [control] = useState(create);
    useEffect(() => {
      state.corner!.append(control.onAdd());
      return () => control.onRemove();
    }, [control]);
    return control;
  },
}));
vi.mock("@/components/MyPositionProvider", () => ({ useMyPosition: () => state }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  state.position = null;
  state.status = "idle";
  state.retry.mockClear();
  state.flyTo.mockClear();
  document.body.replaceChildren();
});

function mount(node: ReturnType<typeof createElement>) {
  state.corner = document.createElement("div");
  state.box = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(state.box, state.corner, host);
  root = createRoot(host);
  return act(async () => { root!.render(createElement(StrictMode, null, node)); });
}

it("locate: one 44px button with the shared icon; asks again without a fix, recentres with one", async () => {
  await mount(createElement(LocateControl));
  const buttons = state.corner!.querySelectorAll<HTMLButtonElement>("button.locate-control");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].querySelector(".lucide-locate-fixed")).not.toBeNull();
  buttons[0].click();
  expect(state.retry).toHaveBeenCalledTimes(1);
  state.position = { lat: 35.8, lng: 51.5 };
  state.status = "active";
  await act(async () => { root!.render(createElement(LocateControl)); });
  state.corner!.querySelector<HTMLButtonElement>("button.locate-control")!.click();
  expect(state.flyTo).toHaveBeenCalledExactlyOnceWith({ center: [51.5, 35.8], zoom: 16, duration: 1000 });
  expect(state.corner!.querySelector("button.locate-control--active")).not.toBeNull();
});

it("locate: state shows on the border only, never by fading or recolouring the icon", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rules = [...css.matchAll(/\.map-button\.locate-control[^{}]*\{([^}]+)\}/g)].map((m) => m[1]).join("\n");
  expect(rules).not.toMatch(/\bopacity\s*:/);
  expect(rules).not.toMatch(/(?:^|[^-a-zA-Z])color\s*:/);
  expect(rules).toMatch(/border-color:\s*var\(--accent\)/);
});

it("fullscreen: falls back to pinning the map box where the Fullscreen API is missing", async () => {
  Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
  await mount(createElement(FullscreenControl));
  const button = state.corner!.querySelector<HTMLButtonElement>("button.map-button")!;
  expect(button.getAttribute("aria-label")).toBe("تمام صفحه");
  await act(async () => { button.click(); });
  expect(state.box!.classList.contains("map-pseudo-fullscreen")).toBe(true);
  expect(button.getAttribute("aria-label")).toBe("خروج از تمام صفحه");
  await act(async () => { button.click(); });
  expect(state.box!.classList.contains("map-pseudo-fullscreen")).toBe(false);
});

it("layers: opens and closes the panel once per click after Strict Mode replay", async () => {
  const clicks = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(Fragment, null,
      createElement(LayersControl, { open, count: 0, onClick: () => { clicks(); setOpen((v) => !v); } }),
      createElement(LayersPanel, {
        open, onClose: () => setOpen(false), basemap: "white",
        onBasemap: () => {}, layers: parseLayerPrefs(null), onLayer: () => {},
        zoneStatus: null, hasCorridor: false,
      }),
    );
  }
  await mount(createElement(Harness));
  const buttons = state.corner!.querySelectorAll<HTMLButtonElement>("button.layers-toggle");
  expect(buttons).toHaveLength(1);
  const button = buttons[0];
  await act(async () => { button.click(); });
  expect(clicks).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => { button.click(); });
  expect(clicks).toHaveBeenCalledTimes(2);
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
