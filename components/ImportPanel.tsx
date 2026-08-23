"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./ToastProvider";
import CollapsibleSection from "./CollapsibleSection";
import { faNum } from "@/lib/format";

interface ImportPreview {
  newCustomers: number;
  updatedCustomers: number;
  unchangedCustomers: number;
  totalDebtBefore: number;
  totalDebtAfter: number;
  salesRowsBefore: number;
  salesRowsAfter: number;
  duplicateBusinessNames: { business_name: string; existing_code: string; new_code: string }[];
  missingFromImport: { customer_code: string; business_name: string }[];
  warnings: string[];
}

interface ImportStatus {
  lastImport: { imported_at: string; source_filename: string | null; customers_upserted: number } | null;
  undo: { available: boolean; snapshotAt: string | null };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PendingSource = { kind: "file"; file: File } | { kind: "onedrive" };

export default function ImportPanel({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSource, setPendingSource] = useState<PendingSource | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [undoArmed, setUndoArmed] = useState(false);
  const toast = useToast();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/import/status");
      const data = await res.json();
      if (data.ok) setStatus({ lastImport: data.lastImport, undo: data.undo });
    } catch {
      // status line is a nice-to-have, not worth surfacing a failure toast for
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function runImport(source: PendingSource, dryRun: boolean) {
    if (source.kind === "file") {
      const formData = new FormData();
      formData.append("file", source.file);
      if (dryRun) formData.append("dryRun", "1");
      const res = await fetch("/api/import", { method: "POST", body: formData });
      return res.json();
    }
    const res = await fetch("/api/import/onedrive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    return res.json();
  }

  async function handleFile(file: File) {
    setBusy(true);
    setPreview(null);
    try {
      const data = await runImport({ kind: "file", file }, true);
      if (!data.ok) {
        toast(data.error || "خطا در خواندن فایل", "error");
      } else {
        setPendingSource({ kind: "file", file });
        setPreview(data.preview);
        for (const w of data.preview?.warnings ?? []) toast(w, "error");
      }
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }

  async function syncFromOneDrive() {
    setBusy(true);
    setPreview(null);
    try {
      const data = await runImport({ kind: "onedrive" }, true);
      if (!data.ok) {
        toast(data.error || "خطا در دریافت فایل از OneDrive", "error");
      } else {
        setPendingSource({ kind: "onedrive" });
        setPreview(data.preview);
        for (const w of data.preview?.warnings ?? []) toast(w, "error");
      }
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!pendingSource) return;
    setBusy(true);
    try {
      const data = await runImport(pendingSource, false);
      if (!data.ok) {
        toast(data.error || "خطا در وارد کردن اطلاعات", "error");
      } else {
        toast(`${data.customersUpserted} مشتری وارد/به‌روزرسانی شد.`, "success");
        onImported();
        loadStatus();
      }
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
      setPendingSource(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function cancelImport() {
    setPendingSource(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function performUndo() {
    setBusy(true);
    try {
      const res = await fetch("/api/import/undo", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "خطا در بازگردانی", "error");
      } else {
        toast("وارد کردن قبلی بازگردانی شد.", "success");
        onImported();
        loadStatus();
      }
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
      setUndoArmed(false);
    }
  }

  const debtDelta = preview ? preview.totalDebtAfter - preview.totalDebtBefore : 0;

  return (
    <CollapsibleSection title="به‌روزرسانی از اکسل" storageKey="import">

      {status?.lastImport && (
        <p className="mb-2 text-[length:var(--text-xs)] text-text-faint">
          آخرین به‌روزرسانی:{" "}
          <span dir="ltr" className="inline-block font-mono">
            {formatDateTime(status.lastImport.imported_at)}
          </span>{" "}
          · {status.lastImport.source_filename ?? "—"}
        </p>
      )}

      {!preview ? (
        <>
          <button
            onClick={syncFromOneDrive}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "در حال دریافت از OneDrive..." : "☁ همگام‌سازی از OneDrive"}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="hidden"
            id="excel-upload"
          />
          <label
            htmlFor="excel-upload"
            className={`mt-2 block cursor-pointer text-center text-[length:var(--text-xs)] text-text-faint underline decoration-dotted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent ${
              busy ? "pointer-events-none opacity-40" : ""
            }`}
          >
            {busy ? "در حال بررسی فایل..." : "یا آپلود دستی فایل از روی سیستم"}
          </label>

          {status?.undo.available && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
              <span className="text-[length:var(--text-xs)] text-text-muted">
                امکان بازگردانی وارد کردن قبلی
                {status.undo.snapshotAt && (
                  <>
                    {" "}
                    (<span dir="ltr" className="font-mono">{formatDateTime(status.undo.snapshotAt)}</span>)
                  </>
                )}
              </span>
              {undoArmed ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[length:var(--text-xs)] text-crit">مطمئنید؟</span>
                  <button
                    onClick={performUndo}
                    disabled={busy}
                    className="rounded-[var(--radius-sm)] border border-crit px-2 py-1 text-[length:var(--text-xs)] text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-crit/10 disabled:opacity-50"
                  >
                    بله
                  </button>
                  <button
                    onClick={() => setUndoArmed(false)}
                    disabled={busy}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:text-text disabled:opacity-50"
                  >
                    خیر
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setUndoArmed(true)}
                  disabled={busy}
                  className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-crit hover:text-crit disabled:opacity-50"
                >
                  ↩ بازگردانی
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-accent bg-surface p-3 elevate-accent">
          <p className="mb-2 text-[length:var(--text-xs)] uppercase tracking-wide text-accent">
            پیش‌نمایش تغییرات — قبل از اعمال بررسی کنید
          </p>
          <dl className="flex flex-col gap-1 text-[length:var(--text-sm)]">
            <div className="flex justify-between">
              <dt className="text-text-muted">مشتری جدید</dt>
              <dd className="font-mono tabular-nums text-good">{preview.newCustomers}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">به‌روزرسانی‌شده</dt>
              <dd className="font-mono tabular-nums text-warn">{preview.updatedCustomers}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">بدون تغییر</dt>
              <dd className="font-mono tabular-nums text-text-faint">{preview.unchangedCustomers}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-1">
              <dt className="text-text-muted">مجموع بدهی</dt>
              <dd className="font-mono tabular-nums text-text" dir="ltr">
                {faNum(preview.totalDebtBefore)} ←{" "}
                <span style={{ color: debtDelta > 0 ? "var(--crit)" : debtDelta < 0 ? "var(--good)" : undefined }}>
                  {faNum(preview.totalDebtAfter)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">ردیف‌های فروش</dt>
              <dd className="font-mono tabular-nums text-text" dir="ltr">
                {faNum(preview.salesRowsBefore)} ← {faNum(preview.salesRowsAfter)}
              </dd>
            </div>
          </dl>

          {preview.warnings.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2">
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-[length:var(--text-xs)] leading-5 text-crit">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          {preview.duplicateBusinessNames.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-[length:var(--text-xs)] text-warn">
                ⚠ {faNum(preview.duplicateBusinessNames.length)} نام کسب‌وکار با کد دیگری هم موجودند (احتمال دو نسخه‌ای شدن یک مشتری):
              </p>
              <ul className="flex flex-col gap-0.5 text-[length:var(--text-xs)] text-text-muted">
                {preview.duplicateBusinessNames.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    {d.business_name} — کد موجود <span dir="ltr" className="font-mono">{d.existing_code}</span> ≠ کد جدید{" "}
                    <span dir="ltr" className="font-mono">{d.new_code}</span>
                  </li>
                ))}
                {preview.duplicateBusinessNames.length > 6 && <li>و {preview.duplicateBusinessNames.length - 6} مورد دیگر…</li>}
              </ul>
            </div>
          )}

          {preview.missingFromImport.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-[length:var(--text-xs)] text-text-muted">
                {faNum(preview.missingFromImport.length)} مشتری موجود در این فایل دیده نشدند (ممکن است از برگه حذف شده باشند).
              </p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={confirmImport}
              disabled={busy}
              className="flex-1 rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "در حال اعمال..." : "تأیید و اعمال"}
            </button>
            <button
              onClick={cancelImport}
              disabled={busy}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text disabled:opacity-50"
            >
              انصراف
            </button>
          </div>
        </div>
      )}

      <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
        اطلاعات مشتری‌ها («مخاطبین») و فروش («فروش») خوانده می‌شود. وضعیت مناطق روی نقشه دست‌نخورده می‌ماند. ستون‌ها بر اساس
        عنوان آن‌ها شناسایی می‌شوند، نه جای ثابت — اما بهتر است ستونی اضافه یا جابه‌جا نشود تا از این خطا جلوگیری شود.
      </p>
    </CollapsibleSection>
  );
}
