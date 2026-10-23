// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LeadPanels from "@/components/analysis/LeadPanels";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const serve = (locations: unknown[]) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ locations }))));

it("with no scores yet, says so instead of drawing an empty chart", async () => {
  const unscored = { rating_potential: null, rating_volume: null, rating_ease: null };
  serve([{ status: null, ...unscored }, { status: "visited", ...unscored }]);
  await act(async () => root.render(createElement(LeadPanels)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(host.textContent).toContain("هنوز به سرنخی امتیاز داده نشده است.");
  expect(host.textContent).not.toContain("ستاره");
});

it("with scores, draws the star buckets", async () => {
  serve([{ status: "visited", rating_potential: 5, rating_volume: 5, rating_ease: 5 }]);
  await act(async () => root.render(createElement(LeadPanels)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(host.textContent).toContain("۵ ستاره");
  expect(host.textContent).not.toContain("هنوز به سرنخی امتیاز");
});
