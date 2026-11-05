import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthenticatorNudge, { nudgeHidden } from "@/components/meridian/AuthenticatorNudge";

describe("authenticator nudge (FB29)", () => {
  it("stays hidden only while «بعداً» is in force", () => {
    const now = 1_000_000;
    expect(nudgeHidden(String(now + 1), now)).toBe(true);
    expect(nudgeHidden(String(now - 1), now)).toBe(false);
    expect(nudgeHidden(null, now)).toBe(false);
    expect(nudgeHidden("junk", now)).toBe(false);
  });

  it("renders nothing on the server, so a hidden nudge never flashes", () => {
    expect(renderToStaticMarkup(createElement(AuthenticatorNudge))).toBe("");
  });
});
