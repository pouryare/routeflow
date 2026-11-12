import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QrCode from "@/components/meridian/QrCode";

describe("QrCode", () => {
  it("draws an accessible SVG with modules and never prints the text", () => {
    const uri = "otpauth://totp/RouteFlow:ali?secret=JBSWY3DPEHPK3PXP";
    const html = renderToStaticMarkup(createElement(QrCode, { text: uri, label: "qr" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="qr"');
    expect(html).toContain("<path");
    expect(html).not.toContain("JBSWY3DPEHPK3PXP");
  });
});
