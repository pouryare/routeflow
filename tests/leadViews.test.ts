import { describe, expect, it, beforeEach } from "vitest";
import { vi } from "vitest";
import { LEAD_VIEWS, readViewMode, saveViewMode, STORAGE_KEY, type LeadViewMode } from "@/lib/leadViews";

const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", mockLocalStorage);
});

describe("LEAD_VIEWS", () => {
  it("defines all 8 view modes", () => {
    expect(LEAD_VIEWS.length).toBe(8);
  });

  it("includes compact as the first mode", () => {
    expect(LEAD_VIEWS[0].mode).toBe("compact");
  });

  it("every mode has a label, icon, and description", () => {
    for (const v of LEAD_VIEWS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.icon.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it("all modes are unique", () => {
    const modes = LEAD_VIEWS.map((v) => v.mode);
    expect(new Set(modes).size).toBe(modes.length);
  });
});

describe("LeadViewMode union", () => {
  it("covers all expected modes", () => {
    const expected: LeadViewMode[] = ["compact", "pocket", "grid", "kanban", "score", "table", "batch", "cluster"];
    for (const mode of expected) {
      expect(LEAD_VIEWS.some((v) => v.mode === mode)).toBe(true);
    }
  });
});

describe("readViewMode", () => {
  it("returns compact when nothing is stored", () => {
    expect(readViewMode()).toBe("compact");
  });

  it("returns stored mode when valid", () => {
    mockLocalStorage.setItem(STORAGE_KEY, "grid");
    expect(readViewMode()).toBe("grid");
  });

  it("returns compact for an invalid stored mode", () => {
    mockLocalStorage.setItem(STORAGE_KEY, "invalid_mode");
    expect(readViewMode()).toBe("compact");
  });
});

describe("saveViewMode", () => {
  it("persists the mode to localStorage", () => {
    saveViewMode("kanban");
    expect(mockLocalStorage.getItem(STORAGE_KEY)).toBe("kanban");
  });

  it("handles localStorage errors silently", () => {
    const brokenStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    vi.stubGlobal("localStorage", brokenStorage);
    expect(() => saveViewMode("grid")).not.toThrow();
  });
});

