import { describe, it, expect } from "vitest";
import { nextButtonState } from "@/lib/design/statefulButton";

describe("nextButtonState", () => {
  it("idle -> loading on click", () => {
    expect(nextButtonState("idle", "click")).toBe("loading");
  });

  it("ignores a click while already loading or in success", () => {
    expect(nextButtonState("loading", "click")).toBe("loading");
    expect(nextButtonState("success", "click")).toBe("success");
  });

  it("loading -> success on resolve", () => {
    expect(nextButtonState("loading", "resolve")).toBe("success");
  });

  it("loading -> idle on reject", () => {
    expect(nextButtonState("loading", "reject")).toBe("idle");
  });

  it("success -> idle on timeout", () => {
    expect(nextButtonState("success", "timeout")).toBe("idle");
  });
});
