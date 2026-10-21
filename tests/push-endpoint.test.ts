import { describe, it, expect } from "vitest";
import { isAllowedPushEndpoint, isPushKey } from "@/lib/pushEndpoint";

describe("push endpoints", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/xyz",
    "https://web.push.apple.com/QAbc",
    "https://db5p.notify.windows.com/?token=1",
  ])("accepts %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/x",
    "https://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.example/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "javascript:alert(1)",
    "not a url",
    "https://fcm.googleapis.com/" + "a".repeat(1000),
    "",
    null,
  ])("refuses %s", (u) => expect(isAllowedPushEndpoint(u as never)).toBe(false));

  it("keys are short base64url strings", () => {
    expect(isPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", 200)).toBe(true);
    expect(isPushKey("x", 200)).toBe(false);
    expect(isPushKey("a b c d e f g h", 200)).toBe(false);
    expect(isPushKey("a".repeat(300), 200)).toBe(false);
  });
});
