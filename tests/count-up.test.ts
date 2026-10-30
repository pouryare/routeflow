import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CountUp from "@/components/meridian/CountUp";

const html = (props: { value: number; mode?: "int" | "pct"; suffix?: string }) =>
  renderToStaticMarkup(createElement(CountUp, props));

describe("CountUp", () => {
  it("reads as the plain Persian figure to a screen reader", () => {
    expect(html({ value: 1234567 })).toContain('aria-label="۱٬۲۳۴٬۵۶۷"');
  });

  it("gives every digit its own column and leaves separators as text", () => {
    const h = html({ value: 1234567 });
    expect(h.match(/class="odo__col"/g)).toHaveLength(7);
    expect(h).toContain("٬");
  });

  it("points each strip at its digit", () => {
    const h = html({ value: 73 });
    expect(h).toContain("--odo-d:7");
    expect(h).toContain("--odo-d:3");
  });

  it("shows a ratio as a percent and appends the suffix", () => {
    expect(html({ value: 0.85, mode: "pct" })).toContain('aria-label="۸۵٪"');
    expect(html({ value: 4, suffix: " مشتری" })).toContain("</span> مشتری");
  });
});
