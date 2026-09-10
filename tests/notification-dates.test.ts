import { describe, it, expect } from "vitest";
import { renderNotification } from "@/lib/repo/notifications";
import { faJalaliDate } from "@/lib/jalali";

/** A notification's text is written once and stored, so a Gregorian date in a template
 *  stays in the reader's feed for good. The cheque notice printed its due date as the
 *  database holds it («2026-09-12»); it now prints the Jalali date. */
describe("notification text carries Jalali dates", () => {
  it("cheque.due_soon prints the due date in Jalali", () => {
    const r = renderNotification("cheque.due_soon", {
      kind: "cheque.due_soon",
      entity_type: "cheque",
      entity_id: 1,
      occurred_at: "2026-09-10T08:00:00Z",
      meta: { cheque_no: "CH-1", due_date: "2026-09-12" },
    });
    expect(r.body_fa).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(r.body_fa).toBe(`چک CH-1 — سررسید ${faJalaliDate("2026-09-12")}`);
    expect(faJalaliDate("2026-09-12")).toBe("۱۴۰۵/۰۶/۲۱");
  });
});
