"use client";

import { useEffect, useState } from "react";
import { useToast } from "./ToastProvider";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = "unsupported" | "denied" | "off" | "on" | "busy";

export default function NotificationToggle() {
  const [state, setState] = useState<State>("off");
  const toast = useToast();

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    });
  }, []);

  async function enable() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      toast("اعلان‌ها روی این سرور پیکربندی نشده‌اند", "error");
      return;
    }
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        if (permission === "denied") toast("اجازه اعلان داده نشد", "error");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setState("on");
      toast("اعلان یادآوری‌ها فعال شد.", "success");
    } catch {
      setState("off");
      toast("خطا در فعال‌سازی اعلان‌ها", "error");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      toast("اعلان یادآوری‌ها غیرفعال شد.", "info");
    } catch {
      setState("on");
      toast("خطا در غیرفعال‌سازی اعلان‌ها", "error");
    }
  }

  if (state === "unsupported") {
    return <p className="text-[length:var(--text-xs)] text-text-faint">مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند.</p>;
  }
  if (state === "denied") {
    return <p className="text-[length:var(--text-xs)] text-text-faint">دسترسی اعلان مسدود شده — از تنظیمات مرورگر فعال کنید.</p>;
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[length:var(--text-sm)] text-text">اعلان یادآوری‌های معوق</span>
      <button
        onClick={state === "on" ? disable : enable}
        disabled={state === "busy"}
        role="switch"
        aria-checked={state === "on"}
        aria-label="اعلان یادآوری‌های معوق"
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] disabled:opacity-50 ${
          state === "on" ? "border-accent bg-accent" : "border-border bg-surface"
        }`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ right: state === "on" ? "calc(100% - 1.25rem)" : "0.125rem" }}
        />
      </button>
    </div>
  );
}
