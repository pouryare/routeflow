import { describe, it, expect } from "vitest";
import { checkMaintenance, maintenancePhase, tehranInstant } from "@/lib/maintenance";

describe("maintenance banner (T17)", () => {
  const m = { from: "2026-11-06T18:30:00.000Z", to: "2026-11-06T19:30:00.000Z", note: null };

  it("announces before, warns during, and is gone after", () => {
    expect(maintenancePhase(m, "2026-11-06T10:00:00.000Z")).toBe("soon");
    expect(maintenancePhase(m, "2026-11-06T19:00:00.000Z")).toBe("now");
    expect(maintenancePhase(m, "2026-11-06T19:30:00.000Z")).toBe("none");
    expect(maintenancePhase(null, "2026-11-06T19:00:00.000Z")).toBe("none");
  });

  it("reads the owner's hour as Tehran time", () => {
    expect(tehranInstant("2026-11-06", 22)).toBe("2026-11-06T18:30:00.000Z");
  });

  it("refuses an end before the start and a window over three days", () => {
    expect(checkMaintenance(m.from, m.to)).toBeNull();
    expect(checkMaintenance(m.to, m.from)).toMatch(/بعد از شروع/);
    expect(checkMaintenance(m.from, "2026-11-12T00:00:00.000Z")).toMatch(/سه روز/);
  });
});
