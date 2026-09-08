"use client";

import { useCallback, useEffect, useState } from "react";

/** The browser half of the push channel, lifted verbatim out of the map's
 *  `NotificationToggle` when Phase 2 moved subscribing to /settings/notifications.
 *  `/api/push/subscribe` now stamps the caller's `user_id` on the row, which is what makes
 *  a subscription addressable by the flush — so the same call that used to mean "notify
 *  this browser about overdue reminders" now means "this is my device". */

export type PushState = "unsupported" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushSubscription(): {
  state: PushState;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
} {
  const [state, setState] = useState<PushState>("off");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      // Feature detection: neither API exists during the server render, so this cannot be
      // decided in useState's initialiser without a hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const enable = useCallback(async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return false;
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        setState("off");
        return false;
      }
      setState("on");
      return true;
    } catch {
      setState("off");
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
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
      return true;
    } catch {
      setState("on");
      return false;
    }
  }, []);

  return { state, enable, disable };
}
