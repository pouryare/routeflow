"use client";

import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import { useToast } from "./ToastProvider";
import ReminderFlow from "@/components/flows/ReminderFlow";
import { useIsNarrow } from "@/lib/useIsNarrow";

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
  /* On a phone the button opens the tap flow instead of the inline form. The flow stays mounted
     after it closes so «بازگردانی ثبت» can reopen it; a new opening gets a new key. */
  const narrow = useIsNarrow();
  const [flow, setFlow] = useState({ key: 0, open: false });

  async function submit() {
    if (!dueDate || !message.trim()) return;
    setSaving(true);
    try {
      // A customer reminder is a task (kind='reminder') so it shows in the member's
      // Pocket and on the manager's Board. A district reminder stays on the map.
      const res =
        entityType === "customer"
          ? await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: message.trim(),
                kind: "reminder",
                due_at: dueDate,
                entity_type: "customer",
                entity_id: entityId,
              }),
            })
          : await fetch("/api/reminders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entity_type: entityType,
                entity_id: entityId,
                due_date: dueDate,
                message,
              }),
            });
      if (!res.ok) throw new Error();
      toast("یادآوری ثبت شد.", "success");
      setDueDate("");
      setMessage("");
      setOpen(false);
      onAdded?.();
    } catch {
      toast("یادآوری ثبت نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      {!open ? (
        <button
          onClick={() => (narrow ? setFlow((f) => ({ key: f.key + 1, open: true })) : setOpen(true))}
          className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
          <Icon name="clock" size="sm" />
          + یادآوری بگذار
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <JalaliDateInput value={dueDate} onChange={setDueDate} aria-label="تاریخ یادآوری" />
          <label className="flex flex-col gap-1 text-xs text-text-muted">متن یادآوری<input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
           
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent w-full"
          /></label>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={saving || !dueDate || !message.trim()}
              className="inline-flex items-center justify-center gap-[var(--space-2)] flex-1 rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-xs)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="edit" size="sm" />
              ذخیرهٔ یادآوری
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
            >
              <Icon name="x" size="sm" />
              انصراف از یادآوری
            </button>
          </div>
        </div>
      )}
      {flow.key > 0 && (
        <ReminderFlow
          key={flow.key}
          open={flow.open}
          kind="reminder"
          entity={{ type: entityType, id: entityId }}
          onAdded={() => onAdded?.()}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
