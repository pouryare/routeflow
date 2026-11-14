"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton } from "@/components/tapflow/Answer";
import { HELP_KINDS, type HelpKind } from "@/lib/driverHelp";
import { friendlyError } from "@/lib/userMessage";

/** «نیاز به کمک»: one tap on a problem sends a CRITICAL push to the managers with the last GPS point,
 *  so the driver does not have to phone and explain while standing on the road. */
export default function DriverHelp() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(kind: HelpKind) {
    setBusy(true);
    const res = await fetch("/api/driver/help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "به مدیر خبر داده شد؛ در صورت نیاز با شما تماس می‌گیرد." } : { ok: false, text: friendlyError(j?.error, "فرستاده نشد؛ اینترنت را بررسی کنید یا تماس بگیرید") });
  }

  return (
    <>
      <Button
        variant="ghost"
        data-tour="driver-help"
        className="touch inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]"
        onPress={() => setOpen(true)}
      >
        <Icon name="warn" size="sm" />
        نیاز به کمک
      </Button>
      <BottomSheet open={open} title="نیاز به کمک" subtitle="مشکل چیست؟" onClose={() => { setOpen(false); setMsg(null); }} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-2)]" dir="rtl">
          {(Object.keys(HELP_KINDS) as HelpKind[]).map((k) => (
            <AnswerButton key={k} icon="warn" isDisabled={busy || msg?.ok === true} onPress={() => void send(k)}>
              {HELP_KINDS[k]}
            </AnswerButton>
          ))}
          {msg ? <p role="status" className="m-0 text-[length:var(--text-sm)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
        </div>
      </BottomSheet>
    </>
  );
}
