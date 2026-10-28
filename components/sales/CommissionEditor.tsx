"use client";

import { FieldInput } from "@/components/FieldInput";
import { ChipGroup } from "@/components/mobile/FilterChips";
import SmartPicker from "@/components/mobile/SmartPicker";
import KeypadField from "@/components/mobile/KeypadField";
import { planToEditable, type PlanSource } from "@/lib/commission/copyPlan";
import { usePostAction } from "@/lib/usePostAction";
import { tehranTodayIso } from "@/lib/jalali";
import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { toToman } from "@/lib/money";
import { faToman } from "@/lib/format";
import {
  commissionFor,
  validatePlan,
  type Plan,
  type PlanMode,
  type RateType,
  type CommissionMetric,
} from "@/lib/commission/tiers";

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
  "rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50";
const SEG_BTN = (on: boolean) =>
  `rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] font-medium transition-colors duration-[var(--dur-base)] ${
    on
      ? "border-[var(--accent)] bg-[var(--accent)] text-accent-ink"
      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
  }`;

type Kind = "sales" | "driver" | "manager";
const KIND_LABEL: Record<Kind, string> = { sales: "فروشنده", driver: "راننده", manager: "مدیر گروه" };

/** Named in the owner's words rather than as the enum's. "marginal" means nothing to
 *  someone setting a colleague's pay; «پلکانی» is the word the rule is written with. */
const MODE_LABEL: Record<PlanMode, string> = {
  marginal: "پلکانی",
  accelerator: "شتاب‌دار",
  cliff: "پله‌ای (پرریسک)",
};

const METRIC_LABEL: Record<CommissionMetric, string> = {
  kg: "کیلوگرم",
  volume_m3: "متر مکعب",
  revenue_toman: "تومان فروش",
  margin_toman: "تومان حاشیه سود",
  orders: "سفارش",
};

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
/** Parse a number typed with Persian or Arabic-Indic digits and `٫` as the decimal mark;
 *  null when it is not a plain number. Pure, so it lives outside the component. */
function toNumber(input: string): number | null {
  const ascii = input.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.codePointAt(0)!;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  }).replace("٫", ".");
  if (!/^-?\d+(\.\d+)?$/.test(ascii)) return null;
  return Number(ascii);
}

