// PasswordRoll (components/PasswordRoll.tsx): the letters a revealed password rolls in, and how long it takes.
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordRoll, rollMs } from "@/components/PasswordRoll";

describe("password roll", () => {
  it("draws one span per letter, each a beat later, hidden from screen readers", () => {
    const html = renderToStaticMarkup(h(PasswordRoll, { text: "ab1", at: { x: 12, font: "inherit" } }));
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/pwroll__ch/g)).toHaveLength(3);
    expect(html).toContain("--i:2");
  });
  it("runs a beat per letter, capped for a long secret", () => {
    expect(rollMs(0)).toBe(260);
    expect(rollMs(8)).toBe(540);
    expect(rollMs(100)).toBe(rollMs(24));
  });
});
