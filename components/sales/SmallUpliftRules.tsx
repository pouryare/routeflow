"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { toNumber } from "@/lib/money";
import { friendlyError } from "@/lib/userMessage";
import type { UpliftRuleRow } from "@/lib/repo/smallUplift";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
type Product = { id: number; name: string; packagings: { id: number; name: string }[] };

/** F65 on the products page (owner): «below N packs, the unit price goes up P percent», per pack. Orders show it as its own line
 *  and the price on the order line already includes it. A manager can waive it for one order. */
export default function SmallUpliftRules({ rules, products }: { rules: UpliftRuleRow[]; products: Product[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");
  const [packaging, setPackaging] = useState("");
  const [packs, setPacks] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: { packaging_id: number; small_packs: number | null; percent: number | null }) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/small-uplift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setBusy(false);
    if (!res?.ok) { setError(friendlyError(j.error, "انجام نشد؛ دوباره تلاش کنید")); return; }
    setOpen(false); setProduct(""); setPackaging(""); setPacks(""); setPercent("");
    router.refresh();
  }
  const options = products.find((p) => String(p.id) === product)?.packagings ?? [];
  const nPacks = toNumber(packs), nPercent = toNumber(percent);

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="small-uplift" aria-label="افزایش قیمت سفارش کم">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h2 className="sechead__title m-0">افزایش قیمت سفارش کم</h2>
        <button type="button" className={BTN} onClick={() => setOpen(true)}><Icon name="plus" size="md" />قانون تازه</button>
      </div>
      {rules.length === 0 ? (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">برای هر بسته می‌گویید زیر چند بسته، قیمت واحد چند درصد بیشتر شود. تا قانونی نگذارید قیمت‌ها همان است. مدیر می‌تواند برای یک سفارش آن را ببخشد.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
          {rules.map((r) => (
            <li key={r.packaging_id} className="flex items-center justify-between gap-[var(--space-2)]">
              <span><b>{r.product_name} · {r.packaging_name}</b>: زیر {faNum(r.small_packs)} بسته، {faNum(r.percent)}٪ بیشتر</span>
              <button type="button" className="min-h-[44px] min-w-[44px] text-[var(--danger)]" aria-label="برداشتن قانون" onClick={() => void save({ packaging_id: r.packaging_id, small_packs: null, percent: null })}><Icon name="x" size="sm" /></button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <BottomSheet open title="قانون سفارش کم" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <SmartPicker scope="products" label="کالا" items={products.map((p) => ({ id: String(p.id), label: p.name }))} value={product} onChange={(id) => { setProduct(id); setPackaging(""); }} placeholder="انتخاب کنید…" />
            <ChipGroup wrap group={{ id: "su-pack", label: "بسته‌بندی", mode: "single", value: packaging, onChange: (v) => setPackaging(v as string), options: options.map((k) => ({ id: String(k.id), label: k.name })) }} />
            <KeypadField label="زیر چند بسته" value={packs} onChange={setPacks} unit="بسته" />
            <KeypadField label="چند درصد بیشتر" value={percent} onChange={setPercent} unit="٪" />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !packaging || nPacks === null || nPercent === null} onPress={() => void save({ packaging_id: Number(packaging), small_packs: nPacks, percent: nPercent })}>ثبت قانون</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
