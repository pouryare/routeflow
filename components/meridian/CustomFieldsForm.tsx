"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/FieldInput";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { Icon } from "@/components/meridian/Icon";
import { FIELD_KINDS, MAX_ACTIVE_FIELDS, isFieldKind, type FieldDef, type FieldKind } from "@/lib/customFields";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** F122, on the owner's status page: the extra fields every customer page shows. Archiving hides a field; its values stay. */
export default function CustomFieldsForm({ fields }: { fields: FieldDef[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FieldKind>("text");
  const [choices, setChoices] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) {
      setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    if (await call("/api/admin/custom-fields", "POST", { name, kind, choices })) {
      setName("");
      setChoices("");
    }
  }

  const label = "flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]";
  return (
    <section data-tour="company:custom-fields" className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">ویژگی‌های مشتری</h2>
      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">
        هر ویژگی در صفحهٔ همهٔ مشتری‌ها دیده می‌شود، مثل «نوع مغازه» یا «سمت در ورودی». تا {MAX_ACTIVE_FIELDS.toLocaleString("fa-IR")} ویژگی فعال می‌شود.
      </p>
      {fields.length === 0 ? (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">هنوز ویژگی‌ای ندارید.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
          {fields.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-[var(--space-2)] text-[length:var(--text-sm)]">
              <span>
                {f.name} <span className="text-[var(--muted)]">· {FIELD_KINDS.find((k) => k.id === f.kind)?.label}{f.kind === "choice" ? ` (${f.choices.join("، ")})` : ""}</span>
              </span>
              <button type="button" disabled={busy} className={BTN} onClick={() => void call(`/api/admin/custom-fields/${f.id}`, "PATCH", { archived: true })} aria-label={`بایگانی ${f.name}`}>
                <Icon name="archive" size="md" />
                بایگانی
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={label}>
        نام ویژگی تازه
        <FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <ChipGroup wrap group={{ id: "kind", label: "نوع", mode: "single", neutral: "__none", value: kind, onChange: (v) => { if (isFieldKind(v)) setKind(v); }, options: FIELD_KINDS.map((k) => ({ id: k.id, label: k.label })) }} />
      {kind === "choice" ? (
        <label className={label}>
          گزینه‌ها (با ویرگول جدا کنید)
          <FieldInput value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="مثلاً خرده‌فروشی، عمده، رستوران" />
        </label>
      ) : null}
      {error ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button type="button" disabled={busy || !name.trim()} onClick={() => void add()} className={`${BTN} self-start bg-[var(--accent)] text-accent-ink`}>
        <Icon name="plus" size="md" />
        افزودن ویژگی
      </button>
    </section>
  );
}
