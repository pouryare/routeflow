"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { toNumber } from "@/lib/money";

/** VC4 / F30, first slice: what each van holds, and a sheet that moves goods from the warehouse onto it.
 *  The catalogue a driver opens at the door shows this stock, so loading it here is what makes that figure real. */
export default function VanLoadCard({ vans, products }: { vans: { facility_id: number; label: string; kinds: number; pieces: number }[]; products: { id: string; label: string }[] }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [open, setOpen] = useState(false);
  const [van, setVan] = useState("");
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = toNumber(qty) ?? 0;

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/sales/van-load", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...idem.headers() },
      body: JSON.stringify({ facility_id: Number(van), product_id: Number(product), qty: q }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
    idem.renew();
    setOpen(false); setProduct(""); setQty("");
    router.refresh();
  }

  return (
    <section data-tour="van-load" className="mb-[var(--space-3)]" aria-label="بارگیری وانت">
      <ul className="m-0 mb-[var(--space-2)] flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
        {vans.map((v) => (
          <li key={v.facility_id} className="flex justify-between gap-2 border-b border-[var(--border)] pb-[var(--space-1)]">
            <span>{v.label}</span>
            <span className="text-[var(--muted)]">{v.pieces > 0 ? `${faNum(v.kinds)} کالا · ${faNum(v.pieces)} عدد` : "خالی"}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
        <Icon name="truck" size="md" /> بارگیری وانت
      </button>
      <BottomSheet open={open} title="بارگیری وانت" onClose={() => setOpen(false)} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <SmartPicker scope="van-load-vans" label="وانت" items={vans.map((v) => ({ id: String(v.facility_id), label: v.label }))} value={van} onChange={setVan} placeholder="وانت" />
          <SmartPicker scope="van-load-products" label="کالا" items={products} value={product} onChange={setProduct} placeholder="کالا" />
          <KeypadField label="تعداد" value={qty} onChange={setQty} unit="عدد" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
          <GoButton icon="check" isDisabled={busy || !van || !product || q <= 0} onPress={() => void save()}>بارگیری از انبار</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
