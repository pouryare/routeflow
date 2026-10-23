import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PasswordForm from "@/components/PasswordForm";
import ChangePasswordSection from "@/components/ChangePasswordSection";

describe("password form", () => {
  it("a change by choice asks for the current password first", () => {
    const html = renderToStaticMarkup(createElement(PasswordForm, { askCurrent: true, submitLabel: "ذخیره", onSaved: () => {} }));
    expect(html).toContain("رمز فعلی");
    expect(html).toContain('autoComplete="current-password"');
    expect(html.indexOf("رمز فعلی")).toBeLessThan(html.indexOf("رمز تازه"));
  });

  it("the forced change does not", () => {
    const html = renderToStaticMarkup(createElement(PasswordForm, { askCurrent: false, submitLabel: "ذخیره", onSaved: () => {} }));
    expect(html).not.toContain("رمز فعلی");
    expect(html).toContain("تکرار رمز");
  });

  it("the security section says saving signs out the other devices", () => {
    const html = renderToStaticMarkup(createElement(ChangePasswordSection));
    expect(html).toContain("تغییر رمز");
    expect(html).toContain("از همهٔ دستگاه‌های دیگر خارج می‌شوید");
  });
});
