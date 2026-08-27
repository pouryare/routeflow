"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { matchesQuery } from "@/lib/persian";
import { faToman, faNum } from "@/lib/format";
import { roundToman } from "@/lib/money";

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

  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(initialCustomerId);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sellerId, setSellerId] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<Draft[]>([]);
  const [pickProduct, setPickProduct] = useState("");
  const [pickPackaging, setPickPackaging] = useState("");
  const [packs, setPacks] = useState("1");

  const customer = customers.find((c) => c.id === customerId) ?? null;

  // normalisePersian under the hood, so «كترينگ» typed on one keyboard finds «کترینگ»
  // stored from another. Without it the shop simply appears not to exist.
  const matches = useMemo(() => {
    if (!query.trim()) return customers.slice(0, 8);
    return customers
      .filter((c) => matchesQuery(`${c.business_name} ${c.customer_code}`, query))
      .slice(0, 8);
  }, [customers, query]);

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
    const n = Number(packs);
    if (!Number.isFinite(n) || n === 0) return;
    setLines((current) => [
      ...current,
      { key: Date.now(), product_id: product.id, packaging_id: packaging.id, packs: n },
    ]);
    setPacks("1");
  }

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
        setError(json.error ?? "ثبت سفارش ممکن نشد");
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

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
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
                setQuery("");
              }}
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
            >
              تغییر
            </button>
          </div>
        ) : (
          <>
            <input
              id="customer-search"
              className={FIELD}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="نام یا کد مشتری…"
              autoComplete="off"
            />
            <ul className="mt-[var(--space-2)] flex list-none flex-col gap-[2px] p-0">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCustomerId(c.id)}
                    className="w-full rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)] text-right text-[length:var(--text-sm)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                  >
                    {c.business_name}
                    <span className="ms-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-faint)]">
                      {c.customer_code}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-faint)]">
                  مشتری‌ای پیدا نشد
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      <section className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] md:grid-cols-3">
        <JalaliDatePicker id="order-date" label="تاریخ سفارش" value={orderDate} onChange={setOrderDate} />
        {sellers.length > 0 && (
          <div>
            <label className={LABEL} htmlFor="seller">
              فروشنده
            </label>
            <select
              id="seller"
              className={FIELD}
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">—</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
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

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <h2 className="m-0 mb-[var(--space-3)] text-[length:var(--text-base)] font-medium text-[var(--text)]">
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
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-faint)]">
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
                    className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-faint)] hover:bg-white/5 hover:text-[var(--crit)]"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-[var(--space-2)] md:grid-cols-4">
          <select
            aria-label="کالا"
            className={FIELD}
            value={pickProduct}
            onChange={(e) => {
              setPickProduct(e.target.value);
              setPickPackaging("");
            }}
          >
            <option value="">کالا…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="بسته‌بندی"
            className={FIELD}
            value={pickPackaging}
            onChange={(e) => setPickPackaging(e.target.value)}
            disabled={!product}
          >
            <option value="">بسته‌بندی…</option>
            {product?.packagings.map((k) => (
              <option key={k.id} value={k.id} disabled={k.price_toman === null}>
                {k.name}
                {k.price_toman === null ? " (بدون قیمت)" : ` — ${k.price_toman.toLocaleString("fa-IR")}`}
              </option>
            ))}
          </select>

          <input
            aria-label="تعداد بسته"
            className={FIELD}
            value={packs}
            onChange={(e) => setPacks(e.target.value)}
            inputMode="decimal"
            placeholder="تعداد بسته"
          />

          <button
            type="button"
            onClick={addLine}
            disabled={!packaging || packaging.price_toman === null}
            className="rounded-[var(--radius-md)] border border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] transition-colors duration-[var(--dur-base)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          >
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

      <div className="sticky bottom-0 flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
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
          className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "در حال ثبت…" : "ثبت پیش‌نویس"}
        </button>
      </div>
    </div>
  );
}
