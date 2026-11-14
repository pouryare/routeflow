"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";

/** «دیر می‌رسم»: one tap on a reason tells the office this stop will be late. */
export default function LateButton({ stopId, reasons }: { stopId: number; reasons: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(id: number) {
    setBusy(true);
    const res = await fetch(`/api/driver/stops/${stopId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "late", delay_reason_id: id }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "ثبت شد؛ دفتر می‌داند دیر می‌رسید." } : { ok: false, text: friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید") });
  }

  return (
    <>
      <Button
        variant="ghost"
        className="touch mb-[var(--space-3)] ms-[var(--space-2)] inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]"
        onPress={() => setOpen(true)}
      >
        <Icon name="clock" size="sm" />
        دیر می‌رسم
      </Button>
      <BottomSheet open={open} title="دیر می‌رسم" subtitle="چرا؟" onClose={() => { setOpen(false); setMsg(null); }} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-2)]" dir="rtl">
          {reasons.map((r) => (
            <AnswerButton key={r.id} icon="clock" isDisabled={busy || msg?.ok === true} onPress={() => void send(r.id)}>{r.label}</AnswerButton>
          ))}
          {msg ? <p role="status" className="m-0 text-[length:var(--text-sm)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
        </div>
      </BottomSheet>
    </>
  );
}
