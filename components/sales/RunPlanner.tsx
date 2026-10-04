"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { useToast } from "@/components/ToastProvider";

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";

/** Creating a run: which driver, which day.
 *
 *  Assigning orders *to* a run used to live here too, as a select plus a row of add
 *  buttons. That moved to AssignmentBoard, which does the same thing by direct
 *  manipulation and against the same endpoint. What is left is the one action the board
 *  has no place for, because it makes the columns the board drops onto.
 */
export default function RunPlanner({
  drivers,
}: {
  drivers: { id: number; display_name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [driverId, setDriverId] = useState("");
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  /* Removes the run this planner just created, and is the whole reason the toast carries an
   * action. Creating a route is one click and one mistake: the wrong driver, or the same
   * driver twice by an impatient second click. A message that only says «مسیر ساخته شد»
   * leaves the reader with no way back except finding the column and deleting it by hand. */
  async function undoCreate(runId: number) {
    const res = await fetch(`/api/sales/runs/${runId}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(json.error ?? "برگرداندن انجام نشد", "error");
      return;
    }
    toast("مسیر برداشته شد", "info");
    router.refresh();
  }

  async function call(url: string, body: unknown, okText: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "انجام نشد", "error");
        return null;
      }
      /* Undo only makes sense while the reader can still reach the thing. The action toast
         lives for ACTION_LIFETIME_MS by design — it is the deadline for the only undo — so
         the button disappears when the route can no longer be removed from here. */
      toast(okText, "success", {
        label: "برگرداندن",
        icon: "undo",
        onClick: () => undoCreate(Number(json.id)),
      });
      router.refresh();
      return json;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <section className="card p-[var(--space-4)]">
        <h2 className="sechead__title mb-[var(--space-3)]">
          مسیر تازه
        </h2>
        {drivers.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
            هنوز حساب راننده‌ای ساخته نشده است.
          </p>
        ) : (
          <div className="grid gap-[var(--space-3)] md:grid-cols-3">
            <div>
              <label className={LABEL} htmlFor="run-driver">
                راننده
              </label>
              <select
                id="run-driver"
                className={FIELD}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">انتخاب کنید…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.display_name}
                  </option>
                ))}
              </select>
            </div>
            <JalaliDatePicker id="run-date" label="تاریخ" value={runDate} onChange={setRunDate} />
            <div className="flex items-end">
              <button
                type="button"
                disabled={busy || driverId === ""}
                onClick={() =>
                  call(
                    "/api/sales/runs",
                    { driver_user_id: Number(driverId), run_date: runDate },
                    "مسیر ساخته شد"
                  )
                }
                className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-40"
              >
                <Icon name="plus" size="sm" />
                ساخت مسیر
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
