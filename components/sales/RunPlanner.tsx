"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

interface Run {
  id: number;
  run_date: string;
  status: string;
  driver_name: string;
  stop_count: number;
  remaining: number;
}

interface Order {
  id: number;
  order_no: string;
  customer_name: string;
  total_toman: number;
  order_date: string;
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";

export default function RunPlanner({
  drivers,
  runs,
  orders,
}: {
  drivers: { id: number; display_name: string }[];
  runs: Run[];
  orders: Order[];
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState("");
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetRun, setTargetRun] = useState("");
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

  const openRuns = runs.filter((r) => r.status !== "done");

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

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <h2 className="m-0 mb-[var(--space-3)] text-[length:var(--text-base)] font-medium text-[var(--text)]">
          مسیر تازه
        </h2>
        {drivers.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-faint)]">
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
                className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[#04191c] disabled:opacity-40"
              >
                ساخت مسیر
              </button>
            </div>
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <h2 className="m-0 mb-[var(--space-3)] text-[length:var(--text-base)] font-medium text-[var(--text)]">
            مسیرها
          </h2>
          <ul className="flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[var(--text)]">
                  {run.driver_name}
                  <span className="ms-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {faJalaliDate(run.run_date)}
                  </span>
                </span>
                <span className="tabular-nums text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {faNum(run.stop_count)} توقف · {faNum(run.remaining)} باقی‌مانده
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
          سفارش‌های آماده تحویل
        </h2>
        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
          فقط سفارش‌های تأییدشده‌ای که هنوز روی هیچ مسیری نیستند.
        </p>

        {openRuns.length > 0 && (
          <div className="mt-[var(--space-3)]">
            <label className={LABEL} htmlFor="target-run">
              افزودن به مسیر
            </label>
            <select
              id="target-run"
              className={FIELD}
              value={targetRun}
              onChange={(e) => setTargetRun(e.target.value)}
            >
              <option value="">انتخاب کنید…</option>
              {openRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.driver_name} — {faJalaliDate(run.run_date)}
                </option>
              ))}
            </select>
          </div>
        )}

        {orders.length === 0 ? (
          <p className="mt-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-faint)]">
            سفارش تأییدشده‌ای در انتظار تحویل نیست.
          </p>
        ) : (
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[length:var(--text-sm)] text-[var(--text)]">
                  {order.customer_name}
                  <span className="ms-[var(--space-2)] text-[length:var(--text-xs)] tabular-nums text-[var(--text-faint)]">
                    {faJalaliDate(order.order_date)}
                  </span>
                </span>
                <span className="flex items-center gap-[var(--space-3)]">
                  <span className="tabular-nums text-[length:var(--text-sm)] text-[var(--text-muted)]">
                    {faToman(order.total_toman)}
                  </span>
                  <button
                    type="button"
                    disabled={busy || targetRun === ""}
                    onClick={() =>
                      call(
                        `/api/sales/runs/${targetRun}/stops`,
                        { order_id: order.id },
                        "به مسیر اضافه شد"
                      )
                    }
                    className="rounded-[var(--radius-md)] border border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                  >
                    افزودن
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
