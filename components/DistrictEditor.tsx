"use client";

import { useCallback, useRef, useState } from "react";
import { DistrictFeature, CoverageStatus, STATUS_LABEL, STATUS_COLOR } from "@/lib/types";
import StatusPill from "./StatusPill";
import HistoryTimeline from "./HistoryTimeline";
import AddReminder from "./AddReminder";
import PhotoGallery from "./PhotoGallery";
import { useToast } from "./ToastProvider";

/** Kept in step with the .modal-exit duration in globals.css. */
const EXIT_MS = 180;

export default function DistrictEditor({
  district,
  onClose,
  onSaved,
  onReminderAdded,
}: {
  district: DistrictFeature;
  onClose: () => void;
  onSaved: () => void;
  onReminderAdded?: () => void;
}) {
  const [status, setStatus] = useState<CoverageStatus>(district.properties.coverage_status);
  const [notes, setNotes] = useState(district.properties.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // One class on the backdrop drives both it and the card out (see .modal-exit in
  // globals.css), replacing a gsap timeline that was the only reason this component
  // needed the animation library at all.
  const [leaving, setLeaving] = useState(false);
  const animateOut = useCallback((cb: () => void) => {
    setLeaving(true);
    window.setTimeout(cb, EXIT_MS);
  }, []);

  const handleClose = useCallback(() => animateOut(onClose), [animateOut, onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/districts/${district.properties.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverage_status: status, notes }),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) {
      setError(data.error || "خطا در ذخیره");
      toast(data.error || "خطا در ذخیره", "error");
      return;
    }
    toast("تغییرات منطقه ذخیره شد.", "success");
    animateOut(onSaved);
  }

  return (
    <div
      ref={backdropRef}
      className={`${leaving ? "modal-exit" : "modal-backdrop-enter"} absolute inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/50 p-4`}
      onClick={handleClose}
    >
      <div
        ref={cardRef}
        className="modal-card-enter w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-surface-raised p-5 elevate-accent"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h2 className="text-[length:var(--text-lg)] font-bold text-text">{district.properties.name}</h2>
          <button
            onClick={handleClose}
            aria-label="بستن"
            className="shrink-0 rounded-[var(--radius-sm)] p-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
          >
            ✕
          </button>
        </div>
        {district.properties.parent_name && (
          <p className="mb-4 text-[length:var(--text-sm)] text-text-muted">منطقه: {district.properties.parent_name}</p>
        )}

        <label className="mb-1.5 block text-[length:var(--text-sm)] font-medium text-text">وضعیت پوشش</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CoverageStatus)}
          className="mb-2 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-base)] text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] focus:border-accent focus:elevate-accent"
        >
          {(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="mb-4">
          <StatusPill color={STATUS_COLOR[status]} label={STATUS_LABEL[status]} />
        </div>


        <label className="mb-1.5 block text-[length:var(--text-sm)] font-medium text-text">یادداشت</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mb-4 w-full resize-none rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-base)] text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
          placeholder="مثلاً: دلیل ممنوعیت، یا آخرین باری که سر زدید"
        />

        {error && <p className="mb-3 text-[length:var(--text-sm)] text-crit">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full cursor-pointer rounded-[var(--radius-md)] border border-accent bg-accent py-2 font-medium text-accent-ink transition-[filter,transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>

        <AddReminder entityType="district" entityId={district.properties.id} onAdded={onReminderAdded} />
        <PhotoGallery entityType="district" entityId={district.properties.id} />
        <HistoryTimeline entityType="district" entityId={district.properties.id} />
      </div>
    </div>
  );
}
