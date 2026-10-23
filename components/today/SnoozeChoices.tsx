"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";
import { friendlyError } from "@/lib/userMessage";
import { SNOOZE_CHOICES, type SnoozeChoice } from "@/lib/taskSnooze";

/** F142: «بعداً» on a task or reminder. One tap opens the two choices beside it, a second tap
 *  moves the due time (PATCH /api/tasks/[id] { snooze }). The server refuses urgent work and a
 *  fourth snooze; the screen only offers it when the card says `snoozable`. */
export default function SnoozeChoices({ taskId, onDone }: { taskId: number; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function snooze(choice: SnoozeChoice, label: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snooze: choice }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(friendlyError(j.error, "عقب انداخته نشد؛ دوباره تلاش کنید"), "error");
        return;
      }
      toast(`به ${label} رفت`, "success");
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => setOpen(true)}>
        <Icon name="clock" size="sm" />
        عقب انداختن این کار
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="بعداً">
      {SNOOZE_CHOICES.map((c) => (
        <button key={c.id} type="button" disabled={busy} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => void snooze(c.id, c.label)}>
          <Icon name="clock" size="sm" />
          {c.label}
        </button>
      ))}
    </span>
  );
}
