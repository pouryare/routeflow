"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";

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
  const [driverId, setDriverId] = useState("");
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function call(url: string, body: unknown, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "انجام نشد" });
        return null;
      }
      setMessage({ kind: "ok", text: okText });
      router.refresh();
      return json;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {message && (
        <p
          className={`m-0 text-[length:var(--text-sm)] ${
            message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--crit)]"
          }`}
        >
          {message.text}
        </p>
      )}

      <section className="card p-[var(--space-4)]">
        <h2 className="m-0 mb-[var(--space-3)] text-[length:var(--text-base)] font-medium text-[var(--text)]">
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
                className="rounded-[var(--radius-md)] border border-[var(--primary)] bg-[var(--primary)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-primary-ink disabled:opacity-40"
              >
                ساخت مسیر
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
