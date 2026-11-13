"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { CONTACT_CHANNELS, type ContactChannel, type ContactOff } from "@/lib/contactPrefs";
import { friendlyError } from "@/lib/userMessage";

/** S15 «ترجیح تماس»: tick what the customer asked us not to do, with the reason. Example: «تماس تلفنی» + «گفت زنگ نزنید». */
export default function ContactPrefsSheet({ open, onClose, customerId, name, current, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  current: ContactOff[];
  onDone: () => void;
}) {
  const [off, setOff] = useState<string[]>(current.map((c) => c.channel));
  const [reason, setReason] = useState(current[0]?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const was = new Set<string>(current.map((c) => c.channel));
  const changed = CONTACT_CHANNELS.some((c) => was.has(c.id) !== off.includes(c.id));

  async function save() {
    setBusy(true);
    setError(null);
    for (const c of CONTACT_CHANNELS) {
      const isOff = off.includes(c.id);
      if (isOff === was.has(c.id)) continue;
      const res = await fetch(`/api/customers/${customerId}/contact-prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: c.id as ContactChannel, off: isOff, reason }) }).catch(() => null);
      if (!res?.ok) {
        const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
        setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <BottomSheet open={open} title="ترجیح تماس" subtitle={name} onClose={onClose} closeLabel="بستن ترجیح تماس">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <ChipGroup wrap group={{ id: "off", label: "مشتری نخواسته", mode: "multi", value: off, onChange: (v) => setOff(v as string[]), options: CONTACT_CHANNELS.map((c) => ({ id: c.id, label: c.label })) }} />
        <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full resize-none text-[length:var(--text-base)] text-text" placeholder="دلیل، مثلاً: گفت دیگر زنگ نزنید" />
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton isDisabled={busy || !changed || (off.length > 0 && reason.trim() === "")} onPress={() => void save()}>ذخیره</GoButton>
      </div>
    </BottomSheet>
  );
}
