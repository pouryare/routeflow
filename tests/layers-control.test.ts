// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { act, createElement, Fragment, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Map } from "leaflet";
import LayersPanel, { LayersControl } from "@/components/LayersPanel";
import { parseLayerPrefs } from "@/lib/mapLayers";

const state = vi.hoisted(() => ({ map: null as Map | null }));
vi.mock("react-leaflet", () => ({ useMap: () => state.map }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  state.map?.remove();
  state.map = null;
  document.body.replaceChildren();
});

it("opens and closes the layers panel once per click after Strict Mode replay", async () => {
  const clicks = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(Fragment, null,
      createElement(LayersControl, {
        open, count: 0,
        onClick: () => { clicks(); setOpen((value) => !value); },
      }),
      createElement(LayersPanel, {
        open, onClose: () => setOpen(false), basemap: "positron",
        onBasemap: () => {}, layers: parseLayerPrefs(null), onLayer: () => {},
        zoneStatus: null, hasCorridor: false,
      }),
    );
  }
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
  state.map = new Map(container).setView([35.7, 51.4], 10);
  root = createRoot(host);
  await act(() => root!.render(createElement(StrictMode, null, createElement(Harness))));
  const buttons = container.querySelectorAll<HTMLAnchorElement>(".layers-toggle-control a");
  expect(buttons).toHaveLength(1);
  const button = buttons[0];
  expect(button.querySelector("svg")).not.toBeNull();
  await act(() => button.click());
  expect.soft(clicks).toHaveBeenCalledTimes(1);
  expect.soft(button.getAttribute("aria-expanded")).toBe("true");
  expect.soft(host.querySelector('[role="dialog"]')).not.toBeNull();

  await act(() => button.click());
  expect(clicks).toHaveBeenCalledTimes(2);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector('[role="dialog"]')).toBeNull();

  await act(() => root!.render(null));
  expect(container.querySelector(".layers-toggle-control")).toBeNull();
  button.click();
  expect(clicks).toHaveBeenCalledTimes(2);
});
