// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WidgetBoundary from "@/components/WidgetBoundary";

let root: Root;
let host: HTMLDivElement;
let broken: boolean;

function Widget() {
  if (broken) throw new Error("tiles failed");
  return createElement("p", { id: "ok" }, "نقشه");
}

// The component's props require children; createElement wants them as an argument instead.
const boundary = (props: { label: string; resetKeys?: unknown[] }) =>
  createElement(WidgetBoundary as React.ComponentType<typeof props>, props, createElement(Widget));

const mount = async (children: React.ReactNode) => {
  await act(async () => root.render(children));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  broken = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders the widget untouched when nothing throws", async () => {
  await mount(boundary({ label: "نقشه" }));
  expect(host.querySelector("#ok")).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("keeps the page: a throwing widget becomes a named message, its sibling stays", async () => {
  broken = true;
  await mount(
    createElement(
      "div",
      null,
      createElement("span", { id: "sibling" }, "فهرست"),
      boundary({ label: "نقشه" }),
    ),
  );
  expect(host.querySelector("#sibling")).not.toBeNull();
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("نقشه درست بار نشد");
});

it("retries in place: the retry button renders the widget again", async () => {
  broken = true;
  await mount(boundary({ label: "نقشه" }));
  broken = false;
  const retry = host.querySelector<HTMLButtonElement>("button");
  expect(retry?.getAttribute("aria-label")).toBe("تلاش دوباره برای نقشه");
  await act(async () => retry!.click());
  expect(host.querySelector("#ok")).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("clears a stale failure by itself when resetKeys change", async () => {
  broken = true;
  const tree = (key: number) =>
    boundary({ label: "نقشه", resetKeys: [key] });
  await mount(tree(1));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  broken = false;
  await mount(tree(2));
  expect(host.querySelector("#ok")).not.toBeNull();
});
