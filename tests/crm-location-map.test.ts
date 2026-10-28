// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BASEMAPS_KEY } from "@/lib/mapLayers";
import CustomerLocationMap from "@/components/crm/CustomerLocationMap";

const state = vi.hoisted(() => ({ skin: "light" }));
vi.mock("@/components/ThemeToggle", () => ({ useTheme: () => [state.skin] }));
/* The style MapLibre is handed is what decides the ground; the sprite path names its set. */
vi.mock("@vis.gl/react-maplibre", () => ({
  default: ({ mapStyle, onError, children }: { mapStyle: { sprite: string; layers: { id: string; layout?: { visibility?: string } }[] }; onError: (e: { target: null }) => void; children: React.ReactNode }) =>
    React.createElement("div", { "data-sprite": mapStyle.sprite, "data-labels": String(mapStyle.layers.some((l) => l.id === "address_label" && l.layout?.visibility !== "none")) },
      React.createElement("button", { onClick: () => onError({ target: null }) }, "no webgl"), children),
  NavigationControl: () => null,
  Marker: () => null,
  useMap: () => ({ current: null }),
}));

it("follows the skin and the basemap saved on /map, and says so when the map cannot run", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = () => act(async () => root.render(React.createElement(CustomerLocationMap, { lat: 35.7, lng: 51.4, name: "نمونه" })));
  try {
    await render();
    expect(host.querySelector("[data-sprite]")?.getAttribute("data-sprite")).toMatch(/\/map\/sprites\/light$/);
    state.skin = "dark";
    await render();
    expect(host.querySelector("[data-sprite]")?.getAttribute("data-sprite")).toMatch(/\/map\/sprites\/dark$/);
    localStorage.setItem(BASEMAPS_KEY, JSON.stringify({ dark: "black-plain", light: "light" }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: BASEMAPS_KEY })));
    expect(host.querySelector("[data-sprite]")?.getAttribute("data-labels")).toBe("false");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("[role=status]")?.textContent).toMatch(/WebGL/);
  } finally {
    await act(async () => root.unmount());
    state.skin = "light";
    vi.unstubAllGlobals();
  }
});
