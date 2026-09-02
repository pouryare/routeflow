import { describe, it, expect } from "vitest";
import {
  lanesFor,
  laneOf,
  movePatch,
  stageFromStatus,
  statusFromStage,
  bucket,
  dateForBucket,
} from "@/lib/tasks/lenses";

const NOW = "2026-09-02T09:00:00.000Z"; // a Wednesday

describe("lenses — lanesFor", () => {
  it("status lanes", () => {
    expect(lanesFor("status").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
  it("time lanes", () => {
    expect(lanesFor("time").map((l) => l.id)).toEqual(["backlog", "today", "week", "done"]);
  });
  it("workflow lanes for a known kind", () => {
    expect(lanesFor("workflow", "outreach").map((l) => l.id)).toEqual([
      "call",
      "waiting",
      "scheduled",
      "done",
    ]);
    expect(lanesFor("workflow", "order").map((l) => l.id)).toEqual([
      "pending",
      "ready",
      "transit",
      "delivered",
    ]);
    expect(lanesFor("workflow", "visit").map((l) => l.id)).toEqual(["plan", "enroute", "done"]);
  });
  it("workflow falls back to status lanes for an unknown kind", () => {
    expect(lanesFor("workflow", "note").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
    expect(lanesFor("workflow").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
  it("every lane carries a non-empty label", () => {
    for (const v of ["status", "time", "workflow"] as const) {
      for (const l of lanesFor(v, "outreach")) expect(l.label.length).toBeGreaterThan(0);
    }
  });
});

describe("lenses — laneOf", () => {
  it("status view uses status", () => {
    expect(
      laneOf({ kind: "order", status: "in_progress", stage: null, due_at: null }, "status", NOW)
    ).toBe("in_progress");
  });
  it("time view: done wins over the date bucket", () => {
    expect(laneOf({ kind: "order", status: "done", stage: null, due_at: NOW }, "time", NOW)).toBe(
      "done"
    );
  });
  it("time view buckets by due date", () => {
    expect(laneOf({ kind: "order", status: "open", stage: null, due_at: NOW }, "time", NOW)).toBe(
      "today"
    );
    expect(
      laneOf({ kind: "order", status: "open", stage: null, due_at: null }, "time", NOW)
    ).toBe("backlog");
    // overdue lands in "today", not a lane of its own
    expect(
      laneOf(
        { kind: "order", status: "open", stage: null, due_at: "2026-08-20T00:00:00Z" },
        "time",
        NOW
      )
    ).toBe("today");
  });
  it("workflow view derives a stage when none is stored", () => {
    expect(
      laneOf({ kind: "outreach", status: "open", stage: null, due_at: null }, "workflow", NOW)
    ).toBe("call");
    expect(
      laneOf({ kind: "outreach", status: "in_progress", stage: "waiting", due_at: null }, "workflow", NOW)
    ).toBe("waiting");
    // unknown kind → the status is the lane
    expect(
      laneOf({ kind: "note", status: "open", stage: null, due_at: null }, "workflow", NOW)
    ).toBe("open");
  });
});

describe("lenses — movePatch", () => {
  it("status move sets status and syncs stage", () => {
    expect(
      movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "status", "done", NOW)
    ).toEqual({ status: "done", stage: "done" });
    expect(
      movePatch({ kind: "note", status: "open", stage: null, due_at: null }, "status", "in_progress", NOW)
    ).toEqual({ status: "in_progress", stage: null });
  });
  it("time move to a bucket sets due_at and keeps a non-done status", () => {
    const p = movePatch(
      { kind: "order", status: "open", stage: null, due_at: null },
      "time",
      "today",
      NOW
    );
    expect(p.status).toBe("open");
    expect(p.due_at).toBe("2026-09-02");
  });
  it("time move to backlog clears due_at", () => {
    expect(
      movePatch({ kind: "order", status: "open", stage: null, due_at: NOW }, "time", "backlog", NOW).due_at
    ).toBe(null);
  });
  it("time move to done closes it", () => {
    expect(
      movePatch({ kind: "order", status: "open", stage: null, due_at: NOW }, "time", "done", NOW)
    ).toEqual({ status: "done" });
  });
  it("time move off done re-opens to in_progress", () => {
    expect(
      movePatch({ kind: "order", status: "done", stage: null, due_at: NOW }, "time", "today", NOW).status
    ).toBe("in_progress");
  });
  it("workflow move sets stage and derives status", () => {
    expect(
      movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "workflow", "scheduled", NOW)
    ).toEqual({ stage: "scheduled", status: "in_progress" });
    expect(
      movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "workflow", "done", NOW)
    ).toEqual({ stage: "done", status: "done" });
    expect(
      movePatch({ kind: "order", status: "in_progress", stage: "transit", due_at: null }, "workflow", "pending", NOW)
    ).toEqual({ stage: "pending", status: "open" });
  });
});

describe("lenses — stage/status helpers", () => {
  it("stageFromStatus", () => {
    expect(stageFromStatus("outreach", "open")).toBe("call");
    expect(stageFromStatus("outreach", "in_progress")).toBe("waiting");
    expect(stageFromStatus("outreach", "done")).toBe("done");
    expect(stageFromStatus("visit", "in_progress")).toBe("enroute");
    expect(stageFromStatus("note", "open")).toBe(null);
  });
  it("statusFromStage", () => {
    expect(statusFromStage("order", "pending")).toBe("open");
    expect(statusFromStage("order", "ready")).toBe("in_progress");
    expect(statusFromStage("order", "transit")).toBe("in_progress");
    expect(statusFromStage("order", "delivered")).toBe("done");
    expect(statusFromStage("visit", "plan")).toBe("open");
    expect(statusFromStage("visit", "done")).toBe("done");
    expect(statusFromStage("note", "whatever")).toBe("in_progress");
  });
});

describe("lenses — bucket / dateForBucket", () => {
  it("bucket", () => {
    expect(bucket(null, NOW)).toBe("backlog");
    expect(bucket("2026-09-02T00:00:00Z", NOW)).toBe("today");
    expect(bucket("2026-08-01T00:00:00Z", NOW)).toBe("today"); // overdue
    expect(bucket("2026-09-04T00:00:00Z", NOW)).toBe("week"); // Fri of the same Jalali week
    expect(bucket("2026-10-01T00:00:00Z", NOW)).toBe("backlog"); // far future
  });
  it("dateForBucket round-trips through bucket", () => {
    expect(dateForBucket("backlog", NOW)).toBe(null);
    expect(dateForBucket("today", NOW)).toBe("2026-09-02");
    const wk = dateForBucket("week", NOW)!;
    expect(bucket(wk, NOW)).not.toBe("backlog");
  });
});
