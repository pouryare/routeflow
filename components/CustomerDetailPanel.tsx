"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CustomerRow,
  CustomerLifecycle,
  customerLifecycleColor,
  LIFECYCLE_LABEL,
  STATUS_COLOR,
} from "@/lib/types";
import { LIFECYCLE_TRANSITIONS } from "@/lib/customerLifecycle";
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
import CustomerBento, { useCustomerSummary } from "@/components/kargah/CustomerBento";

function customerLink(id: number): string {
  return absoluteMapLink({ customerId: id }, "/");
}

/** Kept in step with the .customer-panel-exit duration in globals.css. */
const EXIT_MS = 180;

function debtTier(c: CustomerRow): { label: string; color: string; amount: number } | null {
  const d = c.debt;
  if (!d) return null;
  if (d.bucket_30_plus > 0) return { label: "بدهی بیش از ۳۰ روز", color: STATUS_COLOR.not_allowed, amount: d.bucket_30_plus };
  if (d.bucket_8_30 > 0) return { label: "بدهی ۸ تا ۳۰ روز", color: STATUS_COLOR.needs_coverage, amount: d.bucket_8_30 };
  if (d.bucket_0_7 > 0) return { label: "بدهی زیر ۸ روز", color: STATUS_COLOR.visited, amount: d.bucket_0_7 };
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
  onUpdated,
}: {
  customer: CustomerRow;
  facilities?: FacilityRow[];
  /** Whether this customer is in the sidebar's pinned list. Owned there, not here:
   *  the panel is transient and the list has to outlive it. */
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose: () => void;
  onReminderAdded?: () => void;
  /** Fired after a field on this customer is changed (e.g. lifecycle) so the caller
   *  can refetch. The panel also updates its own pill optimistically. */
  onUpdated?: () => void;
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

  // An optimistic override for the moment between the PATCH and the parent's refetch.
  // null means "show whatever the customer prop says".
  const [pendingLifecycle, setPendingLifecycle] = useState<CustomerLifecycle | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const lifecycle: CustomerLifecycle = pendingLifecycle ?? customer.lifecycle;

  const changeLifecycle = useCallback(
    async (next: CustomerLifecycle) => {
      if (next === lifecycle || lifecycleBusy) return;
      setLifecycleBusy(true);
      setPendingLifecycle(next); // optimistic
      const res = await fetch(`/api/customers/${customer.id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: next }),
      });
      setLifecycleBusy(false);
      if (res.ok) {
        onUpdated?.();
      } else {
        setPendingLifecycle(null);
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(body?.error ?? "تغییر وضعیت انجام نشد", "error");
      }
    },
    [customer.id, lifecycle, lifecycleBusy, onUpdated, toast]
  );

  const statusColor = customerLifecycleColor(lifecycle);
  const debt = debtTier(customer);

  const bento = useCustomerSummary(customer.id);

  /* Upright beside the map, or lying across the bottom. Which one suits depends on what
     is being read: the upright panel keeps the map's width for the map, the wide one
     keeps its height — and on a laptop the second is often the better trade when the
     shops are spread east-west. Remembered, because it is a preference about the screen,
     not about the customer. */
  const [orient, setOrient] = useState<"side" | "bottom">("side");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("coverage_panel_orient");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "bottom" || saved === "side") setOrient(saved);
    } catch {
      // Private-window storage denial; the default orientation is still correct.
    }
  }, []);
  function flip() {
    const next = orient === "side" ? "bottom" : "side";
    setOrient(next);
    try {
      localStorage.setItem("coverage_panel_orient", next);
    } catch {
      /* see above */
    }
  }

  return (
    <div
      ref={panelRef}
      key={customer.id}
      dir="rtl"
      className={`${leaving ? "customer-panel-exit" : "customer-panel-enter"} sheet-on-mobile cpanel cpanel--${orient} z-[var(--z-panel)] overflow-y-auto ${elevateClass(statusColor)}`}
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
          onClick={flip}
          aria-label={orient === "side" ? "نمایش افقی در پایین صفحه" : "نمایش عمودی در کنار صفحه"}
          title={orient === "side" ? "نمایش افقی" : "نمایش عمودی"}
          className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[length:var(--text-md)] leading-none text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
          {orient === "side" ? "▤" : "▥"}
        </button>
        <button
          onClick={handleClose}
          aria-label="بستن"
          className="shrink-0 rounded-[var(--radius-sm)] p-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
        >
          ✕
        </button>
      </div>

      {/* پنجرهٔ مشتری — the same designed window the sales pockets open, not a second
          copy of it. The map used to carry its own summary, which is how the two drifted
          apart in the first place. */}
      <div className="kargah" style={{ background: "transparent" }}>
        <CustomerBento data={bento} compact />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill color={statusColor} label={LIFECYCLE_LABEL[lifecycle]} />
        <label className="sr-only" htmlFor="lifecycle-select">
          تغییر وضعیت مشتری
        </label>
        <select
          id="lifecycle-select"
          value=""
          disabled={lifecycleBusy || LIFECYCLE_TRANSITIONS[lifecycle].length === 0}
          onChange={(e) => {
            const next = e.target.value as CustomerLifecycle;
            if (next) void changeLifecycle(next);
          }}
          className="rounded-[var(--radius-sm)] border border-border bg-surface px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-muted"
        >
          <option value="">تغییر وضعیت…</option>
          {LIFECYCLE_TRANSITIONS[lifecycle].map((s) => (
            <option key={s} value={s}>
              {LIFECYCLE_LABEL[s]}
            </option>
          ))}
        </select>
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

      <a
        href={`/sales/payments?customer_id=${customer.id}`}
        className="mt-3 block rounded-[var(--radius-md)] border border-border px-3 py-2 text-center text-[length:var(--text-sm)] text-text-muted transition-colors hover:border-accent hover:text-accent"
      >
        دریافت وجه
      </a>
      <a
        href={`/sales/complaints?customer_id=${customer.id}`}
        className="mt-1 block text-center text-[length:var(--text-xs)] text-text-faint hover:text-accent"
      >
        ثبت شکایت کیفی
      </a>

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
      {/* Keyed so selecting a different shop remounts it: the fetch result belongs to
          one customer, and reusing the instance would show the previous shop's orders
          until the new request landed. */}
      <PurchaseHistory
        key={customer.id}
        customerId={customer.id}
        customerName={customer.business_name}
      />
      <HistoryTimeline entityType="customer" entityId={customer.id} />
    </div>
  );
}
