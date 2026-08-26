"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { toToman } from "@/lib/money";
import { faToman, faNum } from "@/lib/format";

interface Product {
  id: number;
  name: string;
  base_unit: string;
}

interface DraftLine {
  key: number;
  product_id: number;
  base_qty: number;
  unit_cost_toman: number;
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";

/** Recording a delivery of stock into the warehouse.
 *
 *  Quantities are in the product's base unit rather than in packs, because a supplier's
 *  carton is rarely the carton we sell. Converting once here, where the person is
 *  holding the invoice, beats carrying two pack sizes through every stock query.
 */
export default function PurchaseEntry({ products }: { products: Product[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [supplier, setSupplier] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState("");

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickProduct, setPickProduct] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");

  const parsedCost = toToman(cost);
  const parsedQty = Number(qty);
  const product = products.find((p) => String(p.id) === pickProduct) ?? null;

  const resolved = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        product: products.find((p) => p.id === line.product_id)!,
        total: line.base_qty * line.unit_cost_toman,
      })),
    [lines, products]
  );
  const total = resolved.reduce((sum, l) => sum + l.total, 0);

  function addLine() {
    if (!product || parsedCost === null || !Number.isFinite(parsedQty) || parsedQty <= 0) return;
    setLines((cur) => [
      ...cur,
      { key: Date.now(), product_id: product.id, base_qty: parsedQty, unit_cost_toman: parsedCost },
    ]);
    setQty("");
    setCost("");
  }

  async function submit() {
    if (lines.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sales/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: supplier || null,
          purchase_date: purchaseDate,
          invoice_no: invoiceNo || null,
          lines: lines.map((l) => ({
            product_id: l.product_id,
            base_qty: l.base_qty,
            unit_cost_toman: l.unit_cost_toman,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "ثبت نشد" });
        return;
      }
      setMessage({ kind: "ok", text: "خرید ثبت شد و میانگین قیمت به‌روز شد" });
      setLines([]);
      setSupplier("");
      setInvoiceNo("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
      <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
        ثبت خرید
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

      <div className="grid gap-[var(--space-3)] md:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="supplier">
            تأمین‌کننده
          </label>
          <input
            id="supplier"
            className={FIELD}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="کارخانه مرحبا"
          />
        </div>
        <JalaliDatePicker
          id="purchase-date"
          label="تاریخ خرید"
          value={purchaseDate}
          onChange={setPurchaseDate}
        />
        <div>
          <label className={LABEL} htmlFor="invoice">
            شماره فاکتور
          </label>
          <input
            id="invoice"
            className={FIELD}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
          />
        </div>
      </div>

      {resolved.length > 0 && (
        <ul className="flex list-none flex-col gap-[var(--space-2)] p-0">
          {resolved.map((line) => (
            <li
              key={line.key}
              className="flex items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
            >
              <span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--text)]">
                {line.product.name}
                <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-faint)]">
                  {" "}
                  · {faNum(line.base_qty)} {line.product.base_unit} ×{" "}
                  {faToman(line.unit_cost_toman)}
                </span>
              </span>
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
          onChange={(e) => setPickProduct(e.target.value)}
        >
          <option value="">کالا…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          aria-label="تعداد"
          className={FIELD}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="decimal"
          placeholder={product ? `تعداد (${product.base_unit})` : "تعداد"}
        />
        <input
          aria-label="قیمت واحد"
          className={FIELD}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          inputMode="numeric"
          placeholder="قیمت هر واحد"
        />
        <button
          type="button"
          onClick={addLine}
          disabled={!product || parsedCost === null || !(parsedQty > 0)}
          className="rounded-[var(--radius-md)] border border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] transition-colors duration-[var(--dur-base)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
        >
          افزودن قلم
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div>
          <strong className="block text-[length:var(--text-base)] font-medium tabular-nums text-[var(--text)]">
            {faToman(total)}
          </strong>
          <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
            ثبت خرید، میانگین قیمت کالاها را تغییر می‌دهد.
          </span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy || lines.length === 0}
          className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter] duration-[var(--dur-base)] hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "در حال ثبت…" : "ثبت خرید"}
        </button>
      </div>
    </section>
  );
}
