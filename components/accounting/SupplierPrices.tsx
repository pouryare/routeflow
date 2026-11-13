"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import SmartPicker from "@/components/mobile/SmartPicker";
import KeypadField from "@/components/mobile/KeypadField";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import { toNumber, toToman } from "@/lib/money";

interface Row { product_id: number; product_name: string; price_toman: number; min_qty: number | null; delivery_days: number | null; supplier_code: string | null }

/** D16 «قیمت‌های این تأمین‌کننده»: price, smallest order, delivery days and the supplier's own code per product.
 *  The purchase form fills the price from here and warns under the minimum. */
export default function SupplierPrices({ supplierId, rows, products }: { supplierId: number; rows: Row[]; products: { id: number; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("");
  const [days, setDays] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceN = toToman(price);
  const minN = minQty === "" ? null : toNumber(minQty);
  const daysN = days === "" ? null : toNumber(days);

  function edit(r?: Row) {
    setProduct(r ? String(r.product_id) : "");
    setPrice(r ? String(r.price_toman) : "");
    setMinQty(r?.min_qty != null ? String(r.min_qty) : "");
    setDays(r?.delivery_days != null ? String(r.delivery_days) : "");
    setCode(r?.supplier_code ?? "");
    setError(null);
    setOpen(true);
  }

  async function call(method: "PUT" | "DELETE", body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounting/suppliers/${supplierId}/prices`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      router.refresh();
    } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="mb-6" data-tour="supplier-prices">
      <SectionHead title="قیمت‌های این تأمین‌کننده" as="h3" actions={
        <button type="button" onClick={() => edit()} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
          <Icon name="plus" size="md" />
          افزودن قیمت
        </button>
      } />
      {rows.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">هنوز قیمتی ثبت نشده است. با ثبت قیمت، فرم خرید قیمت را خودش می‌گذارد.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
          {rows.map((r) => (
            <li key={r.product_id}>
              <button type="button" onClick={() => edit(r)} className="flex min-h-[44px] w-full items-center justify-between gap-[var(--space-3)] border-b border-[var(--border)] pb-[var(--space-2)] text-start">
                <span className="inline-flex items-center gap-[var(--space-2)]"><Icon name="edit" size="sm" />{r.product_name}{r.supplier_code ? ` · ${r.supplier_code}` : ""}</span>
                <span className="tnum text-[var(--muted)]">
                  {faToman(r.price_toman)}{r.min_qty ? ` · حداقل ${faNum(r.min_qty)}` : ""}{r.delivery_days != null ? ` · ${faNum(r.delivery_days)} روز` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <BottomSheet open={open} title="قیمت تأمین‌کننده" onClose={() => setOpen(false)} closeLabel="بستن فرم قیمت">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <SmartPicker scope="supplier-price-products" label="کالا" items={products.map((p) => ({ id: String(p.id), label: p.name }))} value={product} onChange={setProduct} />
          <KeypadField label="قیمت هر واحد" value={price} onChange={setPrice} unit="تومان" />
          <KeypadField label="حداقل سفارش (اختیاری)" value={minQty} onChange={setMinQty} decimal />
          <KeypadField label="روز تحویل (اختیاری)" value={days} onChange={setDays} />
          <FieldInput value={code} onChange={(e) => setCode(e.target.value)} aria-label="کد کالا نزد تأمین‌کننده" placeholder="کد کالا نزد تأمین‌کننده (اختیاری)" className="min-h-[44px] w-full" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="save" isDisabled={busy || product === "" || priceN === null || priceN <= 0} onPress={() => void call("PUT", { product_id: Number(product), price_toman: priceN, min_qty: minN, delivery_days: daysN, supplier_code: code })}>ذخیرهٔ قیمت</GoButton>
          {rows.some((r) => String(r.product_id) === product) ? (
            <GoButton icon="trash" isDisabled={busy} onPress={() => void call("DELETE", { product_id: Number(product) })}>حذف این قیمت</GoButton>
          ) : null}
        </div>
      </BottomSheet>
    </section>
  );
}
