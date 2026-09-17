// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { basemapDef, BASEMAPS_KEY } from "@/lib/mapLayers";
import CustomerLocationMap from "@/components/crm/CustomerLocationMap";

const state = vi.hoisted(() => ({ skin: "light" }));
vi.mock("@/components/ThemeToggle", () => ({ useTheme: () => [state.skin] }));
const map = vi.hoisted(() => ({ invalidateSize: vi.fn(), getContainer: () => document.createElement("div"), setView: vi.fn(), getZoom: () => 16 }));
vi.mock("react-leaflet", () => ({
  useMap: () => map,
  useMapEvents: vi.fn(),
  MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  TileLayer: ({ url, className }: { url: string; className: string }) => React.createElement("div", { "data-tiles": url, className }),
  Marker: () => null,
}));
vi.mock("next/dynamic", () => ({ default: () => function Vector({ styleUrl, onError }: { styleUrl: string; onError: () => void }) {
  return React.createElement("button", { "data-vector": styleUrl, onClick: onError }, "fail renderer");
} }));

it("uses /map defaults, follows theme, and honors saved vector basemaps with fallback", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = () => act(async () => root.render(React.createElement(CustomerLocationMap, { lat: 35.7, lng: 51.4, name: "نمونه" })));
  try {
    await render();
    expect(host.querySelector("[data-tiles]")?.className).toBe(basemapDef("apple").toneClass ?? "");
    state.skin = "dark";
    await render();
    expect(host.querySelector("[data-tiles]")?.className).toBe(basemapDef("dark").toneClass ?? "");
    localStorage.setItem(BASEMAPS_KEY, JSON.stringify({ dark: "radar", light: "apple" }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: BASEMAPS_KEY })));
    expect(host.querySelector("[data-vector]")?.getAttribute("data-vector")).toBe(basemapDef("radar").styleUrl);
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("[data-vector]")).toBeNull();
    expect(host.querySelector("[data-tiles]")?.getAttribute("data-tiles")).toBe(basemapDef("radar").rasterFallback?.url);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    state.skin = "light";
    vi.unstubAllGlobals();
  }
});
