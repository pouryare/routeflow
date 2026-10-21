"use client";

import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";

/** The inline form behind the Pocket's «+ یادآوری» / «+ یادداشت» actions. A reminder has
 *  a date and lands as kind='reminder'; a note has no date and lands as kind='note'.
 *  Both write to /api/tasks, assigned to the current member by the route. */
export default function QuickAdd({
  kind,
  onClose,
  onAdded,
}: {
  kind: "reminder" | "note";
  onClose: () => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!text.trim() || (kind === "reminder" && !due)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: text.trim(),
          kind,
          due_at: kind === "reminder" ? due : null,
        }),
      });
      if (!res.ok) throw new Error();
      const preview = text.trim().length > 30 ? `${text.trim().slice(0, 30)}…` : text.trim();
      toast(`${kind === "reminder" ? "یادآوری" : "یادداشت"} «${preview}» ثبت شد.`, "success");
      setText("");
      setDue("");
      onAdded();
      onClose();
    } catch {
      toast(`${kind === "reminder" ? "یادآوری" : "یادداشت"} ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--sunk)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        padding: 12,
        margin: "10px 0 4px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {kind === "reminder" ? "ثبت یادآوری تازه" : "ثبت یادداشت تازه"}
      </div>
      {kind === "reminder" ? (
        <JalaliDateInput value={due} onChange={setDue} aria-label="تاریخ یادآوری" />
      ) : null}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
        {kind === "reminder" ? "متن یادآوری" : "متن یادداشت"}
        <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "reminder" ? "مثلاً: تماس با مدیر خرید" : "مثلاً: ساعت کاری عوض شده"}
        style={{
          fontFamily: "var(--fa)",
          fontSize: 12.5,
          color: "var(--ink)",
          background: "var(--card)",
          border: "1px solid var(--line-2)",
          borderRadius: 8,
          padding: "7px 9px",
        }}
      />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid"
          disabled={saving || !text.trim() || (kind === "reminder" && !due)}
          onClick={() => void submit()}
        >
          <Icon name="edit" size="md" />
          {saving ? "در حال ذخیره…" : kind === "reminder" ? "ذخیرهٔ یادآوری" : "ذخیرهٔ یادداشت"}
        </button>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={onClose}>
          <Icon name="x" size="md" />
          {kind === "reminder" ? "انصراف از یادآوری" : "انصراف از یادداشت"}
        </button>
      </div>
    </div>
  );
}
