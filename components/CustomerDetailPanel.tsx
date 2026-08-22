"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CustomerRow, customerStatusColor, STATUS_COLOR } from "@/lib/types";
import StatusPill from "./StatusPill";
import HistoryTimeline from "./HistoryTimeline";
import AddReminder from "./AddReminder";
import PhotoGallery from "./PhotoGallery";
import PurchaseHistory from "./PurchaseHistory";

function debtTier(c: CustomerRow): { label: string; color: string; amount: number } | null {
  if (c.debt_30_plus > 0) return { label: "بدهی بیش از ۳۰ روز", color: STATUS_COLOR.not_allowed, amount: c.debt_30_plus };
  if (c.debt_8_30 > 0) return { label: "بدهی ۸ تا ۳۰ روز", color: STATUS_COLOR.needs_coverage, amount: c.debt_8_30 };
  if (c.debt_0_7 > 0) return { label: "بدهی زیر ۸ روز", color: STATUS_COLOR.visited, amount: c.debt_0_7 };
  return null;
}

function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function elevateClass(color: string): string {
  if (color === STATUS_COLOR.not_allowed) return "elevate-crit";
  if (color === STATUS_COLOR.needs_coverage) return "elevate-warn";
  if (color === STATUS_COLOR.visited) return "elevate-good";
  return "";
}

export default function CustomerDetailPanel({
  customer,
  onClose,
  onReminderAdded,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onReminderAdded?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [planState, setPlanState] = useState<"idle" | "saving" | "added">("idle");

  async function addToTodayPlan() {
    setPlanState("saving");
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    try {
      await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: customer.id, planned_date: dateStr }),
      });
      setPlanState("added");
    } catch {
      setPlanState("idle");
    }
  }

  const handleClose = useCallback(() => {
    const el = panelRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    gsap.to(el, { opacity: 0, x: -12, duration: 0.18, ease: "power2.in", onComplete: onClose });
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const statusColor = customerStatusColor(customer.status);
  const debt = debtTier(customer);

  return (
    <div
      ref={panelRef}
      key={customer.id}
      dir="rtl"
      className={`customer-panel-enter absolute bottom-4 left-4 top-4 z-[1000] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4 ${elevateClass(statusColor)}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-[length:var(--text-md)] font-bold leading-snug text-text">{customer.business_name}</h2>
        <button
          onClick={handleClose}
          aria-label="بستن"
          className="shrink-0 rounded-[var(--radius-sm)] p-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
        >
          ✕
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {customer.status && <StatusPill color={statusColor} label={customer.status} />}
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">{customer.customer_code}</span>
        <button
          onClick={addToTodayPlan}
          disabled={planState !== "idle"}
          className="mr-auto rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:hover:border-border disabled:hover:text-text-muted"
        >
          {planState === "added" ? "✓ افزوده شد" : planState === "saving" ? "..." : "+ برنامه امروز"}
        </button>
      </div>

      <dl className="flex flex-col gap-3 border-t border-border pt-3 text-[length:var(--text-sm)]">
        {customer.contact_person && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">مسئول</dt>
            <dd className="text-left text-text">{customer.contact_person}</dd>
          </div>
        )}
        {customer.phone && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">تلفن</dt>
            <dd className="font-mono text-left text-accent">
              <a href={`tel:${customer.phone}`} className="hover:underline">
                {customer.phone}
              </a>
            </dd>
          </div>
        )}
        {customer.salesperson && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">فروشنده</dt>
            <dd className="text-left text-text">{customer.salesperson}</dd>
          </div>
        )}
        {(customer.city || customer.province) && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">شهر</dt>
            <dd className="text-left text-text">
              {[customer.city, customer.province].filter(Boolean).join("، ")}
            </dd>
          </div>
        )}
        {customer.address && (
          <div className="flex flex-col gap-1">
            <dt className="text-text-muted">آدرس</dt>
            <dd className="leading-6 text-text">{customer.address}</dd>
          </div>
        )}
      </dl>

      {debt && (
        <div
          className="mt-4 flex items-center justify-between rounded-[var(--radius-md)] border border-border px-3 py-2"
          style={{ background: `color-mix(in srgb, ${debt.color} 10%, transparent)` }}
        >
          <span className="text-[length:var(--text-xs)]" style={{ color: debt.color }}>
            {debt.label}
          </span>
          <span className="font-mono text-[length:var(--text-sm)] tabular-nums" style={{ color: debt.color }}>
            {debt.amount.toLocaleString("fa-IR")} تومان
          </span>
        </div>
      )}

      {customer.notes && (
        <div className="mt-4 border-t border-border pt-3 text-[length:var(--text-sm)] leading-6 text-text-muted">
          {customer.notes}
        </div>
      )}

      {customer.synced_at && (
        <p className="mt-4 text-[length:var(--text-xs)] text-text-faint">
          به‌روزرسانی:{" "}
          <span dir="ltr" className="inline-block font-mono">
            {formatSyncedAt(customer.synced_at)}
          </span>
        </p>
      )}

      <AddReminder entityType="customer" entityId={customer.id} onAdded={onReminderAdded} />
      <PhotoGallery entityType="customer" entityId={customer.id} />
      <PurchaseHistory businessName={customer.business_name} />
      <HistoryTimeline entityType="customer" entityId={customer.id} />
    </div>
  );
}
