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
const { canSnooze, snoozedDue, MAX_SNOOZES } = await import("@/lib/taskSnooze");
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
