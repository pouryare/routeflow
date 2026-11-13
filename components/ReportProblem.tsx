"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton, GoButton } from "@/components/tapflow/Answer";
import { FieldArea } from "@/components/FieldInput";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { friendlyError } from "@/lib/userMessage";

/** S24 «گزارش مشکل برنامه»: a line from the person, plus the page, phone and connection the app already knows, and
 *  a screenshot if they add one. The button sits in the account menu (a desk) and «حساب من» (a phone), for every
 *  role. Example: a rep on /sales/orders/new writes «دکمه ثبت کار نمی‌کند» and the owner sees the page, the phone and
 *  «4g» next to it. */
export default function ReportProblem({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    const small = await shrinkPhoto(f, { maxEdge: 900 });
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(small);
    }).catch(() => "");
    if (!data || data.length > 600_000) setMsg({ ok: false, text: "این تصویر برای فرستادن بزرگ است؛ تصویر دیگری بگذارید یا بدون تصویر بفرستید" });
    else {
      setMsg(null);
      setShot(data);
    }
  }

  async function send() {
    setBusy(true);
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
    const res = await fetch("/api/problem-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, page: pathname, connection: `${navigator.onLine ? "online" : "offline"}${conn ? ` ${conn}` : ""}`, screenshot: shot }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setMsg({ ok: true, text: "گزارش فرستاده شد؛ ممنون" });
      setMessage("");
      setShot(null);
    } else setMsg({ ok: false, text: friendlyError(j?.error, "فرستاده نشد؛ دوباره تلاش کنید") });
  }

  return (
    <>
      <Button variant="ghost" className={className} data-tour="report-problem" onPress={() => { onOpen?.(); setOpen(true); }}>
        <Icon name="warn" size="sm" /> گزارش مشکل برنامه
      </Button>
      <BottomSheet open={open} title="گزارش مشکل برنامه" subtitle="چه چیزی درست کار نکرد؟" onClose={() => { setOpen(false); setMsg(null); }} closeLabel="بستن گزارش مشکل" dirty={message.trim().length > 0 && !msg?.ok}>
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <FieldArea aria-label="شرح مشکل" placeholder="مثلاً: دکمهٔ ثبت کار نمی‌کند" rows={4} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          {shot ? (
            <div className="flex items-center gap-[var(--space-3)]">
              <span role="img" aria-label="تصویر پیوست" className="h-16 w-16 rounded-[var(--radius-md)] bg-cover bg-center" style={{ backgroundImage: `url(${shot})` }} />
              <AnswerButton icon="x" onPress={() => setShot(null)}>برداشتن تصویر</AnswerButton>
            </div>
          ) : (
            <AnswerButton icon="camera" onPress={() => file.current?.click()}>پیوست تصویر صفحه (اختیاری)</AnswerButton>
          )}
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">صفحه، نقش، نسخهٔ برنامه، نوع گوشی و وضعیت اینترنت خودکار همراه گزارش می‌رود.</p>
          {msg ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
          <GoButton icon="send" isDisabled={busy || message.trim().length === 0} onPress={() => void send()}>فرستادن گزارش</GoButton>
        </div>
      </BottomSheet>
    </>
  );
}
