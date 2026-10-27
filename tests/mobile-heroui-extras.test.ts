import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ActiveTags from "@/components/mobile/ActiveTags";
import FlowProgress from "@/components/tapflow/FlowProgress";
import BusyIcon from "@/components/meridian/BusyIcon";

/** ActiveTags, FlowProgress and BusyIcon: the HeroUI Tag, ProgressBar and Spinner wrappers. */
describe("HeroUI extras", () => {
  it("ActiveTags renders nothing when no filter is on, and one removable tag per filter", () => {
    expect(renderToStaticMarkup(createElement(ActiveTags, { label: "x", items: [], onRemove: () => {} }))).toBe("");
    const html = renderToStaticMarkup(createElement(ActiveTags, { label: "x", items: [{ id: "a", label: "علی" }, { id: "b", label: "رضا" }], onRemove: () => {} }));
    expect(html).toContain("علی");
    expect(html).toContain("رضا");
  });

  it("FlowProgress reports a bounded value", () => {
    const html = renderToStaticMarkup(createElement(FlowProgress, { done: 9, total: 4 }));
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain('aria-valuemax="4"');
  });

  it("BusyIcon shows a spinner only while busy", () => {
    expect(renderToStaticMarkup(createElement(BusyIcon, { busy: true, name: "check" }))).toContain("spinner");
    expect(renderToStaticMarkup(createElement(BusyIcon, { busy: false, name: "check" }))).not.toContain("spinner");
  });
});
