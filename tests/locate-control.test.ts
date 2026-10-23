// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Map } from "leaflet";
import { readFileSync } from "node:fs";
import LocateControl from "@/components/LocateControl";

const state = vi.hoisted(() => ({
  map: null as Map | null,
  position: null as { lat: number; lng: number } | null,
  status: "idle", retry: vi.fn(),
}));
vi.mock("react-leaflet", () => ({ useMap: () => state.map }));
vi.mock("@/components/MyPositionProvider", () => ({ useMyPosition: () => state }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  state.map?.remove();
  state.map = null;
  state.position = null;
  state.status = "idle";
  state.retry.mockClear();
  document.body.replaceChildren();
});

it("uses the shared Lucide icon and retries/recentres once per click", async () => {
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
  state.map = new Map(container).setView([35.7, 51.4], 10);
  const flyTo = vi.spyOn(state.map, "flyTo").mockReturnValue(state.map);
  root = createRoot(host);
  const render = () => act(async () => { root!.render(createElement(StrictMode, null, createElement(LocateControl))); });
  await render();
  expect(container.querySelectorAll(".locate-control a")).toHaveLength(1);
  const button = container.querySelector<HTMLAnchorElement>(".locate-control a")!;
  expect(button.querySelector(".lucide-locate-fixed")?.getAttribute("stroke-width")).toBe("1.75");
  expect(button.querySelector("svg")?.getAttribute("width")).toBe("20");
  button.click();
  expect(state.retry).toHaveBeenCalledTimes(1);
  state.position = { lat: 35.8, lng: 51.5 };
  state.status = "active";
  await render();
  button.click();
  expect(flyTo).toHaveBeenCalledExactlyOnceWith([35.8, 51.5], 16, { duration: 1 });
  await act(async () => { root!.render(null); });
  button.click();
  expect(flyTo).toHaveBeenCalledTimes(1);
});

it("does not fade or recolor the location button independently of other map controls", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rules = [...css.matchAll(/\.locate-control a[^{}]*\{([^}]+)\}/g)].map((match) => match[1]).join("\n");
  expect(rules).not.toMatch(/\bopacity\s*:/);
  /* border-color is allowed (state cue); bare ink color overrides are not --
     `border-color` must not trip this, so the lookbehind excludes hyphenated
     properties like background-color. */
  expect(rules).not.toMatch(/(?:^|[^-a-zA-Z])color\s*:/);
  expect(rules).toMatch(/border-color:\s*var\(--accent\)/);
});
