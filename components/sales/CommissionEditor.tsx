"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { toToman } from "@/lib/money";
import { faToman } from "@/lib/format";

/** Persian/Arabic-Indic digits to a plain float, for the manager's percentage field --
 *  toToman does the same digit normalisation but then rounds to a whole toman, which
 *  would silently turn a ۷٫۵٪ override into ۸٪. */
function toPercent(input: string): number | null {
  const ascii = input.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.codePointAt(0)!;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  }).replace("٫", ".");
  if (!/^-?\d+(\.\d+)?$/.test(ascii)) return null;
  return Number(ascii);
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";
const BUTTON =
  "rounded-[var(--radius-md)] border border-[var(--primary)] bg-[var(--primary)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-primary-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50";
const SEG_BTN = (on: boolean) =>
  `rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] font-medium transition-colors duration-[var(--dur-base)] ${
    on
      ? "border-[var(--primary)] bg-[var(--primary)] text-primary-ink"
      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
  }`;

type Kind = "sales" | "driver" | "manager";
const KIND_LABEL: Record<Kind, string> = { sales: "فروشنده", driver: "راننده", manager: "مدیر گروه" };

/** Owner-only: set a rate or override, record a payment -- for whichever of the three
 *  ledgers `kind` currently points at.
 *
 *  Two forms rather than one, because they are opposite kinds of act. A rate is policy
 *  that applies going forward and is written as a new dated row; a payment is a record
 *  that money left on a particular day. Sharing a form would invite the reading that
 *  paying somebody also changes what they earn.
 *
 *  One editor rather than three, because the three ledgers differ only in WHO the rate
 *  applies to and what unit it is in -- تومان در هر کیلو for فروشنده and راننده,
 *  درصد از فروش گروه for مدیر گروه. The kind selector switches both.
 */
export default function CommissionEditor({
  sellers,
  drivers,
  managers,
}: {
  sellers: { id: number; display_name: string }[];
  drivers: { id: number; display_name: string }[];
  managers: { id: number; display_name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [rateKind, setRateKind] = useState<Kind>("sales");
  const [payKind, setPayKind] = useState<Kind>("sales");

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
  const peopleFor = (k: Kind) => (k === "sales" ? sellers : k === "driver" ? drivers : managers);
  const idFieldFor = (k: Kind) => (k === "sales" ? "salesperson_user_id" : k === "driver" ? "driver_user_id" : "manager_user_id");

  const [rateSeller, setRateSeller] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [rateFrom, setRateFrom] = useState(today);

  const [paySeller, setPaySeller] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payOn, setPayOn] = useState(today);

  const parsedRate = rateKind === "manager" ? toPercent(rateValue) : toToman(rateValue);
  const rateValid =
    rateKind === "manager" ? parsedRate !== null && parsedRate >= 0 && parsedRate <= 100 : parsedRate !== null;
  const parsedPay = toToman(payAmount);

  function switchRateKind(k: Kind) {
    setRateKind(k);
    setRateSeller("");
    setRateValue("");
  }
  function switchPayKind(k: Kind) {
    setPayKind(k);
    setPaySeller("");
    setPayAmount("");
  }

  return (
    <section className="flex flex-col gap-[var(--space-4)] card p-[var(--space-4)]">
      <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">نرخ و پرداخت</h2>

      {message && (
        <p className={`m-0 text-[length:var(--text-sm)] ${message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--crit)]"}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex gap-[var(--space-2)]" role="group" aria-label="نرخ برای کدام گروه">
          {(["sales", "driver", "manager"] as Kind[]).map((k) => (
            <button key={k} type="button" className={SEG_BTN(rateKind === k)} onClick={() => switchRateKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <form
          className="grid gap-[var(--space-3)] md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rateValid || parsedRate === null) return;
            const ok = await send(
              "/api/sales/commission/" + (rateKind === "manager" ? "manager-overrides" : "rates"),
              rateKind === "manager"
                ? { manager_user_id: rateSeller === "" ? null : Number(rateSeller), override_pct: parsedRate, valid_from: rateFrom }
                : { kind: rateKind, [idFieldFor(rateKind)]: rateSeller === "" ? null : Number(rateSeller), rate_per_kg_toman: parsedRate, valid_from: rateFrom },
              "نرخ تازه ثبت شد"
            );
            if (ok) setRateValue("");
          }}
        >
          <div>
            <label className={LABEL} htmlFor="rate-seller">
              {KIND_LABEL[rateKind]}
            </label>
            <select id="rate-seller" className={FIELD} value={rateSeller} onChange={(e) => setRateSeller(e.target.value)}>
              <option value="">همهٔ {KIND_LABEL[rateKind]}‌ها (پیش‌فرض)</option>
              {peopleFor(rateKind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="rate-value">
              {rateKind === "manager" ? "درصد از فروش گروه" : "تومان در هر کیلو"}
            </label>
            <input
              id="rate-value"
              className={FIELD}
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              inputMode="numeric"
              placeholder={rateKind === "manager" ? "۱۰" : "۲۵۰۰"}
              required
            />
            {rateValue !== "" && (
              <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {!rateValid ? "عدد معتبر نیست" : rateKind === "manager" ? `${rateValue}٪` : faToman(parsedRate ?? 0)}
              </span>
            )}
          </div>
          <JalaliDatePicker id="rate-from" label="از تاریخ" value={rateFrom} onChange={setRateFrom} />
          <div className="flex items-end">
            <button className={BUTTON} disabled={busy || !rateValid} type="submit">
              ثبت نرخ
            </button>
          </div>
        </form>
      </div>

      <hr className="border-0 border-t border-[var(--border)]" />

      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex gap-[var(--space-2)]" role="group" aria-label="پرداخت به کدام گروه">
          {(["sales", "driver", "manager"] as Kind[]).map((k) => (
            <button key={k} type="button" className={SEG_BTN(payKind === k)} onClick={() => switchPayKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <form
          className="grid gap-[var(--space-3)] md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (parsedPay === null || paySeller === "") return;
            const ok = await send(
              "/api/sales/commission/payments",
              { kind: payKind, [idFieldFor(payKind)]: Number(paySeller), amount_toman: parsedPay, paid_on: payOn },
              "پرداخت ثبت شد"
            );
            if (ok) setPayAmount("");
          }}
        >
          <div>
            <label className={LABEL} htmlFor="pay-seller">
              پرداخت به
            </label>
            <select id="pay-seller" className={FIELD} value={paySeller} onChange={(e) => setPaySeller(e.target.value)} required>
              <option value="">انتخاب کنید…</option>
              {peopleFor(payKind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
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
            <button className={BUTTON} disabled={busy || parsedPay === null || paySeller === ""} type="submit">
              ثبت پرداخت
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
