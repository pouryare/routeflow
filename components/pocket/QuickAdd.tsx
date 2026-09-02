"use client";

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
      toast(kind === "reminder" ? "یادآوری ثبت شد." : "یادداشت ثبت شد.", "success");
      setText("");
      setDue("");
      onAdded();
      onClose();
    } catch {
      toast("خطا در ثبت", "error");
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
        {kind === "reminder" ? "+ یادآوری بگذار" : "+ یادداشت"}
      </div>
      {kind === "reminder" ? (
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
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
      ) : null}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "reminder" ? "متن یادآوری…" : "متن یادداشت…"}
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
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn solid"
          disabled={saving || !text.trim() || (kind === "reminder" && !due)}
          onClick={() => void submit()}
        >
          ذخیره
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          لغو
        </button>
      </div>
    </div>
  );
}
