"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ToastProvider";

/** TEMPORARY — delete this file once the drain has been looked at and signed off.
 *
 *  It renders nothing of its own; `ToastProvider` already wraps every page in the root
 *  layout, so this only fires the real toasts. The point is to watch the ACTUAL component
 *  with the ACTUAL stylesheet: the real countdown, the real hover-pause, the real tone
 *  per variant -- not a mock-up of them.
 */
export default function ToastDemo() {
  const toast = useToast();
  // StrictMode double-invokes effects in dev, which fired the whole set twice and put six
  // toasts on screen. A ref survives that replay; a plain `if` guard does not.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Plain success — no action button, so this is the case that never drained before.
    toast("سفارش 00844-1405 به مسیر اضافه شد", "success");
    // The undo case: same drain, but it lives the long OUTBOX_HOLD_MS window and pauses
    // on hover, because it is the only undo there is.
    toast("۳ مشتری حذف شد", "info", {
      label: "لغو",
      icon: "undo",
      onClick: () => {},
    });
    // The other tone, so the flood is visibly green / accent / red.
    toast("اتصال به سرور برقرار نشد", "error");
  }, [toast]);

  return (
    <div className="min-h-screen p-8">
      <h1 className="mb-2 text-lg font-semibold">نمایش toast</h1>
      <p className="text-sm text-text-muted">
        رنگ پر شدن مثل نوار پیشرفت خالی می‌شود؛ متن و شکل پیل ثابت می‌مانند. برای مکث،
        نشانگر را روی toast نگه دارید.
      </p>
    </div>
  );
}