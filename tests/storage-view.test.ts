import { describe, it, expect } from "vitest";
import { faBytes, planGb, providerLabel, usagePercent, usageTone } from "@/lib/storage/view";

const GB = 1024 ** 3;

describe("storage page numbers", () => {
  it("writes sizes in Persian units", () => {
    expect(faBytes(500)).toBe("۵۰۰ بایت");
    expect(faBytes(820 * 1024 ** 2)).toBe("۸۲۰ مگابایت");
    expect(faBytes(3.24 * GB)).toBe("۳٫۲ گیگابایت");
    expect(faBytes(5 * 1024 * GB)).toBe("۵ ترابایت");
  });

  it("colours usage by the warning level and the plan size", () => {
    const s = { plan_bytes: 100, warn_percent: 90 };
    expect(usageTone({ ...s, plan_bytes: null, used_bytes: 5 })).toBe("none");
    expect(usageTone({ ...s, used_bytes: 50 })).toBe("ok");
    expect(usageTone({ ...s, used_bytes: 90 })).toBe("warn");
    expect(usageTone({ ...s, used_bytes: 130 })).toBe("over");
    expect(usagePercent({ plan_bytes: 100, used_bytes: 130 })).toBe(100);
    expect(usagePercent({ plan_bytes: null, used_bytes: 130 })).toBe(0);
  });

  it("names the provider and turns stored bytes back into GB", () => {
    expect(providerLabel({ kind: "local", endpoint: null })).toMatch("دیسک");
    expect(providerLabel({ kind: "s3", endpoint: "https://s3.example.ir" })).toBe("s3.example.ir");
    expect(planGb(5 * GB)).toBe(5);
    expect(planGb(null)).toBeNull();
  });
});
