"use client";

import { useState } from "react";
import { useToast } from "./ToastProvider";

export default function AddReminder({
  entityType,
  entityId,
  onAdded,
}: {
  entityType: "district" | "customer";
  entityId: number;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!dueDate || !message.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, due_date: dueDate, message }),
      });
      if (!res.ok) throw new Error();
      toast("یادآوری ثبت شد.", "success");
      setDueDate("");
      setMessage("");
      setOpen(false);
      onAdded?.();
    } catch {
      toast("خطا در ثبت یادآوری", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
          + یادآوری بگذار
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] focus:border-accent"
          />
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="متن یادآوری…"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={saving || !dueDate || !message.trim()}
              className="flex-1 rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-xs)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ذخیره
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
            >
              لغو
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
