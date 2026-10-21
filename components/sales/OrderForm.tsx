"use client";

import { useMemo, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { faToman, faNum } from "@/lib/format";
import { roundToman } from "@/lib/money";
import { MAX_PACKS_PER_LINE, parsePacks } from "@/lib/orderLimits";
import { Icon } from "@/components/meridian/Icon";
import SmartPicker from "@/components/mobile/SmartPicker";
import KeypadField from "@/components/mobile/KeypadField";
import DayChips from "@/components/mobile/DayChips";
import {
  resolveRequestedDay,
  requestedDayLabel,
  UNCOMMITTED_LABEL,
  type RequestedKind,
} from "@/lib/requestedDay";
import { tehranTodayIso } from "@/lib/jalali";

interface Customer {
  id: number;
  customer_code: string;
  business_name: string;
  phone: string | null;
  debt: number;
  credit_limit_toman: number | null;
}

interface Packaging {
  id: number;
  name: string;
  qty_per_pack: number;
  price_toman: number | null;
}

interface Product {
  id: number;
  name: string;
  base_unit: string;
  kg_per_base_unit: number;
  packagings: Packaging[];
}

interface Draft {
  key: number;
  product_id: number;
  packaging_id: number;
  packs: number;
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-base)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";

/** Recording an order, phone first.
 *
 *  The shape follows how it actually happens: pick the shop, then add lines one at a
 *  time, watching the total. Everything that can be decided on the server is -- the
 *  order number, the price, the weight -- so this screen only has to collect what a
 *  person knows: who, what, how many.
 *
 *  It saves as a draft. Confirming is a second, deliberate action on the order's own
 *  page, because confirmed is the point after which the numbers stop being editable.
 */
export default function OrderForm({
  customers,
  products,
  sellers,
  initialCustomerId = null,
}: {
  customers: Customer[];
  products: Product[];
  sellers: { id: number; display_name: string }[];
  /** Arrives from the map's customer panel. Already validated against this caller's
   *  own customer list by the page, so it is safe to select without re-checking. */
  initialCustomerId?: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState<number | null>(initialCustomerId);
  const [orderDate, setOrderDate] = useState(() => tehranTodayIso());
  /* Phase 1 (mixed-route planning): the day the customer ASKED for, which is a different
   * question from the day the slip was typed. Defaults to «soonest» — uncommitted — because
   * that is the honest state for a slip nobody has yet agreed a delivery day with the
   * customer, and it is what the day-splitter later picks up.
   *
   * `requestedDate` holds the concrete day; for a week offset it is derived by
   * `resolveRequestedDay` at submit time, so the stored day is always a real date and the
   * stored kind still remembers that the reader said "next week" rather than naming a day. */
  const [requestedMode, setRequestedMode] = useState<RequestedKind>("soonest");
  const [requestedDate, setRequestedDate] = useState("");
  const requestedWeeks = "1";
  const [sellerId, setSellerId] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<Draft[]>([]);
  const [pickProduct, setPickProduct] = useState("");
  const [pickPackaging, setPickPackaging] = useState("");
  const [packs, setPacks] = useState("1");

  const customer = customers.find((c) => c.id === customerId) ?? null;

  const product = products.find((p) => String(p.id) === pickProduct) ?? null;
  const packaging = product?.packagings.find((k) => String(k.id) === pickPackaging) ?? null;

  const resolved = useMemo(
    () =>
      lines.map((line) => {
        const p = products.find((x) => x.id === line.product_id)!;
        const k = p.packagings.find((x) => x.id === line.packaging_id)!;
        return {
          ...line,
          product: p,
          packaging: k,
          total: roundToman(line.packs * (k.price_toman ?? 0)),
          kg: line.packs * k.qty_per_pack * p.kg_per_base_unit,
        };
      }),
    [lines, products]
  );

  const total = resolved.reduce((sum, l) => sum + l.total, 0);
  const totalKg = resolved.reduce((sum, l) => sum + l.kg, 0);

  // The limit warns, never blocks. For months the debt figures will be behind reality,
  // and a hard block would refuse real sales over a stale number. The override is
  // recorded on the order instead, so a warning cannot be ignored invisibly.
  const projectedDebt = (customer?.debt ?? 0) + total;
  const overLimit =
    customer?.credit_limit_toman != null && projectedDebt > customer.credit_limit_toman;

  function addLine() {
    if (!product || !packaging) return;
    // parsePacks reads Persian digits too; Number("۵") is NaN and used to drop the line without a word.
    const n = parsePacks(packs);
    if (n === null) {
      setError(`تعداد بسته باید عددی مثبت (حداکثر سه رقم اعشار) و حداکثر ${faNum(MAX_PACKS_PER_LINE)} باشد`);
      return;
    }
    setError(null);
    setLines((current) => [
      ...current,
      { key: Date.now(), product_id: product.id, packaging_id: packaging.id, packs: n },
    ]);
    setPacks("1");
  }

  /* The concrete day this form is asking for, or null for «در اولین فرصت».
   *
   * `soonest` never produces a date — not even today's. Returning today would read as a
   * commitment nobody made and would make the order PINNED for the day-splitter, which is the
   * opposite of what "at the first opportunity" means. The throw branches below are therefore
   * unreachable by construction: a mode is only allowed to be what its control offers. They
   * are handled rather than assumed, because an unhandled throw in a submit handler is a
   * dead submit button and no error at all. */
  const resolvedRequestedDay = useMemo(() => {
    if (requestedMode === "soonest") return null;
    if (requestedMode === "exact_date") return requestedDate || null;
    const weeks = Number(requestedWeeks);
    if (!Number.isInteger(weeks) || weeks < 0) return null;
    try {
      return resolveRequestedDay("week_offset", weeks, tehranTodayIso());
    } catch {
      return null;
    }
  }, [requestedMode, requestedDate, requestedWeeks]);

  async function submit() {
    if (!customer || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customer.id,
          order_date: orderDate,
          /* Resolved HERE rather than stored as a label: the row carries a concrete day, and
           * the kind carries which control produced it. A week offset therefore becomes a real
           * date the day-splitter can plan against, while the card can still read «هفتهٔ بعد»
           * instead of a day the driver never named. */
          requested_day: resolvedRequestedDay,
          requested_kind: requestedMode,
          salesperson_user_id: sellerId === "" ? null : Number(sellerId),
          notes: notes || null,
          credit_override: overLimit,
          lines: lines.map((l) => ({
            product_id: l.product_id,
            packaging_id: l.packaging_id,
            packs: l.packs,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(friendlyError(json.error, "سفارش ثبت نشد؛ دوباره تلاش کنید"));
        return;
      }
      router.push(`/sales/orders/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {error && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--crit)] bg-[var(--crit)]/10 p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--crit)]">
          {error}
        </p>
      )}

      <section className="card p-[var(--space-4)]">
        <label className={LABEL} htmlFor="customer-search">
          مشتری
        </label>
        {customer ? (
          <div className="flex items-center justify-between gap-[var(--space-3)]">
            <div>
              <strong className="block text-[length:var(--text-base)] font-medium text-[var(--text)]">
                {customer.business_name}
              </strong>
              <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {customer.customer_code}
                {customer.debt > 0 && ` · بدهی ${faToman(customer.debt)}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCustomerId(null);
              }}
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
            >
              <Icon name="edit" size="sm" />
              تغییر
            </button>
          </div>
        ) : (
          <SmartPicker
            scope="order-customers"
            label="مشتری"
            placeholder="نام یا کد مشتری…"
            items={customers.map((c) => ({ id: String(c.id), label: `${c.business_name} · ${c.customer_code}` }))}
            value=""
            onChange={(id) => setCustomerId(Number(id))}
          />
        )}
      </section>

      <section className="grid gap-[var(--space-3)] card p-[var(--space-4)] md:grid-cols-3">
        <JalaliDatePicker id="order-date" label="تاریخ سفارش" value={orderDate} onChange={setOrderDate} />
        {/* Phase 1: the day asked for. A SECOND date beside the first, not a replacement —
            «تاریخ سفارش» is when the slip was written and stays exactly that. */}
        <div>
          <span className={LABEL}>روز تحویل خواسته‌شده</span>
          <div className="flex flex-col gap-[var(--space-2)]">
            <button
              type="button"
              className={`daychip${requestedMode === "soonest" ? " daychip--on" : ""}`}
              aria-pressed={requestedMode === "soonest"}
              onClick={() => {
                setRequestedMode("soonest");
                setRequestedDate("");
              }}
            >
              <Icon name={requestedMode === "soonest" ? "check" : "calendar"} size="sm" />
              {UNCOMMITTED_LABEL}
            </button>
            <DayChips
              value={requestedMode === "exact_date" ? requestedDate : ""}
              ariaLabel="روز تحویل خواسته‌شده"
              skipHolidays
              onChange={(iso) => {
                setRequestedMode("exact_date");
                setRequestedDate(iso);
              }}
            />
          </div>
          {resolvedRequestedDay !== null && (
            <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {requestedDayLabel(resolvedRequestedDay)}
            </p>
          )}
        </div>
        {sellers.length > 0 && (
          <div>
            <label className={LABEL} htmlFor="seller">
              فروشنده
            </label>
            <SmartPicker
              scope="order-sellers"
              label="فروشنده"
              items={sellers.map((x) => ({ id: String(x.id), label: x.display_name }))}
              value={sellerId}
              onChange={setSellerId}
              clearLabel="بدون فروشنده"
            />
          </div>
        )}
        <div>
          <label className={LABEL} htmlFor="notes">
            یادداشت
          </label>
          <input
            id="notes"
            className={FIELD}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </section>

      <section className="card p-[var(--space-4)]">
        <h2 className="sechead__title mb-[var(--space-3)]">
          اقلام سفارش
        </h2>

        {resolved.length > 0 && (
          <ul className="mb-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0">
            {resolved.map((line) => (
              <li
                key={line.key}
                className="flex items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <div className="min-w-0">
                  <span className="block truncate text-[length:var(--text-sm)] text-[var(--text)]">
                    {line.product.name} · {line.packaging.name}
                  </span>
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
                    {faNum(line.packs)} بسته · {faNum(line.kg)} کیلو
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-[var(--space-2)]">
                  <span className="tabular-nums text-[length:var(--text-sm)] text-[var(--text)]">
                    {faToman(line.total)}
                  </span>
                  <button
                    type="button"
                    aria-label="حذف قلم"
                    onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
                    className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--crit)]"
                  >
                    <Icon name="x" size="sm" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-[var(--space-2)] md:grid-cols-4">
          <SmartPicker
            scope="order-products"
            label="کالا"
            items={products.map((p) => ({ id: String(p.id), label: p.name }))}
            value={pickProduct}
            onChange={(id) => {
              setPickProduct(id);
              setPickPackaging("");
            }}
          />

          <SmartPicker
            scope="order-packagings"
            label="بسته‌بندی"
            items={(product?.packagings ?? [])
              .filter((k) => k.price_toman !== null)
              .map((k) => ({ id: String(k.id), label: `${k.name} — ${k.price_toman!.toLocaleString("fa-IR")}` }))}
            value={pickPackaging}
            onChange={setPickPackaging}
          />

          <KeypadField label="تعداد بسته" value={packs} onChange={setPacks} unit="بسته" decimal />

          <button
            type="button"
            onClick={addLine}
            disabled={!packaging || packaging.price_toman === null}
            className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] transition-colors duration-[var(--dur-base)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          >
            <Icon name="plus" size="sm" />
            افزودن قلم
          </button>
        </div>
      </section>

      {overLimit && customer?.credit_limit_toman != null && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-sm)] leading-6 text-[var(--warn)]">
          با این سفارش، بدهی {customer.business_name} به {faToman(projectedDebt)} می‌رسد و از
          سقف {faToman(customer.credit_limit_toman)} بیشتر می‌شود. ثبت آن آزاد است، اما به
          نام شما ثبت می‌شود.
        </p>
      )}

      <div data-has-primary-bar className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-2)] p-[var(--space-4)]">
        <div>
          <strong className="block text-[length:var(--text-lg)] font-medium tabular-nums text-[var(--text)]">
            {faToman(total)}
          </strong>
          <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
            {faNum(resolved.length)} قلم · {faNum(totalKg)} کیلو
          </span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !customer || lines.length === 0}
          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          <Icon name="package" size="md" />
          {busy ? "در حال ثبت…" : "ثبت پیش‌نویس"}
        </button>
      </div>
    </div>
  );
}
