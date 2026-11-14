"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faToman } from "@/lib/format";
import { toNumber } from "@/lib/money";
import { tehranTodayIso } from "@/lib/jalali";
import { priceFromBase } from "@/lib/priceBases";
import { friendlyError } from "@/lib/userMessage";
import type { MovePreviewRow, PriceBase } from "@/lib/repo/priceBases";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
type Product = { id: number; name: string; packagings: { id: number; name: string }[] };

/** D14 on the products page (owner): prices that follow a named number. Moving the number shows what every linked price becomes
 *  first, then writes new dated prices (the old ones stay in history). */
export default function PriceBases({ bases, products }: { bases: PriceBase[]; products: Product[] }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ kind: "new" } | { kind: "move"; base: PriceBase } | { kind: "link"; base: PriceBase } | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(() => tehranTodayIso());
  const [product, setProduct] = useState("");
  const [packaging, setPackaging] = useState("");
  const [factor, setFactor] = useState("1");
  const [preview, setPreview] = useState<MovePreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<{ ok: boolean; j: { error?: string; rows?: MovePreviewRow[]; changed?: number } }> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/price-bases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string; rows?: MovePreviewRow[]; changed?: number };
    setBusy(false);
    if (!res?.ok) setError(friendlyError(j.error, "انجام نشد؛ دوباره تلاش کنید"));
    return { ok: !!res?.ok, j };
  }
  const close = () => { setSheet(null); setPreview(null); setError(null); setValue(""); setName(""); setProduct(""); setPackaging(""); setFactor("1"); };
  const done = () => { close(); router.refresh(); };
  const n = toNumber(value);
  const packs = products.find((p) => String(p.id) === product)?.packagings ?? [];
  const f = Number(factor.replace(",", "."));

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="price-bases" aria-label="قیمت پایه">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h2 className="sechead__title m-0">قیمت پایه</h2>
        <button type="button" className={BTN} onClick={() => setSheet({ kind: "new" })}><Icon name="plus" size="md" />قیمت پایهٔ تازه</button>
      </div>
      {bases.length === 0 ? (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">یک عدد (مثلاً قیمت روز کره در کیلو) بسازید و کالاها را با ضریب به آن وصل کنید؛ بعد با عوض‌کردن همان یک عدد، قیمت همهٔ کالاها با پیش‌نمایش عوض می‌شود.</p>
      ) : (
        bases.map((b) => (
          <div key={b.id} className="flex flex-col gap-[var(--space-2)] border-t border-[var(--border)] pt-[var(--space-3)]">
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
              <b>{b.name} · {faToman(b.value_toman)}</b>
              <span className="flex gap-[var(--space-2)]">
                <button type="button" className={BTN} onClick={() => { setValue(String(b.value_toman)); setSheet({ kind: "move", base: b }); }}><Icon name="edit" size="md" />تغییر عدد</button>
                <button type="button" className={BTN} onClick={() => setSheet({ kind: "link", base: b })}><Icon name="link" size="md" />وصل کردن کالا</button>
              </span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-xs)] text-[var(--muted)]">
              {b.links.length === 0 ? <li>کالایی وصل نیست</li> : b.links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-[var(--space-2)]">
                  <span>{l.product_name}{l.packaging_name ? ` · ${l.packaging_name}` : ""} × {l.factor.toLocaleString("fa-IR")} = {faToman(priceFromBase(b.value_toman, l.factor))}{l.current_toman !== null && l.current_toman !== priceFromBase(b.value_toman, l.factor) ? ` (اکنون ${faToman(l.current_toman)})` : ""}</span>
                  <button type="button" className="min-h-[44px] min-w-[44px] text-[var(--danger)]" aria-label="جدا کردن" onClick={async () => { if ((await call({ action: "unlink", link_id: l.id })).ok) router.refresh(); }}><Icon name="x" size="sm" /></button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {sheet?.kind === "new" ? (
        <BottomSheet open title="قیمت پایهٔ تازه" onClose={close} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <FieldInput aria-label="نام" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: کره، هر کیلو" />
            <KeypadField label="عدد پایه" value={value} onChange={setValue} unit="تومان" />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !name.trim() || n === null} onPress={async () => { if ((await call({ action: "create", name, value: n })).ok) done(); }}>ساختن</GoButton>
          </div>
        </BottomSheet>
      ) : null}

      {sheet?.kind === "move" ? (
        <BottomSheet open title={`تغییر عدد · ${sheet.base.name}`} subtitle={`اکنون ${faToman(sheet.base.value_toman)}`} onClose={close} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <KeypadField label="عدد تازه" value={value} onChange={(v) => { setValue(v); setPreview(null); }} unit="تومان" />
            <JalaliDatePicker id="pb-from" label="قیمت‌ها از تاریخ" value={from} onChange={setFrom} />
            {preview ? (
              <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]" aria-label="پیش‌نمایش">
                {preview.length === 0 ? <li>کالایی وصل نیست</li> : preview.map((r) => (
                  <li key={r.link_id}>{r.product_name}{r.packaging_name ? ` · ${r.packaging_name}` : ""}: {r.from_toman === null ? "بدون قیمت" : faToman(r.from_toman)} ← <b>{faToman(r.to_toman)}</b></li>
                ))}
              </ul>
            ) : null}
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            {preview ? (
              <GoButton icon="check" isDisabled={busy || n === null} onPress={async () => { if ((await call({ action: "apply", base_id: sheet.base.id, value: n, valid_from: from })).ok) done(); }}>ثبت قیمت‌ها از این تاریخ</GoButton>
            ) : (
              <GoButton icon="eye" isDisabled={busy || n === null} onPress={async () => { const r = await call({ action: "preview", base_id: sheet.base.id, value: n }); if (r.ok) setPreview(r.j.rows ?? []); }}>پیش‌نمایش</GoButton>
            )}
          </div>
        </BottomSheet>
      ) : null}

      {sheet?.kind === "link" ? (
        <BottomSheet open title={`وصل کردن کالا · ${sheet.base.name}`} onClose={close} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <SmartPicker scope="products" label="کالا" items={products.map((p) => ({ id: String(p.id), label: p.name }))} value={product} onChange={(id) => { setProduct(id); setPackaging(""); }} placeholder="انتخاب کنید…" />
            <ChipGroup wrap group={{ id: "pb-pack", label: "بسته‌بندی", mode: "single", value: packaging, onChange: (v) => setPackaging(v as string), options: [{ id: "", label: "همه بسته‌بندی‌ها" }, ...packs.map((k) => ({ id: String(k.id), label: k.name }))] }} />
            <label className="text-[length:var(--text-xs)] text-[var(--muted)]">ضریب (مثلاً ۰٫۲۵ برای بستهٔ ۲۵۰ گرمی)
              <FieldInput inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
            </label>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !product || !(f > 0)} onPress={async () => { if ((await call({ action: "link", base_id: sheet.base.id, product_id: Number(product), packaging_id: packaging === "" ? null : Number(packaging), factor: f })).ok) done(); }}>وصل کن</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
