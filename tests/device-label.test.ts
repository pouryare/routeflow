import { describe, it, expect } from "vitest";
import { deviceLabel } from "@/lib/deviceLabel";

describe("deviceLabel", () => {
  it("names the browser and the system", () => {
    expect(
      deviceLabel("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")
    ).toBe("Chrome روی Android");
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
    ).toBe("Safari روی iPhone");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0")
    ).toBe("Edge روی Windows");
  });

  it("says so when it cannot tell", () => {
    expect(deviceLabel(null)).toBe("دستگاه نامشخص");
    expect(deviceLabel("curl/8.0")).toBe("دستگاه نامشخص");
  });
});
