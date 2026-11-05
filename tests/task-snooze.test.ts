import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-snooze-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { dbReady } = await import("@/lib/db");
const { createTask, snoozeTask, tasksRepo, TaskError } = await import("@/lib/repo/tasks");
const { canSnooze, snoozedDue, pickedSnoozeDue, SNOOZE_STOPS_PX, MAX_SNOOZES } = await import("@/lib/taskSnooze");
const { stopAt } = await import("@/lib/swipe");
const SnoozeChoices = (await import("@/components/today/SnoozeChoices")).default;

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

describe("snooze rules (F142)", () => {
  it("normal and low work may be put off three times; critical and high never", () => {
    expect(canSnooze({ priority: "NORMAL", snooze_count: 0 })).toBe(true);
    expect(canSnooze({ priority: "LOW", snooze_count: MAX_SNOOZES - 1 })).toBe(true);
    expect(canSnooze({ priority: "LOW", snooze_count: MAX_SNOOZES })).toBe(false);
    expect(canSnooze({ priority: "HIGH", snooze_count: 0 })).toBe(false);
    expect(canSnooze({ priority: "CRITICAL", snooze_count: 0 })).toBe(false);
    expect(canSnooze({ priority: "NORMAL", snooze_count: 0, status: "done" })).toBe(false);
  });
  it("«an hour» is an hour from now; «tomorrow» is 09:00 Tehran (05:30 UTC) tomorrow", () => {
    const now = "2026-10-23T14:00:00.000Z"; // 17:30 in Tehran
    expect(snoozedDue("hour", now)).toBe("2026-10-23T15:00:00.000Z");
    expect(snoozedDue("tomorrow", now)).toBe("2026-10-24T05:30:00.000Z");
    expect(snoozedDue("three", now)).toBe("2026-10-23T17:00:00.000Z");
  });
  it("a picked day and hour lands on that Tehran hour, and is refused when past, too far or off the list", () => {
    const now = "2026-10-23T14:00:00.000Z";
    expect(pickedSnoozeDue("2026-10-25", 10, now)).toBe("2026-10-25T06:30:00.000Z");
    expect(pickedSnoozeDue("2026-10-23", 9, now)).toBeNull();
    expect(pickedSnoozeDue("2027-01-30", 9, now)).toBeNull();
    expect(pickedSnoozeDue("2026-10-25", 3, now)).toBeNull();
    expect(pickedSnoozeDue("25/10", 9, now)).toBeNull();
  });
  it("the swipe reaches the later stops the further it goes", () => {
    const stops = SNOOZE_STOPS_PX.map((at) => ({ at }));
    expect(stopAt(stops, 100)).toBe(-1);
    expect(stopAt(stops, -150)).toBe(0);
    expect(stopAt(stops, 180)).toBe(1);
    expect(stopAt(stops, 220)).toBe(2);
    expect(stopAt(stops, 300)).toBe(3);
  });
  it("offers «عقب انداختن این کار» as one 44px button before the choices", () => {
    const html = renderToStaticMarkup(h(SnoozeChoices, { taskId: 1, onDone: () => {} }));
    expect(html).toContain("عقب انداختن این کار");
    expect(html).toContain("min-h-[44px]");
  });
});

describe("snoozeTask", () => {
  it("moves the due time, counts the snooze, and refuses the fourth and urgent ones", async () => {
    await dbReady();
    const now = "2026-10-23T14:00:00.000Z";
    const id = await createTask(1, { kind: "reminder", title: "زنگ به رضا", due_at: now, priority: "NORMAL" } as never);
    expect(await snoozeTask(1, id, "hour", now)).toBe("2026-10-23T15:00:00.000Z");
    expect(await tasksRepo.get(1, id)).toMatchObject({ due_at: "2026-10-23T15:00:00.000Z", snooze_count: 1 });
    await snoozeTask(1, id, "hour", now);
    await snoozeTask(1, id, "tomorrow", now);
    await expect((async () => await snoozeTask(1, id, "hour", now))()).rejects.toThrow(TaskError);
    const urgent = await createTask(1, { kind: "reminder", title: "فوری", due_at: now, priority: "CRITICAL" } as never);
    await expect((async () => await snoozeTask(1, urgent, "hour", now))()).rejects.toThrow(TaskError);
    await expect((async () => await snoozeTask(2, id, "hour", now))()).rejects.toThrow(TaskError);
  });
});
