"use client";

import { useRef, useState } from "react";
import type { ResolvedStop } from "@/lib/deliveryTypes";
import { useToast } from "./ToastProvider";

export default function DeliveryImportPanel({
  selectedDate,
  onAdded,
}: {
  selectedDate: string;
  onAdded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState<ResolvedStop[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  async function parseFromText() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/deliveries/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "خطا در تجزیه");
        toast(data.error || "خطا در تجزیه", "error");
        return;
      }
      applyParsed(data.stops);
    } catch {
      setError("خطا در ارتباط با سرور");
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }

  async function parseFromFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/deliveries/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "خطا در تجزیه");
        toast(data.error || "خطا در تجزیه", "error");
        return;
      }
      applyParsed(data.stops);
    } catch {
      setError("خطا در ارتباط با سرور");
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function applyParsed(parsed: ResolvedStop[]) {
    setStops(parsed);
    setSelected(new Set(parsed.filter((s) => s.matched).map((s) => s.key)));
    const unmatched = parsed.filter((s) => !s.matched).length;
    toast(
      unmatched > 0 ? `${parsed.length} مشتری پیدا شد (${unmatched} مورد شناسایی نشد)` : `${parsed.length} مشتری پیدا شد`,
      unmatched > 0 ? "info" : "success"
    );
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function convertToRoute() {
    if (!stops) return;
    const chosen = stops.filter((s) => selected.has(s.key) && s.matched && s.customerId);
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        chosen.map((s) =>
          fetch("/api/visit-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity_type: "customer", entity_id: s.customerId, planned_date: selectedDate }),
          })
        )
      );
      toast(`${chosen.length} مورد به برنامه و مسیر امروز اضافه شد.`, "success");
      setStops(null);
      setText("");
      onAdded();
    } catch {
      toast("خطا در افزودن به برنامه", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
        دریافت سفارش‌های ارسال امروز
      </h2>

      {!stops ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="کپی برگه «ارسال امروز» از اکسل را اینجا پیست کنید…"
            rows={4}
            dir="rtl"
            className="w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={parseFromText}
              disabled={busy || !text.trim()}
              className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "در حال تجزیه..." : "تجزیه"}
            </button>
            <span className="text-[length:var(--text-xs)] text-text-faint">یا</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) parseFromFile(file);
              }}
              className="hidden"
              id="delivery-upload"
            />
            <label
              htmlFor="delivery-upload"
              className={`cursor-pointer rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent ${
                busy ? "pointer-events-none opacity-40" : ""
              }`}
            >
              فایل اکسل
            </label>
          </div>
        </>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[length:var(--text-xs)] text-text-muted">{stops.length} مشتری پیدا شد</p>
            <button
              onClick={() => {
                setStops(null);
                setText("");
              }}
              className="text-[length:var(--text-xs)] text-text-faint hover:text-text"
            >
              انصراف
            </button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {stops.map((s) => (
              <li
                key={s.key}
                className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 ${
                  s.matched ? "border-border bg-surface" : "border-crit/40 bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.key)}
                  onChange={() => toggle(s.key)}
                  disabled={!s.matched}
                  className="mt-1 accent-[color:var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[length:var(--text-sm)] text-text">{s.customerName}</span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-accent">
                      {s.totalAmount.toLocaleString("fa-IR")} ت
                    </span>
                  </div>
                  <p className="truncate text-[length:var(--text-xs)] text-text-faint">
                    {s.items.length} قلم کالا{s.address ? ` · ${s.address}` : ""}
                  </p>
                  {!s.matched && <p className="text-[length:var(--text-xs)] text-crit">⚠ مشتری در سامانه شناسایی نشد</p>}
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-[length:var(--text-xs)] text-crit">{error}</p>}
          <button
            onClick={convertToRoute}
            disabled={busy || selected.size === 0}
            className="mt-3 w-full rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "در حال افزودن..." : `افزودن ${selected.size} مورد به برنامه و مسیر`}
          </button>
        </div>
      )}
      {error && !stops && <p className="mt-2 text-[length:var(--text-xs)] text-crit">{error}</p>}
    </section>
  );
}
