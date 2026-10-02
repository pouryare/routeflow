"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faFixed, faNum } from "@/lib/format";
import { toToman } from "@/lib/money";
import { toPercent } from "@/lib/margin/percent";
import {
  marginForPrice,
  markupFor,
  priceForMargin,
  type MarginInputs,
} from "@/lib/margin/solve";
import { commissionForUnit } from "@/lib/margin/commission";

export interface DrawerPackaging {
  id: number;
  name: string;
  price_toman: number | null;
}

export interface DrawerProduct {
  id: number;
  name: string;
  kg_per_base_unit: number;
  /** `products.avg_cost_toman` -- the moving average purchases maintain. */
  avg_cost_toman: number;
  /** What the resolver returned, or 0 when it returned null (never purchased). */
  cost_toman: number;
  /** null when the resolver returned null, which is NOT the same as "zero cost". */
  cost_method: "weighted_average" | "landed" | null;
  packagings: DrawerPackaging[];
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";

/** What an empty field means, everywhere in this drawer.
 *
 *  NOT zero. The arithmetic treats an absent field as 0 so nothing crashes -- the brief
 *  asked for exactly that, and it is right -- but the DISPLAY refuses to say ۰. Zero is
 *  a claim: "this product genuinely has no shrinkage allowance". An unfilled box has made
 *  no such claim, and rendering one as the other is how a silent zero becomes a recorded
 *  zero. `toToman("")` returns null for the same reason -- "a silent zero is how a free
 *  order gets recorded" -- and `faNum` already renders a non-finite figure as this dash.
 *
 *  So: the maths may assume zero, the screen may never assert one.
 */
const UNSET = "—";

/** Whole Toman from a typed box, or null when the box is empty or unreadable.
 *
 *  Null rather than 0, so a caller can tell "not filled in" from "typed 0". */
function money(raw: string): number | null {
  return raw.trim() === "" ? null : toToman(raw);
}

export default function MarginHelperDrawer({
  products,
  selectedProductId,
  selectedPackagingId,
  price,
  onSelectProduct,
  onSelectPackaging,
}: {
  products: DrawerProduct[];
  selectedProductId: string;
  selectedPackagingId: string;
  price: string;
  onSelectProduct: (id: string) => void;
  onSelectPackaging: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fixed, setFixed] = useState("");
  const [percent, setPercent] = useState("");
  const [tax, setTax] = useState("");
  const [target, setTarget] = useState("25");
  const [ratePerKg, setRatePerKg] = useState<string | null>(null);

  const product = products.find((p) => String(p.id) === selectedProductId) ?? null;
  const packagings = product?.packagings ?? [];
  const selectedPackaging =
    packagings.find((k) => String(k.id) === selectedPackagingId) ?? null;

  /* An absent optional is 0 to the ARITHMETIC and UNSET to the SCREEN. The two are
     separated deliberately -- see the UNSET note above. */
  const fixedToman = money(fixed) ?? 0;
  const percentPct = toPercent(percent) ?? 0;
  const taxToman = money(tax) ?? 0;
  const targetPct = toPercent(target);
  const priceToman = money(price);

  /* Commission is paid per KILOGRAM delivered, so a price carries no commission of its
     own. The estimate needs the kilogram factor, which `products.kg_per_base_unit`
     already carries, and a rate. When no rate has been configured the figure is 0 --
     but the hint below says "نرخ ثبت نشده" rather than showing a commission of ۰.

     `ratePerKgToman` stays null for an EMPTY box, which is different from 0: nobody has
     configured a rate (unmeasured) versus this line genuinely pays no commission. Only
     the arithmetic treats them alike, and only because there is nothing to add either
     way. */
  const ratePerKgToman = ratePerKg === null ? null : toToman(ratePerKg);
  const commissionToman = commissionForUnit(
    product?.kg_per_base_unit ?? 0,
    ratePerKgToman
  );

  const inputs: MarginInputs = useMemo(
    () => ({
      cost_toman: (product?.cost_toman ?? 0) + commissionToman,
      fixed_toman: fixedToman + taxToman,
      percent_deductions_pct: percentPct,
    }),
    [product?.cost_toman, commissionToman, fixedToman, taxToman, percentPct]
  );

  /* Cost unknown is NOT cost zero. P = (C + F) / (1 - a - m) will happily return a
     confident price built from overheads alone for a product nobody ever purchased, so
     no margin is shown at all until the resolver has something to say. */
  const costKnown = product !== null && product.cost_method !== null;

  const actual =
    priceToman !== null && priceToman > 0 && costKnown
      ? marginForPrice({ ...inputs, price_toman: priceToman })
      : null;
  const markup =
    actual && product ? markupFor(actual.profit_toman, product.cost_toman) : null;

  const suggested = targetPct === null ? null : priceForMargin(inputs, targetPct);

  return (
    <section className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <span className="flex items-center gap-[var(--space-2)]">
          <Icon name="chart" size="sm" />
          محاسبه سود
        </span>
        {actual ? (
          <span className="font-mono tabular-nums text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {faFixed(actual.margin_pct * 100, 1)}٪
            {markup === null ? null : ` · سود روی بها ${faFixed(markup * 100, 1)}٪`}
          </span>
        ) : (
          <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">{UNSET}</span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-[var(--space-3)] border-t border-[var(--border)] px-[var(--space-3)] py-[var(--space-3)]">
          <div className="grid gap-[var(--space-3)] md:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="mh-product">
                کالا
              </label>
              <select
                id="mh-product"
                className={FIELD}
                value={selectedProductId}
                onChange={(e) => onSelectProduct(e.target.value)}
              >
                <option value="">انتخاب کنید…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="mh-packaging">
                بسته‌بندی
              </label>
              <select
                id="mh-packaging"
                className={FIELD}
                value={selectedPackagingId}
                onChange={(e) => onSelectPackaging(e.target.value)}
              >
                <option value="">همه بسته‌بندی‌ها</option>
                {packagings.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="m-0 text-[length:var(--text-xs)] leading-5 text-[var(--text-faint)]">
            {costKnown && product?.cost_method === "landed"
              ? "بهای تمام‌شده — شامل کرایه حمل، گمرک و عوارض"
              : costKnown
                ? "میانگین متحرک — با هر خرید تازه تغییر می‌کند"
                : "بهای تمام‌شده برای این کالا هنوز ثبت نشده است"}
          </p>


          <div className="grid gap-[var(--space-3)] md:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="mh-fixed">
                هزینه ثابت هر واحد (تومان)
              </label>
              <input
                id="mh-fixed"
                className={FIELD}
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                inputMode="numeric"
                placeholder={UNSET}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="mh-percent">
                درصدی از فروش (اگر اندازه‌گیری نشده، خالی)
              </label>
              <input
                id="mh-percent"
                name="percent"
                className={FIELD}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                inputMode="decimal"
                placeholder={UNSET}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="mh-tax">
                مالیات (تومان)
              </label>
              <input
                id="mh-tax"
                className={FIELD}
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                inputMode="numeric"
                placeholder={UNSET}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="mh-rate">
                نرخ پورسانت هر کیلوگرم (تومان)
              </label>
              <input
                id="mh-rate"
                className={FIELD}
                value={ratePerKg ?? ""}
                onChange={(e) => setRatePerKg(e.target.value === "" ? null : e.target.value)}
                inputMode="numeric"
                placeholder={UNSET}
              />
              <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {ratePerKg === null
                  ? "نرخ ثبت نشده — پورسانت در محاسبه نیست"
                  : product && product.kg_per_base_unit > 0
                    ? `تخمین هر واحد: ${faNum(commissionToman)} تومان`
                    : "وزن هر واحد برای این کالا ثبت نشده"}
              </span>
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="mh-target">
              حاشیه هدف (٪)
            </label>
            <input
              id="mh-target"
              name="target"
              className={FIELD}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
            />
            <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {suggested === null
                ? "حاشیه هدف معتبر نیست"
                : suggested.ok
                  ? `برای رسیدن به این حاشیه: ${faNum(suggested.price_toman)} تومان`
                  : `با ${faFixed(suggested.percent_deductions_pct, 1)}٪ کسر و حاشیه ${faFixed(
                      suggested.target_margin_pct,
                      1
                    )}٪، قیمتی که این حاشیه را بدهد وجود ندارد`}
            </span>
          </div>

          {actual && (
            <p className="m-0 text-[length:var(--text-xs)] leading-5 text-[var(--text-muted)]">
              سود خالص این قیمت: {faNum(actual.profit_toman)} تومان
              {selectedPackaging ? ` · ${selectedPackaging.name}` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
