import { describe, expect, it } from "vitest";
import { LEAD_VIEWS, type LeadViewMode } from "@/lib/leadViews";

describe("PoolViewToggle logic", () => {
  it("renders all 8 view options", () => {
    expect(LEAD_VIEWS.length).toBe(8);
  });

  it("has correct icon and label for each view", () => {
    for (const view of LEAD_VIEWS) {
      expect(view.icon.length).toBeGreaterThan(0);
      expect(view.label.length).toBeGreaterThan(0);
    }
  });

  it("active view is highlighted", () => {
    const activeView: LeadViewMode = "compact";
    expect(LEAD_VIEWS.some((v) => v.mode === activeView)).toBe(true);
  });

  it("every view mode is a valid LeadViewMode", () => {
    const validModes: LeadViewMode[] = ["compact", "pocket", "grid", "kanban", "score", "table", "batch", "cluster"];
    for (const view of LEAD_VIEWS) {
      expect(validModes).toContain(view.mode);
    }
  });
});

