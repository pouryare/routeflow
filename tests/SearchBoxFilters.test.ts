import { describe, expect, it } from "vitest";
import { SORT_OPTIONS } from "@/components/SearchBox";
import { detectInputType } from "@/components/SearchBox";

describe("sort options by view", () => {
  it("shows all 7 options in default view", () => {
    expect(SORT_OPTIONS.length).toBe(7);
  });

  it("hides status in kanban view", () => {
    const kanbanOptions = SORT_OPTIONS.filter((o) => o.value !== "status");
    expect(kanbanOptions.length).toBe(6);
  });

  it("shows only score in score view", () => {
    const scoreOptions = SORT_OPTIONS.filter((o) => o.value === "score");
    expect(scoreOptions.length).toBe(1);
  });
});

describe("detectInputType", () => {
  it("detects coordinates", () => {
    expect(detectInputType("35.7, 51.4")).toBe("coord");
  });

  it("detects Persian address", () => {
    expect(detectInputType("تهران تجریش")).toBe("address");
  });

  it("detects name query", () => {
    expect(detectInputType("حسن")).toBe("name");
  });
});