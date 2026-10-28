"use client";

import { FieldArea } from "@/components/FieldInput";
import { useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { DistrictFeature, CoverageStatus, STATUS_LABEL, STATUS_COLOR } from "@/lib/types";
import StatusPill from "./StatusPill";
import HistoryTimeline from "./HistoryTimeline";
import AddReminder from "./AddReminder";
import PhotoGallery from "./PhotoGallery";
import { useToast } from "./ToastProvider";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";

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
      setError(friendlyError(data.error, "تغییرات منطقه ذخیره نشد؛ دوباره تلاش کنید"));
      toast(friendlyError(data.error, "تغییرات منطقه ذخیره نشد؛ دوباره تلاش کنید"), "error");
      return;
    }
    toast("تغییرات منطقه ذخیره شد.", "success");
    onSaved();
  }

  return (
    <BottomSheet open title={district.properties.name} subtitle={district.properties.parent_name ? `منطقه: ${district.properties.parent_name}` : undefined} onClose={onClose} closeLabel="بستن ویرایش" bodyClassName="district-sheet"
      dirty={status !== district.properties.coverage_status || notes !== (district.properties.notes ?? "")}>
      <label className="mb-1.5 block text-[length:var(--text-sm)] font-medium text-text">وضعیت پوشش</label>
      <ChipGroup
        wrap
        group={{ id: "coverage_status", label: "وضعیت پوشش", mode: "single", neutral: "__none", value: status, onChange: (v) => { if (v !== "__none") setStatus(v as CoverageStatus); },
          options: (Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => ({ id: s, label: STATUS_LABEL[s] })) }}
      />
      <div className="mb-4">
        <StatusPill color={STATUS_COLOR[status]} label={STATUS_LABEL[status]} />
      </div>


      <label className="mb-1.5 block text-[length:var(--text-sm)] font-medium text-text">یادداشت</label>
      <FieldArea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="mb-4 w-full resize-none text-[length:var(--text-base)] text-text"
        placeholder="مثلاً: دلیل ممنوعیت، یا آخرین باری که سر زدید"
      />

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-crit">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="sheet-save inline-flex items-center justify-center gap-[var(--space-2)] w-full cursor-pointer rounded-[var(--radius-md)] border border-accent bg-accent py-2 font-medium text-accent-ink transition-[filter,transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="map" size="md" />
        {saving ? "در حال ذخیرهٔ منطقه…" : "ذخیرهٔ منطقه"}
      </button>

      <AddReminder entityType="district" entityId={district.properties.id} onAdded={onReminderAdded} />
      <PhotoGallery entityType="district" entityId={district.properties.id} />
      <HistoryTimeline entityType="district" entityId={district.properties.id} />
    </BottomSheet>
  );
}