export default function CommissionEditor({
  sellers,
  drivers,
  managers,
  plans = [],
}: {
  sellers: { id: number; display_name: string }[];
  drivers: { id: number; display_name: string }[];
  managers: { id: number; display_name: string }[];
  /** Existing plans to copy from (the latest per person and the company default). */
  plans?: PlanSource[];
}) {
  const router = useRouter();
  const { busy, message, send } = usePostAction("تنظیمات پورسانت ثبت نشد؛ دوباره تلاش کنید");
  const [rateKind, setRateKind] = useState<Kind>("sales");
  const [payKind, setPayKind] = useState<Kind>("sales");

  const today = () => tehranTodayIso();
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

  /* --- tiered plans -------------------------------------------------------
   *
   *  The preview calls `commissionFor` directly rather than approximating it. A preview that
   *  re-implements the arithmetic is a preview that lies the moment the two disagree, and
   *  the person reading it is deciding what a salesperson earns. */
  const [planSeller, setPlanSeller] = useState("");
  const [planFrom, setPlanFrom] = useState(today);
  const [planMode, setPlanMode] = useState<PlanMode>("marginal");
  const [planMetric, setPlanMetric] = useState<CommissionMetric>("kg");
  /* `type` is annotated rather than inferred from the literal: `as const` on the seed value
   * pins the whole array to "flat", so a later row with "pct" would not type-check — the
   * selector in the UI offers pct, so the state has to admit it. */
  interface TierRowInput {
    from: string;
    to: string;
    rate: string;
    type: RateType;
  }
  const [tierRows, setTierRows] = useState<TierRowInput[]>([
    { from: "0", to: "100", rate: "1000", type: "flat" },
  ]);

  const draftPlan: Plan = useMemo(
    () => ({
      mode: planMode,
      metric: planMetric,
      tiers: tierRows.map((t, i) => ({
        from_value: toNumber(t.from) ?? 0,
        // The last tier is always open-ended: an owner typing a bound on the final row is
        // describing a gap they cannot see, and validatePlan would (rightly) refuse it.
        to_value: i === tierRows.length - 1 ? null : toNumber(t.to),
        rate_type: t.type,
        rate_value: toNumber(t.rate) ?? 0,
      })),
    }),
    [planMode, planMetric, tierRows]
  );
  const planProblem = validatePlan(draftPlan);

  /** Sample totals worth showing: a round figure, and the first tier boundary crossed —
   *  which is where marginal and cliff diverge, so it is the one a rep must see. */
  const previews = useMemo(() => {
    const firstBound = draftPlan.tiers.find((t) => t.to_value !== null)?.to_value ?? null;
    const totals = [50, 100, 250];
    if (firstBound !== null) {
      totals.push(firstBound, firstBound + 1);
    }
    return [...new Set(totals)]
      .filter((t) => t > 0)
      .sort((a, b) => a - b)
      .map((t) => ({ total: t, amount: commissionFor(draftPlan, t) }));
  }, [draftPlan]);

  async function savePlan() {
    const ok = await send(
      "/api/sales/commission/tiers",
      {
        salesperson_user_id: planSeller === "" ? null : Number(planSeller),
        plan: draftPlan,
        valid_from: planFrom,
      },
      "پلن پلکانی ثبت شد"
    );
    if (ok) router.refresh();
  }

  return (
    <section className="flex flex-col gap-[var(--space-4)] card p-[var(--space-4)]">
      <h2 className="sechead__title">نرخ و پرداخت</h2>

      {message && (
        <p className={`m-0 text-[length:var(--text-sm)] ${message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--crit)]"}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex gap-[var(--space-2)]" role="group" aria-label="نرخ برای کدام گروه">
          {(["sales", "driver", "manager"] as Kind[]).map((k) => (
            <button key={k} type="button" className={SEG_BTN(rateKind === k)} onClick={() => switchRateKind(k)}>
              <Icon name="wallet" size="md" />
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
            <SmartPicker
              scope="commission-people"
              label={KIND_LABEL[rateKind]}
              items={peopleFor(rateKind).map((p) => ({ id: String(p.id), label: p.display_name }))}
              value={rateSeller}
              onChange={setRateSeller}
              clearLabel={`همهٔ ${KIND_LABEL[rateKind]}‌ها (پیش‌فرض)`}
              placeholder={`همهٔ ${KIND_LABEL[rateKind]}‌ها (پیش‌فرض)`}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="rate-value">
              {rateKind === "manager" ? "درصد از فروش گروه" : "تومان در هر کیلو"}
            </label>
            <KeypadField label={rateKind === "manager" ? "درصد از فروش گروه" : "تومان در هر کیلو"} value={rateValue} onChange={setRateValue} unit={rateKind === "manager" ? "درصد" : "تومان"} decimal={rateKind === "manager"} />
            {rateValue !== "" && (
              <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {!rateValid ? "عدد معتبر نیست" : rateKind === "manager" ? `${rateValue}٪` : faToman(parsedRate ?? 0)}
              </span>
            )}
          </div>
          <JalaliDatePicker id="rate-from" label="از تاریخ" value={rateFrom} onChange={setRateFrom} />
          <div className="flex items-end">
            <button className={BUTTON} disabled={busy || !rateValid} type="submit">
              <Icon name="check" size="md" />
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
              <Icon name="wallet" size="md" />
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
            <SmartPicker
              scope="commission-people"
              label="پرداخت به"
              items={peopleFor(payKind).map((p) => ({ id: String(p.id), label: p.display_name }))}
              value={paySeller}
              onChange={setPaySeller}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="pay-amount">
              مبلغ (تومان)
            </label>
            <KeypadField label="مبلغ پرداخت" value={payAmount} onChange={setPayAmount} unit="تومان" />
            {payAmount !== "" && (
              <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {parsedPay === null ? "عدد معتبر نیست" : faToman(parsedPay)}
              </span>
            )}
          </div>
          <JalaliDatePicker id="pay-on" label="تاریخ پرداخت" value={payOn} onChange={setPayOn} />
          <div className="flex items-end">
            <button className={BUTTON} disabled={busy || parsedPay === null || paySeller === ""} type="submit">
              <Icon name="check" size="md" />
              ثبت پرداخت
            </button>
          </div>
        </form>

        <hr className="my-[var(--space-2)] border-[var(--border)]" />

        <div className="flex flex-col gap-[var(--space-3)]">
          <h3 className="sechead__title">پلن پلکانی (فروشنده)</h3>
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            پلن پلکانی جای نرخ تخت می‌نشیند: هر پله فقط روی مقدار داخل خودش حساب می‌شود، پس
            با فروش بیشتر درآمد کمتر نمی‌شود. اگر برای این فروشنده پلنی ثبت نشود، همان نرخ
            تخت بالا اعمال می‌شود.
          </p>

          {plans.length > 0 && (
            <div className="flex flex-col gap-[var(--space-1)]">
              <span className={LABEL}>شروع از پلن موجود</span>
              <div className="flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="کپی از پلن موجود">
                {plans.map((src) => (
                  <button
                    key={src.id}
                    type="button"
                    className={SEG_BTN(false)}
                    onClick={() => {
                      const e = planToEditable(src.plan);
                      setPlanMode(e.mode);
                      setPlanMetric(e.metric);
                      setTierRows(e.rows);
                    }}
                  >
                    <Icon name="copy" size="md" />
                    {`کپی از ${src.label}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-[var(--space-3)]">
            <div className="flex min-w-[180px] flex-1 flex-col">
              <span className={LABEL}>فروشنده</span>
              <SmartPicker
                scope="commission-people"
                label="فروشنده"
                items={sellers.map((x) => ({ id: String(x.id), label: x.display_name }))}
                value={planSeller}
                onChange={setPlanSeller}
                clearLabel="همه (پیش‌فرض شرکت)"
                placeholder="همه (پیش‌فرض شرکت)"
              />
            </div>

            <div className="flex min-w-[180px] flex-1 flex-col">
              <span className={LABEL}>معیار سنجش</span>
              <ChipGroup
                wrap
                group={{
                  id: "plan_metric",
                  label: "معیار سنجش",
                  mode: "single",
                  neutral: "__none",
                  value: planMetric,
                  onChange: (v) => { if (v && v !== "__none") setPlanMetric(v as CommissionMetric); },
                  options: (Object.keys(METRIC_LABEL) as CommissionMetric[]).map((m) => ({ id: m, label: METRIC_LABEL[m] })),
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-[var(--space-1)]">
            <span className={LABEL}>روش محاسبه</span>
            <div className="flex gap-[var(--space-2)]" role="group" aria-label="روش محاسبه پلن">
              {(["marginal", "accelerator", "cliff"] as PlanMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={SEG_BTN(planMode === m)}
                  aria-pressed={planMode === m}
                  onClick={() => setPlanMode(m)}
                >
                  <Icon name={m === "cliff" ? "warn" : m === "accelerator" ? "trend" : "layers"} size="md" />
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {planMode === "cliff" && (
            <p
              role="alert"
              className="m-0 flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--crit)]/40 bg-[var(--crit)]/10 px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--crit)]"
            >
              <Icon name="warn" size="md" />
              <span>
                در این حالت با کمی فروش بیشتر، ممکن است درآمد کمتر شود. مثلاً با ۹۹ تا ۱۰۰
                کیلوگرم، نرخ کل فروش ناگهان عوض می‌شود. اگر مطمئن نیستید، «پلکانی» را
                انتخاب کنید.
              </span>
            </p>
          )}

          <div className="flex flex-col gap-[var(--space-2)]">
            <span className={LABEL}>پله‌ها</span>
            {tierRows.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-[var(--space-2)]">
                <label className="flex w-[110px] flex-col">
                  <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">از</span>
                  {i === 0 ? (
                    <FieldInput className={FIELD} value={t.from} inputMode="decimal" disabled aria-label="شروع پلهٔ اول" readOnly />
                  ) : (
                    <KeypadField
                      label={`شروع پلهٔ ${i + 1}`}
                      value={t.from}
                      decimal
                      onChange={(v) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, from: v } : r)))}
                    />
                  )}
                </label>
                <label className="flex w-[110px] flex-col">
                  <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">تا</span>
                  {i === tierRows.length - 1 ? (
                    <FieldInput className={FIELD} value="به بالا" disabled readOnly aria-label="پایان پلهٔ آخر" />
                  ) : (
                    <KeypadField
                      label={`پایان پلهٔ ${i + 1}`}
                      value={t.to}
                      decimal
                      onChange={(v) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, to: v } : r)))}
                    />
                  )}
                </label>
                <div className="flex w-[150px] flex-col">
                  <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">نوع</span>
                  <ChipGroup
                    group={{
                      id: `tier_type_${i}`,
                      label: `نوع نرخ پلهٔ ${i + 1}`,
                      mode: "single",
                      neutral: "__none",
                      value: t.type,
                      onChange: (v) => { if (v && v !== "__none") setTierRows(tierRows.map((r, j) => (j === i ? { ...r, type: v as RateType } : r))); },
                      options: [{ id: "flat", label: "تومان" }, { id: "pct", label: "درصد" }],
                    }}
                  />
                </div>
                <label className="flex w-[140px] flex-col">
                  <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">نرخ</span>
                  <KeypadField
                    label={`نرخ پلهٔ ${i + 1}`}
                    value={t.rate}
                    decimal
                    unit={t.type === "pct" ? "درصد" : "تومان"}
                    onChange={(v) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, rate: v } : r)))}
                  />
                </label>
                {tierRows.length > 1 && (
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] transition-colors hover:text-[var(--crit)]"
                    onClick={() => setTierRows(tierRows.filter((_, j) => j !== i))}
                    aria-label={`حذف پله ${i + 1}`}
                  >
                    <Icon name="trash" size="sm" />
                    حذف این پله
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="flex w-fit cursor-pointer items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] transition-colors hover:border-[var(--border-strong)]"
              onClick={() => {
                const last = tierRows[tierRows.length - 1];
                const from = toNumber(last.to) ?? toNumber(last.from) ?? 0;
                setTierRows([...tierRows, { from: String(from), to: "", rate: "", type: "flat" }]);
              }}
            >
              <Icon name="plus" size="sm" />
              افزودن پله
            </button>
          </div>

          {planProblem && (
            <p role="alert" className="m-0 text-[length:var(--text-xs)] text-[var(--crit)]">
              {planProblem}
            </p>
          )}

          <div className="flex flex-col gap-[var(--space-1)]">
            <span className={LABEL}>پیش‌نمایش درآمد</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[length:var(--text-xs)]">
              {previews.map((p) => (
                <li key={p.total} className="flex justify-between gap-[var(--space-3)]">
                  <span className="text-[var(--text-muted)]">
                    {p.total.toLocaleString("fa-IR")} {METRIC_LABEL[planMetric]}
                  </span>
                  <span className="font-medium text-[var(--text)]">{faToman(p.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-faint)]">
              همین محاسبه‌ای که در فیش حقوق اعمال می‌شود؛ پیش‌نمایش از همان تابع می‌خواند.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-[var(--space-3)]">
            <label className="flex min-w-[180px] flex-1 flex-col">
              <span className={LABEL}>از تاریخ</span>
              <JalaliDatePicker id="plan-from" label="از تاریخ" value={planFrom} onChange={setPlanFrom} />
            </label>
            <button
              type="button"
              disabled={busy || planProblem !== null}
              className={BUTTON}
              onClick={() => void savePlan()}
            >
              <Icon name="check" size="md" />
              ثبت پلن
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
