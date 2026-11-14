"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDate } from "@/lib/jalali";
import { friendlyError } from "@/lib/userMessage";
import type { PickupChoices } from "@/lib/repo/pickups";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** F118: send a driver of a coming run to collect goods at a supplier or factory. The driver sees it on the run with navigation and ticks «کالا را گرفتم». */
export default function PickupPlanner({ choices }: { choices: PickupChoices }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState("");
  const [place, setPlace] = useState("");
  const [order, setOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (choices.runs.length === 0 || choices.places.length === 0) return null;
  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/pickups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: Number(run), facility_id: Number(place), purchase_order_id: order ? Number(order) : null }) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setBusy(false);
    if (res?.ok) { setOpen(false); setRun(""); setPlace(""); setOrder(""); router.refresh(); } else setError(friendlyError(j.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]" dir="rtl" data-tour="pickup-plan">
      <span className="text-[length:var(--text-sm)]">گرفتن کالا از تأمین‌کننده</span>
      <button type="button" className={BTN} onClick={() => setOpen(true)}><Icon name="truck" size="md" />راننده را بفرست</button>
      {open ? (
        <BottomSheet open title="رفتن برای گرفتن کالا" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <ChipGroup wrap group={{ id: "pickup-run", label: "مسیر", mode: "single", value: run, onChange: (v) => setRun(v as string), options: choices.runs.map((r) => ({ id: String(r.id), label: `${faJalaliDate(r.run_date)} · ${r.driver}` })) }} />
            <SmartPicker scope="pickup-places" label="کجا" items={choices.places.map((p) => ({ id: String(p.id), label: p.name }))} value={place} onChange={setPlace} placeholder="انتخاب کنید…" />
            {choices.orders.length > 0 ? <SmartPicker scope="pickup-orders" label="سفارش خرید (اختیاری)" items={choices.orders.map((o) => ({ id: String(o.id), label: `${o.label} · ${o.id}#` }))} value={order} onChange={setOrder} placeholder="بدون سفارش خرید" /> : null}
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">راننده این مکان را روی مسیرش با نقشه می‌بیند. ورود کالا به انبار همان مرحلهٔ «دریافت کالا» است.</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !run || !place} onPress={() => void save()}>ثبت</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
