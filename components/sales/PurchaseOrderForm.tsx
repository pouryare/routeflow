"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import DayChips from "@/components/mobile/DayChips";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import { toNumber } from "@/lib/money";

interface Line { product_id: string; name: string; base_qty: number; unit_cost_toman: number }

/** F66 by hand: the owner writes a purchase order without the buy list. Pick the supplier, add items (product, how many,
 *  price for one), choose the day it should arrive, then save a draft or send it. */
export default function PurchaseOrderForm({ suppliers, products }: { suppliers: { id: string; label: string }[]; products: { id: string; label: string }[] }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = toNumber(qty) ?? 0;
  const total = lines.reduce((n, l) => n + Math.round(l.base_qty * l.unit_cost_toman), 0);

  function addLine() {
    const name = products.find((p) => p.id === product)?.label ?? "";
    setLines((cur) => [...cur, { product_id: product, name, base_qty: q, unit_cost_toman: toNumber(cost) ?? 0 }]);
    setProduct(""); setQty(""); setCost("");
  }

  async function save(send: boolean) {
    setBusy(true); setError(null);
    const res = await fetch("/api/sales/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...idem.headers() },
      body: JSON.stringify({ supplier_id: Number(supplier), expected_date: day || null, notes: note, send, lines: lines.map((l) => ({ product_id: Number(l.product_id), base_qty: l.base_qty, unit_cost_toman: l.unit_cost_toman })) }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
    idem.renew();
    setOpen(false); setSupplier(""); setDay(""); setNote(""); setLines([]);
    router.refresh();
  }

  return (
    <section data-tour="po-new" className="mb-[var(--space-3)]">
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
        <Icon name="plus" size="md" /> سفارش خرید تازه
      </button>
      <BottomSheet open={open} title="سفارش خرید تازه" onClose={() => setOpen(false)} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <SmartPicker scope="po-suppliers" label="تأمین‌کننده" items={suppliers} value={supplier} onChange={setSupplier} placeholder="تأمین‌کننده" />
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">چه روزی برسد؟ (اختیاری)</p>
          <DayChips value={day} onChange={setDay} ariaLabel="روز رسیدن" />
          {lines.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-[var(--space-1)]">
                  <span>{l.name} · {faNum(l.base_qty)} × {faToman(l.unit_cost_toman)}</span>
                  <button type="button" aria-label={`حذف ${l.name}`} onClick={() => setLines((cur) => cur.filter((_, k) => k !== i))} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"><Icon name="x" size="md" /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <SmartPicker scope="po-products" label="کالا" items={products} value={product} onChange={setProduct} placeholder="کالا" />
          <KeypadField label="تعداد" value={qty} onChange={setQty} unit="عدد" />
          <KeypadField label="قیمت یکی (اختیاری)" value={cost} onChange={setCost} unit="تومان" />
          <button type="button" disabled={!product || q <= 0} onClick={addLine} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
            <Icon name="plus" size="md" /> افزودن قلم
          </button>
          <FieldInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح (اختیاری)" aria-label="توضیح" maxLength={300} />
          {lines.length > 0 ? <p className="m-0 text-[length:var(--text-sm)]">جمع: {faToman(total)}</p> : null}
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
          <GoButton icon="save" isDisabled={busy || !supplier || lines.length === 0} onPress={() => void save(false)}>ذخیرهٔ پیش‌نویس</GoButton>
          <GoButton icon="send" isDisabled={busy || !supplier || lines.length === 0} onPress={() => void save(true)}>ثبت و ارسال</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
