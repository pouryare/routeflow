"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import SmartPicker from "@/components/mobile/SmartPicker";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { bulkPreviewText, type BulkField } from "@/lib/bulkEdit";
import { useToast } from "@/components/ToastProvider";

type Option = { id: string; label: string };
const NONE = "none";

/** T4: change the salesperson (or, for the owner, the group) of the picked customers. It counts first
 *  («۴۲ مشتری تغییر می‌کند»), then applies; a big pick runs in the background and says so. */
export default function BulkEditSheet({ open, ids, reps, groups, onClose, onDone }: { open: boolean; ids: number[]; reps: Option[]; groups: Option[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [idem] = useState(idemKeeper);
  const [field, setField] = useState<BulkField>("owner");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [{ id: NONE, label: field === "owner" ? "بدون مسئول" : "بدون گروه" }, ...(field === "owner" ? reps : groups)];
  const body = (preview: boolean) => JSON.stringify({ ids, field, value: value === NONE ? null : Number(value), preview });

  useEffect(() => {
    if (!open || !value) return;
    const ctl = new AbortController();
    fetch("/api/crm/bulk-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(true), signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { ok?: boolean; count?: number; same?: number; refused?: number; error?: string }) => {
        setError(j.ok ? null : friendlyError(j.error, "پیش‌نمایش ساخته نشد"));
        setPreview(j.ok ? bulkPreviewText(j.count ?? 0, j.same ?? 0, j.refused ?? 0) : null);
      })
      .catch(() => {});
    return () => ctl.abort();
    // body() reads exactly these
  }, [open, value, field, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/crm/bulk-edit", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: body(false) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; queued?: boolean; changed?: number } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
    idem.renew();
    toast(j?.queued ? "تغییر در پس‌زمینه انجام می‌شود؛ تمام که شد اعلان می‌آید." : `${(j?.changed ?? 0).toLocaleString("fa-IR")} مشتری تغییر کرد.`, "success");
    setValue(""); setPreview(null);
    onDone();
  }

  const chip = (f: BulkField, label: string, icon: IconName) => (
    <button type="button" aria-pressed={field === f} onClick={() => { setField(f); setValue(""); setPreview(null); }} className="inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] aria-pressed:border-[var(--accent)] gap-[var(--space-2)]"><Icon name={icon} size="md" />{label}</button>
  );

  return (
    <BottomSheet open={open} title="تغییر گروهی" onClose={onClose} closeLabel="بستن">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl" data-tour="bulk-edit">
        {groups.length > 0 ? <div className="flex gap-[var(--space-2)]">{chip("owner", "مسئول", "user")}{chip("group", "گروه", "building")}</div> : null}
        <SmartPicker scope={`bulk-${field}`} label={field === "owner" ? "مسئول تازه" : "گروه تازه"} items={items} value={value} onChange={(v) => { setValue(v); setPreview(null); }} placeholder={field === "owner" ? "مسئول تازه" : "گروه تازه"} />
        {preview ? <p className="m-0 text-[length:var(--text-sm)]" role="status">{preview}</p> : null}
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
        <GoButton icon="check" isDisabled={busy || !value || !preview} onPress={() => void save()}>اعمال روی {ids.length.toLocaleString("fa-IR")} مشتری</GoButton>
      </div>
    </BottomSheet>
  );
}
