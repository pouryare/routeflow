"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { fillTemplate, TEMPLATE_PLACEHOLDERS } from "@/lib/messageTemplate";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
const SAMPLE: Record<string, string> = { title: "زنگ بزنید", order_no: "۱۰۴۲", customer_name: "رستوران نمونه", amount_toman: "۵٬۰۰۰٬۰۰۰", cheque_no: "۱۲۳۴۵", due_date: "۱۴۰۵/۰۸/۲۰", message: "پیگیری پرداخت" };
const NAME: Record<string, string> = { title: "عنوان کار", order_no: "شمارهٔ سفارش", customer_name: "نام مشتری", amount_toman: "مبلغ", cheque_no: "شمارهٔ چک", due_date: "سررسید", message: "پیام" };

type Row = { code: string; name: string; shipped: { title: string; body: string | null }; custom: { title: string; body: string | null } | null };

/** F136 on the notification settings page (owner): the company's own title and body for a notification type, with a live preview. */
export default function NotificationTemplates({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Row | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (r: Row) => { setEdit(r); setTitle(r.custom?.title ?? r.shipped.title); setBody(r.custom?.body ?? r.shipped.body ?? ""); setError(null); };
  async function save(t: string | null) {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/notification-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type_code: edit.code, title: t, body: t === null ? null : body || null }) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setBusy(false);
    if (!res?.ok) { setError(friendlyError(j.error, "ذخیره نشد؛ دوباره تلاش کنید")); return; }
    setEdit(null);
    router.refresh();
  }
  const preview = edit ? fillTemplate(edit.code, title, body || null, SAMPLE) : null;

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="notification-templates" aria-label="متن اعلان‌ها">
      <h2 className="sechead__title m-0">متن اعلان‌ها</h2>
      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">عنوان و متن هر اعلان را به زبان شرکت خودتان بنویسید. اگر متنی خراب باشد، همان متن آماده فرستاده می‌شود.</p>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {rows.map((r) => (
          <li key={r.code} className="flex items-center justify-between gap-[var(--space-2)]">
            <span><b>{r.name}</b><span className="block text-[length:var(--text-xs)] text-[var(--muted)]">{r.custom ? r.custom.title : r.shipped.title}{r.custom ? " (متن شرکت)" : ""}</span></span>
            <button type="button" className={BTN} onClick={() => open(r)}><Icon name="edit" size="md" />تغییر متن</button>
          </li>
        ))}
      </ul>
      {edit ? (
        <BottomSheet open title={edit.name} onClose={() => setEdit(null)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <FieldInput aria-label="عنوان" value={title} onChange={(e) => setTitle(e.target.value)} />
            <FieldInput aria-label="متن" value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن (اختیاری)" />
            <div className="flex flex-wrap gap-[var(--space-2)]">
              {(TEMPLATE_PLACEHOLDERS[edit.code] ?? []).map((p) => (
                <button key={p} type="button" className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-xs)]" onClick={() => setBody((b) => `${b} {${p}}`.trim())}><Icon name="plus" size="sm" />{NAME[p] ?? p}</button>
              ))}
            </div>
            <p className="m-0 rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-sm)]" aria-label="پیش‌نمایش">
              {preview ? <><b>{preview.title_fa}</b>{preview.body_fa ? <span className="block text-[var(--muted)]">{preview.body_fa}</span> : null}</> : <span style={{ color: "var(--danger)" }}>این متن درست نیست</span>}
            </p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !preview} onPress={() => void save(title)}>ذخیره</GoButton>
            {edit.custom ? <button type="button" className={BTN} disabled={busy} onClick={() => void save(null)}><Icon name="undo" size="md" />برگرداندن متن آماده</button> : null}
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
