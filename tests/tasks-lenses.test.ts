import { describe, it, expect } from "vitest";
import {
  lanesFor,
  laneOf,
  movePatch,
  deriveStage,
  stageFromStatus,
  statusFromStage,
  bucket,
  dateForBucket,
  type TaskLensFields,
} from "@/lib/tasks/lenses";

const NOW = "2026-09-02T09:00:00.000Z"; // a Wednesday

const t = (over: Partial<TaskLensFields> = {}): TaskLensFields => ({
  kind: "admin",
  status: "open",
  stage: null,
  started_at: null,
  due_at: null,
  ...over,
});

describe("lenses — lanesFor", () => {
  it("status lanes", () => {
    expect(lanesFor("status").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
  it("time lanes", () => {
    expect(lanesFor("time").map((l) => l.id)).toEqual(["backlog", "today", "week", "done"]);
  });
  it("workflow lanes per kind, falling back to status for an unknown kind", () => {
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
    expect(lanesFor("workflow", "note").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
});

describe("lenses — laneOf", () => {
  it("status view: done / started / neither", () => {
    expect(laneOf(t({ status: "done" }), "status", NOW)).toBe("done");
    expect(laneOf(t({ started_at: NOW }), "status", NOW)).toBe("in_progress");
    expect(laneOf(t(), "status", NOW)).toBe("open");
  });
  it("time view: done wins, else buckets by due date", () => {
    expect(laneOf(t({ status: "done", due_at: NOW }), "time", NOW)).toBe("done");
    expect(laneOf(t({ due_at: NOW }), "time", NOW)).toBe("today");
    expect(laneOf(t({ due_at: null }), "time", NOW)).toBe("backlog");
    expect(laneOf(t({ due_at: "2026-08-20T00:00:00Z" }), "time", NOW)).toBe("today"); // overdue
    expect(laneOf(t({ due_at: "2026-09-04T00:00:00Z" }), "time", NOW)).toBe("week");
  });
  it("workflow view: stored stage, else derived", () => {
    expect(laneOf(t({ kind: "outreach" }), "workflow", NOW)).toBe("call");
    expect(laneOf(t({ kind: "outreach", started_at: NOW }), "workflow", NOW)).toBe("waiting");
    expect(laneOf(t({ kind: "outreach", stage: "scheduled" }), "workflow", NOW)).toBe("scheduled");
    expect(laneOf(t({ kind: "outreach", status: "done" }), "workflow", NOW)).toBe("done");
    expect(laneOf(t({ kind: "note" }), "workflow", NOW)).toBe("open");
  });
});

describe("lenses — movePatch (status view)", () => {
  it("→ done closes and snaps a pipeline kind's stage to last", () => {
    expect(movePatch(t({ kind: "outreach", stage: "call" }), "status", "done", NOW)).toEqual({
      status: "done",
      stage: "done",
    });
    expect(movePatch(t({ kind: "note" }), "status", "done", NOW)).toEqual({ status: "done" });
  });
  it("→ in_progress sets started_at (and a mid stage for a pipeline kind)", () => {
    expect(movePatch(t({ kind: "note" }), "status", "in_progress", NOW)).toEqual({
      status: "open",
      started_at: NOW,
    });
    expect(movePatch(t({ kind: "outreach", stage: "call" }), "status", "in_progress", NOW)).toEqual({
      status: "open",
      started_at: NOW,
      stage: "waiting",
    });
  });
  it("→ open clears started_at (and resets stage for a pipeline kind)", () => {
    expect(movePatch(t({ kind: "note", started_at: NOW }), "status", "open", NOW)).toEqual({
      status: "open",
      started_at: null,
    });
    expect(
      movePatch(t({ kind: "order", started_at: NOW, stage: "transit" }), "status", "open", NOW)
    ).toEqual({ status: "open", started_at: null, stage: "pending" });
  });
});

describe("lenses — movePatch (time view)", () => {
  it("to a bucket sets due_at and keeps a non-done status", () => {
    const p = movePatch(t({ kind: "order" }), "time", "today", NOW);
    expect(p).toEqual({ due_at: "2026-09-02", status: "open" });
  });
  it("to backlog clears due_at", () => {
    expect(movePatch(t({ due_at: NOW }), "time", "backlog", NOW).due_at).toBe(null);
  });
  it("to done closes; off done re-opens", () => {
    expect(movePatch(t({ kind: "note", due_at: NOW }), "time", "done", NOW)).toEqual({ status: "done" });
    expect(movePatch(t({ status: "done", due_at: NOW }), "time", "today", NOW).status).toBe("open");
  });
});

describe("lenses — movePatch (workflow view)", () => {
  it("last stage closes, first stage re-opens, middle sets started_at", () => {
    expect(movePatch(t({ kind: "outreach", stage: "call" }), "workflow", "done", NOW)).toEqual({
      stage: "done",
      status: "done",
    });
    expect(
      movePatch(t({ kind: "outreach", stage: "scheduled", started_at: NOW }), "workflow", "call", NOW)
    ).toEqual({ stage: "call", status: "open", started_at: null });
    expect(movePatch(t({ kind: "outreach", stage: "call" }), "workflow", "waiting", NOW)).toEqual({
      stage: "waiting",
      status: "open",
      started_at: NOW,
    });
  });
  it("a kind with no pipeline behaves like the status view", () => {
    expect(movePatch(t({ kind: "note" }), "workflow", "in_progress", NOW)).toEqual({
      status: "open",
      started_at: NOW,
    });
  });
});

describe("lenses — helpers", () => {
  it("deriveStage", () => {
    expect(deriveStage({ kind: "outreach", status: "open", started_at: null })).toBe("call");
    expect(deriveStage({ kind: "outreach", status: "open", started_at: NOW })).toBe("waiting");
    expect(deriveStage({ kind: "outreach", status: "done", started_at: null })).toBe("done");
    expect(deriveStage({ kind: "note", status: "open", started_at: null })).toBe(null);
  });
  it("stageFromStatus / statusFromStage", () => {
    expect(stageFromStatus("order", "open")).toBe("pending");
    expect(stageFromStatus("order", "done")).toBe("delivered");
    expect(stageFromStatus("note", "open")).toBe(null);
    expect(statusFromStage("order", "delivered")).toBe("done");
    expect(statusFromStage("order", "transit")).toBe("open");
    expect(statusFromStage("visit", "plan")).toBe("open");
  });
  it("bucket / dateForBucket", () => {
    expect(bucket(null, NOW)).toBe("backlog");
    expect(bucket("2026-09-02T00:00:00Z", NOW)).toBe("today");
    expect(bucket("2026-09-04T00:00:00Z", NOW)).toBe("week");
    expect(bucket("2026-10-01T00:00:00Z", NOW)).toBe("backlog");
    expect(dateForBucket("backlog", NOW)).toBe(null);
    expect(dateForBucket("today", NOW)).toBe("2026-09-02");
    expect(bucket(dateForBucket("week", NOW)!, NOW)).not.toBe("backlog");
  });
});
