import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { reminderFlow, reminderRequest, reminderChips, REMINDER_TEMPLATES } from "@/lib/flows/reminder";
import { REMINDER_PRESETS } from "@/lib/flows/dates";
import { checkFlow } from "@/lib/crm/flows/validate";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const rem: FlowContext = { ...EMPTY_CONTEXT, entry: "outcome", vars: { kind: "reminder" } };
const note: FlowContext = { ...EMPTY_CONTEXT, entry: "outcome", vars: { kind: "note" } };
const cust: FlowContext = { ...rem, vars: { kind: "reminder", entity_type: "customer", entity_id: "5", entity: "بقالی رضا" } };
const dist: FlowContext = { ...rem, vars: { kind: "reminder", entity_type: "district", entity_id: "12", entity: "ولنجک" } };

describe("reminder flow", () => {
  it("meets its tap budget with no dead ends, for reminders and notes", () => {
    assertFlowBudget(reminderFlow, [
      { ctx: rem, values: { when: "2026-10-22", text: "x" } },
      { ctx: note, values: { text: "x" } },
    ]);
    assertNoRawEnumLabels(reminderFlow);
  });

  it("a templated reminder is 2 taps: the day, then the words", () => {
    let st = startFlow(reminderFlow, rem);
    expect(viewStep(reminderFlow, rem, st).id).toBe("when");
    st = answerStep(reminderFlow, rem, st, "ok", "2026-10-22");
    st = answerStep(reminderFlow, rem, st, "t0");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(2);
    expect(reminderRequest(rem, st)).toEqual({
      url: "/api/tasks",
      body: { title: REMINDER_TEMPLATES[0], kind: "reminder", due_at: "2026-10-22" },
    });
  });

  it("custom text takes a third tap and must not be empty", () => {
    let st = startFlow(reminderFlow, rem);
    st = answerStep(reminderFlow, rem, st, "ok", "2026-10-22");
    st = answerStep(reminderFlow, rem, st, "custom");
    expect(() => answerStep(reminderFlow, rem, st, "ok")).toThrow();
    st = answerStep(reminderFlow, rem, st, "ok", "  نمونه را ببرم  ");
    expect(reminderRequest(rem, st).body.title).toBe("نمونه را ببرم");
  });

  it("a note is one step, has no date, and says «ثبت یادداشت»", () => {
    let st = startFlow(reminderFlow, note);
    const v = viewStep(reminderFlow, note, st);
    expect(v.id).toBe("text");
    expect(v.options[0].label).toBe("ثبت یادداشت");
    st = answerStep(reminderFlow, note, st, "ok", "کد انبار را بپرس");
    expect(reminderRequest(note, st)).toEqual({ url: "/api/tasks", body: { title: "کد انبار را بپرس", kind: "note", due_at: null } });
  });

  it("a reminder about a customer is a task tied to that customer", () => {
    let st = startFlow(reminderFlow, cust);
    st = answerStep(reminderFlow, cust, st, "ok", "2026-10-23");
    st = answerStep(reminderFlow, cust, st, "t1");
    expect(reminderRequest(cust, st).body).toMatchObject({ kind: "reminder", entity_type: "customer", entity_id: 5, due_at: "2026-10-23" });
  });

  it("a reminder about a district goes to the reminders table with its own field names", () => {
    let st = startFlow(reminderFlow, dist);
    st = answerStep(reminderFlow, dist, st, "ok", "2026-10-23");
    st = answerStep(reminderFlow, dist, st, "t4");
    expect(reminderRequest(dist, st)).toEqual({
      url: "/api/reminders",
      body: { entity_type: "district", entity_id: 12, due_date: "2026-10-23", message: REMINDER_TEMPLATES[4] },
    });
  });

  it("the done screen says what, when and about whom", () => {
    let st = startFlow(reminderFlow, cust);
    st = answerStep(reminderFlow, cust, st, "ok", "2026-10-23");
    st = answerStep(reminderFlow, cust, st, "t0");
    const c = reminderChips(cust, st).join(" | ");
    expect(c).toContain("یادآوری");
    expect(c).toContain("بقالی رضا");
    expect(c).toContain(REMINDER_TEMPLATES[0]);
  });

  it("presets start today and ascend", () => {
    const d = REMINDER_PRESETS.map((p) => p.days);
    expect(d[0]).toBe(0);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(checkFlow(reminderFlow, [{ ctx: rem, values: { when: "2026-10-22", text: "x" } }]).deadEnds).toEqual([]);
  });
});
