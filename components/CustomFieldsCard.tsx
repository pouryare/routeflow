"use client";

import { useState } from "react";
import { FieldInput } from "@/components/FieldInput";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import type { FieldWithValue } from "@/lib/repo/customFields";

/** F122 on the customer page: the company's extra fields. Blank clears a value. */
export default function CustomFieldsCard({ customerId, fields, canEdit, onChanged }: { customerId: number; fields: FieldWithValue[]; canEdit: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<Record<number, string>>(() => Object.fromEntries(fields.map((f) => [f.id, f.value ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (id: number, v: string) => { setDraft((d) => ({ ...d, [id]: v })); setSaved(false); };

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/custom-fields`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: draft }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { setSaved(true); onChanged(); } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section data-tour="customer:custom-fields" className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">ویژگی‌ها</h2>
      {fields.map((f) => (
        <div key={f.id} className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <span>{f.name}</span>
          {!canEdit ? (
            <span className="text-[var(--muted)]">{f.kind === "yes_no" && f.value ? (f.value === "1" ? "بله" : "نه") : (f.value ?? "—")}</span>
          ) : f.kind === "choice" || f.kind === "yes_no" ? (
            <ChipGroup wrap group={{
              id: `cf${f.id}`, label: f.name, mode: "single", neutral: "", value: draft[f.id] ?? "",
              onChange: (v) => set(f.id, typeof v === "string" ? v : ""),
              options: f.kind === "yes_no" ? [{ id: "1", label: "بله، هست" }, { id: "0", label: "نه، نیست" }] : f.choices.map((c) => ({ id: c, label: c })),
            }} />
          ) : (
            // shortcut: a date is typed as ISO text (2026-11-13), not picked; upgrade with a Jalali picker if people ask.
            <FieldInput value={draft[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} maxLength={200} dir={f.kind === "text" ? "rtl" : "ltr"} inputMode={f.kind === "number" ? "decimal" : undefined} placeholder={f.kind === "date" ? "YYYY-MM-DD" : undefined} />
          )}
        </div>
      ))}
      {error ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {saved ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: "var(--success)" }}>ذخیره شد</p> : null}
      {canEdit ? <GoButton icon="save" isDisabled={busy} onPress={() => void save()}>ذخیره</GoButton> : null}
    </section>
  );
}
