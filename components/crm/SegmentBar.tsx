"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { allOf, condLabel, parseTyped } from "@/lib/filterSpec";
import { CUSTOMER_FILTER_MENU } from "@/lib/customerFilterMenu";
import { friendlyError } from "@/lib/userMessage";

const CHIP = "inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]";

/** A17 + FB36 under the customers search: the typed filters as chips («شهر:تهران روز_از_خرید>30»), the company's saved segments to tap, and a way to save the typed filter as a segment. */
export default function SegmentBar({ q, segments, segmentId, onSegment, canSave }: { q: string; segments: { id: number; name: string }[]; segmentId: number | null; onSegment: (id: number | null) => void; canSave: boolean }) {
  const router = useRouter();
  const typed = parseTyped(q, CUSTOMER_FILTER_MENU).conds;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (typed.length === 0 && segments.length === 0) return null;
  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/crm/segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, spec: allOf(typed) }) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setBusy(false);
    if (res?.ok) { setOpen(false); setName(""); router.refresh(); } else setError(friendlyError(j.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]" dir="rtl" data-tour="crm:segments">
      {typed.map((c, i) => <span key={i} className={CHIP}><Icon name="filter" size="sm" />{condLabel(c, CUSTOMER_FILTER_MENU)}</span>)}
      {typed.length > 0 && canSave ? <button type="button" className={CHIP} onClick={() => setOpen(true)}><Icon name="save" size="sm" />ذخیره به‌عنوان بخش</button> : null}
      {segments.map((s) => (
        <button key={s.id} type="button" aria-pressed={segmentId === s.id} className={CHIP} onClick={() => onSegment(segmentId === s.id ? null : s.id)}>
          <Icon name={segmentId === s.id ? "check" : "users"} size="sm" />{s.name}
        </button>
      ))}
      {open ? (
        <BottomSheet open title="ذخیرهٔ بخش مشتریان" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <p className="m-0 text-[length:var(--text-sm)]">{typed.map((c) => condLabel(c, CUSTOMER_FILTER_MENU)).join(" و ")}</p>
            <FieldInput value={name} onChange={(e) => setName(e.target.value)} placeholder="نام بخش، مثلاً «تهرانی‌های ساکت»" />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy || name.trim() === ""} onPress={() => void save()}>ذخیره</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
