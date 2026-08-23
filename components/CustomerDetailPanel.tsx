"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerRow, customerStatusColor, STATUS_COLOR } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import { distanceKm, formatDistanceKm } from "@/lib/geo";
import StatusPill from "./StatusPill";
import HistoryTimeline from "./HistoryTimeline";
import AddReminder from "./AddReminder";
import PhotoGallery from "./PhotoGallery";
import PurchaseHistory from "./PurchaseHistory";
import { useToast } from "./ToastProvider";
import { useNavApp } from "./NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import CopyButton from "./CopyButton";
import { coordText } from "@/lib/clipboard";
import { absoluteMapLink } from "@/lib/deepLink";
import { useSwipeDismiss } from "./useSwipeDismiss";
import { faDateTime, faNum } from "@/lib/format";

function customerLink(id: number): string {
  return absoluteMapLink({ customerId: id }, "/");
}

/** Kept in step with the .customer-panel-exit duration in globals.css. */
const EXIT_MS = 180;

function debtTier(c: CustomerRow): { label: string; color: string; amount: number } | null {
  if (c.debt_30_plus > 0) return { label: "بدهی بیش از ۳۰ روز", color: STATUS_COLOR.not_allowed, amount: c.debt_30_plus };
  if (c.debt_8_30 > 0) return { label: "بدهی ۸ تا ۳۰ روز", color: STATUS_COLOR.needs_coverage, amount: c.debt_8_30 };
  if (c.debt_0_7 > 0) return { label: "بدهی زیر ۸ روز", color: STATUS_COLOR.visited, amount: c.debt_0_7 };
  return null;
}

function elevateClass(color: string): string {
  if (color === STATUS_COLOR.not_allowed) return "elevate-crit";
  if (color === STATUS_COLOR.needs_coverage) return "elevate-warn";
  if (color === STATUS_COLOR.visited) return "elevate-good";
  return "";
}

export default function CustomerDetailPanel({
  customer,
  facilities = [],
  pinned = false,
  onTogglePin,
  onClose,
  onReminderAdded,
}: {
  customer: CustomerRow;
  facilities?: FacilityRow[];
  /** Whether this customer is in the sidebar's pinned list. Owned there, not here:
   *  the panel is transient and the list has to outlive it. */
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose: () => void;
  onReminderAdded?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const router = useRouter();
  const [navAppId] = useNavApp();

  // Measured from our own sites, never from a live GPS fix (spec 1.2): a distance that
  // changes between two glances at the same panel is describing where the phone is, not
  // where the customer is. Nearest site first.
  const siteDistances =
    customer.lat === null || customer.lng === null
      ? []
      : facilities
          .map((f) => ({ name: f.name, km: distanceKm({ lat: customer.lat as number, lng: customer.lng as number }, f) }))
          .sort((a, b) => a.km - b.km);

  const [planState, setPlanState] = useState<"idle" | "saving" | "added">("idle");

  async function addToTodayPlan() {
    setPlanState("saving");
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: customer.id, planned_date: dateStr }),
      });
      if (!res.ok) throw new Error();
      setPlanState("added");
      // The stop lands on a page the user is not looking at, so the toast carries the
      // way there. Without it, confirming the add means finding the planner by hand.
      toast("به برنامه امروز افزوده شد.", "success", {
        label: "نمایش برنامه",
        onClick: () => router.push("/planner"),
      });
    } catch {
      setPlanState("idle");
      toast("خطا در افزودن به برنامه", "error");
    }
  }

  // Exit is a CSS class plus a matching timer, the same shape ToastProvider already
  // uses. It replaces a gsap.to() tween that pulled the whole animation library into
  // this panel's chunk for one 180ms fade.
  const [leaving, setLeaving] = useState(false);
  const handleClose = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  // The panel is a left-docked card on a desktop and a bottom sheet on a phone, so the
  // gesture that puts it away differs with the viewport. Matched against the same
  // breakpoint the stylesheet uses -- one number, in two places that have to agree.
  const [isSheet, setIsSheet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setIsSheet(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Through handleClose rather than onClose, so a swipe gets the same exit animation as
  // the ✕.
  useSwipeDismiss(panelRef, isSheet ? "down" : "left", handleClose);

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
      className={`${leaving ? "customer-panel-exit" : "customer-panel-enter"} sheet-on-mobile absolute bottom-4 left-4 top-20 z-[var(--z-panel)] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4 ${elevateClass(statusColor)}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-[length:var(--text-md)] font-bold leading-snug text-text">{customer.business_name}</h2>
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={pinned ? "برداشتن سنجاق" : "سنجاق کردن این مشتری"}
            title={pinned ? "برداشتن سنجاق" : "سنجاق کردن — در بالای پنل نگه داشته می‌شود"}
            className={`shrink-0 rounded-[var(--radius-sm)] p-1 text-[length:var(--text-md)] leading-none transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
              pinned ? "text-accent hover:text-crit" : "text-text-faint hover:text-accent"
            }`}
          >
            {pinned ? "★" : "☆"}
          </button>
        )}
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
        <div className="mr-auto flex items-center gap-1.5">
          {/* A link straight back to this customer on this map -- the thing you send
              yourself the night before, or send to someone else to look at. */}
          <CopyButton value={() => customerLink(customer.id)} what="کپی پیوند این مشتری" />
          <button
            onClick={addToTodayPlan}
            disabled={planState !== "idle"}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:hover:border-border disabled:hover:text-text-muted"
          >
            {planState === "added" ? "✓ افزوده شد" : planState === "saving" ? "..." : "+ برنامه امروز"}
          </button>
        </div>
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
            <dd className="flex items-center gap-2 font-mono text-left text-accent">
              <a href={`tel:${customer.phone}`} className="hover:underline">
                {customer.phone}
              </a>
              <CopyButton value={customer.phone} what="کپی شماره تلفن" />
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
            <dt className="flex items-center justify-between gap-2 text-text-muted">
              آدرس
              <CopyButton value={customer.address} what="کپی آدرس" />
            </dt>
            <dd className="leading-6 text-text">{customer.address}</dd>
          </div>
        )}
        {customer.lat !== null && customer.lng !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">مختصات</dt>
            <dd className="flex items-center gap-2 font-mono text-[length:var(--text-xs)] text-text-faint">
              {/* Latin digits on purpose: this exists to be pasted into a maps app, and
                  nothing outside this app parses ۳۵٫۷. */}
              <span dir="ltr">{coordText(customer.lat, customer.lng)}</span>
              <CopyButton value={coordText(customer.lat, customer.lng)} what="کپی مختصات" />
              <a
                href={navigateUrl(navAppId, { lat: customer.lat, lng: customer.lng }, customer.business_name)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="مسیریابی به این مشتری"
                className="rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
              >
                ↗
              </a>
            </dd>
          </div>
        )}
        {siteDistances.length > 0 && (
          <div className="flex flex-col gap-1">
            <dt className="text-text-muted">فاصله از مکان‌های ما</dt>
            <dd className="font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
              {siteDistances.map((d) => `${formatDistanceKm(d.km)} تا ${d.name}`).join(" · ")}
              {" — خط مستقیم"}
            </dd>
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
            {faNum(debt.amount)} تومان
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
            {faDateTime(customer.synced_at)}
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
