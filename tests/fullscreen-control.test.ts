// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Map } from "leaflet";
import { readFileSync } from "node:fs";
import path from "node:path";
import FullscreenControl from "@/components/FullscreenControl";

const state = vi.hoisted(() => ({ map: null as Map | null }));
vi.mock("react-leaflet", () => ({ useMap: () => state.map }));

let root: Root | undefined;

// React's act environment flag is not provided by a testing-library wrapper here.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  state.map?.remove();
  state.map = null;
  document.body.replaceChildren();
});

describe("fullscreen map control", () => {
  it("keeps one button after Strict Mode effect replay and preserves zoom on unmount", async () => {
    const container = document.createElement("div");
    const host = document.createElement("div");
    document.body.append(container, host);
    state.map = new Map(container).setView([35.7, 51.4], 10);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(StrictMode, null, createElement(FullscreenControl))); });

    expect(container.querySelectorAll(".leaflet-control-zoom-fullscreen")).toHaveLength(1);
    expect(container.querySelectorAll(".leaflet-control-zoom-in")).toHaveLength(1);
    const button = container.querySelector<HTMLAnchorElement>(".leaflet-control-zoom-fullscreen")!;
    expect(button.className).not.toContain("leaflet-fullscreen-icon");
    expect(button.querySelector(".lucide-maximize")?.getAttribute("stroke")).toBe("currentColor");
    expect(button.querySelector(".lucide-minimize")?.getAttribute("stroke-width")).toBe("1.75");
    await state.map.fullscreenControl!.toggleFullScreen();
    expect(container.classList.contains("leaflet-pseudo-fullscreen")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await state.map.fullscreenControl!.toggleFullScreen();
    expect(container.classList.contains("leaflet-pseudo-fullscreen")).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    await act(async () => { root!.render(null); });
    expect(container.querySelectorAll(".leaflet-control-zoom-fullscreen")).toHaveLength(0);
    expect(container.querySelectorAll(".leaflet-control-zoom-in")).toHaveLength(1);
  });

  it("themes map buttons without erasing their background-image icons", () => {
    const css = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
    const rule = css.match(/\.leaflet-bar a\s*\{([^}]+)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/\bbackground\s*:/);
    expect(rule).toMatch(/background-color:\s*var\(--surface\)/);
  });
});
