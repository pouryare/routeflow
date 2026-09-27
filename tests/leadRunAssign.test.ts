import { describe, it, expect } from "vitest";
import {
  busyDatesByDriver,
  blockedDates,
  needsOverride,
  busyLabel,
  donePhase,
  summaryOf,
} from "@/lib/leadRunAssign";

const RUNS = [
  { driver_user_id: 5, run_date: "2026-09-27", status: "planned" as const },
  { driver_user_id: 5, run_date: "2026-09-28", status: "done" as const },
  { driver_user_id: 6, run_date: "2026-09-27", status: "in_progress" as const },
];

describe("busyDatesByDriver", () => {
  it("folds runs per driver, keeping the status of each day", () => {
    const m = busyDatesByDriver(RUNS);
    expect(m.get(5)?.get("2026-09-27")).toBe("planned");
    expect(m.get(5)?.get("2026-09-28")).toBe("done");
    expect(m.get(6)?.get("2026-09-27")).toBe("in_progress");
  });

  it("leaves a driver with no runs absent rather than empty", () => {
    expect(busyDatesByDriver(RUNS).has(99)).toBe(false);
    expect(busyDatesByDriver([]).size).toBe(0);
  });
});

describe("blockedDates", () => {
  const busy = busyDatesByDriver(RUNS).get(5);

  it("blocks an active day and leaves a completed one pickable", () => {
    const blocked = blockedDates(busy);
    expect(blocked.has("2026-09-27")).toBe(true); // planned
    expect(blocked.has("2026-09-28")).toBe(false); // done -- overridable
  });

  it("blocks nothing for a driver who has no runs", () => {
    expect(blockedDates(undefined).size).toBe(0);
    expect(blockedDates(busyDatesByDriver(RUNS).get(99)).size).toBe(0);
  });
});

describe("needsOverride", () => {
  const busy = busyDatesByDriver(RUNS).get(5);

  it("is true only for a completed day, and false for a free one", () => {
    expect(needsOverride(busy, "2026-09-28")).toBe(true);
    expect(needsOverride(busy, "2026-09-27")).toBe(false);
    expect(needsOverride(busy, "2026-10-01")).toBe(false);
    expect(needsOverride(undefined, "2026-10-01")).toBe(false);
  });
});

describe("busyLabel", () => {
  it("says nothing for zero, and uses Persian's singular for one", () => {
    expect(busyLabel(0)).toBeNull();
    expect(busyLabel(1)).toBe("۱ روز مسیر دارد");
    expect(busyLabel(3)).toBe("۳ روز مسیر دارد");
  });
});

describe("donePhase", () => {
  /* The bug this pins: `saved` flips before the POST resolves, so a phase derived from
     anything but the message claimed success and then took it back. */
  it("claims nothing until a message arrives", () => {
    expect(donePhase(null)).toBe("saving");
  });

  it("reads the message's tone once it is there", () => {
    expect(donePhase({ tone: "ok" })).toBe("ok");
    expect(donePhase({ tone: "bad" })).toBe("bad");
  });
});

describe("summaryOf", () => {
  it("lists who, which day and how many stops, in Shamsi", () => {
    const lines = summaryOf({ driverName: "رضا احمدی", runDate: "2026-09-27", stopCount: 5 });
    expect(lines[0]).toBe("رضا احمدی");
    expect(lines[2]).toBe("۵ توقف");
    // A Shamsi date, not the ISO one -- the whole point of picking it in the first place.
    expect(lines[1]).toMatch(/۱۴۰۵/);
    expect(lines[1]).not.toBe("2026-09-27");
  });

  it("says so plainly when a field is missing rather than rendering nothing", () => {
    const lines = summaryOf({ driverName: null, runDate: "", stopCount: 0 });
    expect(lines[0]).toBe("راننده انتخاب نشده");
    expect(lines[1]).toBe("تاریخ انتخاب نشده");
  });
});
