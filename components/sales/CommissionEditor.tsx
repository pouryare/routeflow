"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { toToman } from "@/lib/money";
import { faToman } from "@/lib/format";

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";
const BUTTON =
  "rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50";

/** Owner-only: set a rate, record a payment.
 *
 *  Two forms rather than one, because they are opposite kinds of act. A rate is policy
 *  that applies going forward and is written as a new dated row; a payment is a record
 *  that money left on a particular day. Sharing a form would invite the reading that
 *  paying somebody also changes what they earn.
 */
export default function CommissionEditor({
  sellers,
}: {
  sellers: { id: number; display_name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function send(url: string, body: unknown, okText: string) {
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
        setMessage({ kind: "error", text: json.error ?? "ثبت نشد" });
        return false;
      }
      setMessage({ kind: "ok", text: okText });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const today = () => new Date().toISOString().slice(0, 10);

  const [rateSeller, setRateSeller] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [rateFrom, setRateFrom] = useState(today);

  const [paySeller, setPaySeller] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payOn, setPayOn] = useState(today);

  const parsedRate = toToman(rateValue);
  const parsedPay = toToman(payAmount);

  return (
    <section className="flex flex-col gap-[var(--space-4)] card p-[var(--space-4)]">
      <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
        نرخ و پرداخت
      </h2>

      {message && (
        <p
          className={`m-0 text-[length:var(--text-sm)] ${
            message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--crit)]"
          }`}
        >
          {message.text}
        </p>
      )}

      <form
        className="grid gap-[var(--space-3)] md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (parsedRate === null) return;
          const ok = await send(
            "/api/sales/commission/rates",
            {
              salesperson_user_id: rateSeller === "" ? null : Number(rateSeller),
              rate_per_kg_toman: parsedRate,
              valid_from: rateFrom,
            },
            "نرخ تازه ثبت شد"
          );
          if (ok) setRateValue("");
        }}
      >
        <div>
          <label className={LABEL} htmlFor="rate-seller">
            فروشنده
          </label>
          <select
            id="rate-seller"
            className={FIELD}
            value={rateSeller}
            onChange={(e) => setRateSeller(e.target.value)}
          >
            <option value="">همه فروشنده‌ها (پیش‌فرض)</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="rate-value">
            تومان در هر کیلو
          </label>
          <input
            id="rate-value"
            className={FIELD}
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            inputMode="numeric"
            placeholder="۲۵۰۰"
            required
          />
          {rateValue !== "" && (
            <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {parsedRate === null ? "عدد معتبر نیست" : faToman(parsedRate)}
            </span>
          )}
        </div>
        <JalaliDatePicker id="rate-from" label="از تاریخ" value={rateFrom} onChange={setRateFrom} />
        <div className="flex items-end">
          <button className={BUTTON} disabled={busy || parsedRate === null} type="submit">
            ثبت نرخ
          </button>
        </div>
      </form>

      <hr className="border-0 border-t border-[var(--border)]" />

      <form
        className="grid gap-[var(--space-3)] md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (parsedPay === null || paySeller === "") return;
          const ok = await send(
            "/api/sales/commission/payments",
            {
              salesperson_user_id: Number(paySeller),
              amount_toman: parsedPay,
              paid_on: payOn,
            },
            "پرداخت ثبت شد"
          );
          if (ok) setPayAmount("");
        }}
      >
        <div>
          <label className={LABEL} htmlFor="pay-seller">
            پرداخت به
          </label>
          <select
            id="pay-seller"
            className={FIELD}
            value={paySeller}
            onChange={(e) => setPaySeller(e.target.value)}
            required
          >
            <option value="">انتخاب کنید…</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="pay-amount">
            مبلغ (تومان)
          </label>
          <input
            id="pay-amount"
            className={FIELD}
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            inputMode="numeric"
            placeholder="۵۰۰۰۰۰"
            required
          />
          {payAmount !== "" && (
            <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {parsedPay === null ? "عدد معتبر نیست" : faToman(parsedPay)}
            </span>
          )}
        </div>
        <JalaliDatePicker id="pay-on" label="تاریخ پرداخت" value={payOn} onChange={setPayOn} />
        <div className="flex items-end">
          <button
            className={BUTTON}
            disabled={busy || parsedPay === null || paySeller === ""}
            type="submit"
          >
            ثبت پرداخت
          </button>
        </div>
      </form>
    </section>
  );
}
